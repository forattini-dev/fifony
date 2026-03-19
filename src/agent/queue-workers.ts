import type { IssueEntry, RuntimeState } from "./types.ts";
import { logger } from "./logger.ts";
import { getStateDb, loadS3dbModule } from "./store.ts";
import { S3DB_ISSUE_RESOURCE } from "./constants.ts";

type QueuePlugin = {
  startProcessing: (handler?: any, options?: { concurrency?: number }) => Promise<void>;
  stopProcessing: () => Promise<void>;
  getStats: () => Promise<{ total: number; pending: number; processing: number; completed: number; failed: number; dead: number }>;
  recoverStalledMessages: (now: number) => Promise<void>;
};

type EnqueueableResource = {
  enqueue: (data: Record<string, unknown>, options?: { maxAttempts?: number }) => Promise<Record<string, unknown>>;
};

let planPlugin: QueuePlugin | null = null;
let executePlugin: QueuePlugin | null = null;
let reviewPlugin: QueuePlugin | null = null;

let planResource: EnqueueableResource | null = null;
let executeResource: EnqueueableResource | null = null;
let reviewResource: EnqueueableResource | null = null;

let runtimeState: RuntimeState | null = null;

export async function initQueueWorkers(state: RuntimeState): Promise<void> {
  runtimeState = state;

  const db = getStateDb();
  if (!db) {
    logger.warn("[QueueWorkers] No state DB available — queue workers disabled");
    return;
  }

  const { S3QueuePlugin } = await loadS3dbModule();
  if (!S3QueuePlugin) {
    logger.warn("[QueueWorkers] S3QueuePlugin not available — queue workers disabled");
    return;
  }

  try {
    const issueResource = await db.getResource(S3DB_ISSUE_RESOURCE);

    // plan-queue
    const planPluginInstance = new S3QueuePlugin({
      resource: S3DB_ISSUE_RESOURCE,
      visibilityTimeout: 1_200_000,
      pollInterval: 5_000,
      maxAttempts: 3,
      concurrency: 1,
      autoStart: false,
      autoAcknowledge: false,
      failureStrategy: { mode: "retry", maxRetries: 3 },
    });
    await db.usePlugin(planPluginInstance as unknown, "plan-queue");
    planPlugin = planPluginInstance;
    planResource = issueResource as unknown as EnqueueableResource;

    // execute-queue
    const executePluginInstance = new S3QueuePlugin({
      resource: S3DB_ISSUE_RESOURCE,
      visibilityTimeout: 3_600_000,
      pollInterval: 5_000,
      maxAttempts: 3,
      concurrency: state.config.workerConcurrency,
      autoStart: false,
      autoAcknowledge: false,
      failureStrategy: { mode: "retry", maxRetries: 3 },
    });
    await db.usePlugin(executePluginInstance as unknown, "execute-queue");
    executePlugin = executePluginInstance;
    executeResource = issueResource as unknown as EnqueueableResource;

    // review-queue
    const reviewPluginInstance = new S3QueuePlugin({
      resource: S3DB_ISSUE_RESOURCE,
      visibilityTimeout: 1_200_000,
      pollInterval: 5_000,
      maxAttempts: 3,
      concurrency: 1,
      autoStart: false,
      autoAcknowledge: false,
      failureStrategy: { mode: "retry", maxRetries: 3 },
    });
    await db.usePlugin(reviewPluginInstance as unknown, "review-queue");
    reviewPlugin = reviewPluginInstance;
    reviewResource = issueResource as unknown as EnqueueableResource;

    await planPlugin.startProcessing(buildPlanHandler(), { concurrency: 1 });
    await executePlugin.startProcessing(buildExecuteHandler(), { concurrency: state.config.workerConcurrency });
    await reviewPlugin.startProcessing(buildReviewHandler(), { concurrency: 1 });

    logger.info("[QueueWorkers] All 3 queue workers started (plan, execute, review)");
  } catch (error) {
    logger.warn({ err: error }, "[QueueWorkers] Failed to initialize queue workers — degrading gracefully");
    planPlugin = null;
    executePlugin = null;
    reviewPlugin = null;
  }
}

export async function stopQueueWorkers(): Promise<void> {
  const stops = [
    planPlugin?.stopProcessing(),
    executePlugin?.stopProcessing(),
    reviewPlugin?.stopProcessing(),
  ].filter(Boolean);

  if (stops.length === 0) return;

  try {
    await Promise.allSettled(stops);
    logger.info("[QueueWorkers] All queue workers stopped");
  } catch (error) {
    logger.warn({ err: error }, "[QueueWorkers] Error stopping queue workers");
  } finally {
    planPlugin = null;
    executePlugin = null;
    reviewPlugin = null;
    planResource = null;
    executeResource = null;
    reviewResource = null;
    runtimeState = null;
  }
}

export async function enqueueForPlanning(issue: IssueEntry): Promise<void> {
  if (!planResource) return;
  logger.debug({ issueId: issue.id, identifier: issue.identifier }, "[QueueWorkers] Enqueuing for planning");
  await (planResource as any).enqueue({ ...issue, _queueTarget: "Planning" });
}

export async function enqueueForExecution(issue: IssueEntry): Promise<void> {
  if (!executeResource) return;
  logger.debug({ issueId: issue.id, identifier: issue.identifier }, "[QueueWorkers] Enqueuing for execution");
  await (executeResource as any).enqueue({ ...issue, _queueTarget: "Queued" });
}

export async function enqueueForReview(issue: IssueEntry): Promise<void> {
  if (!reviewResource) return;
  logger.debug({ issueId: issue.id, identifier: issue.identifier }, "[QueueWorkers] Enqueuing for review");
  await (reviewResource as any).enqueue({ ...issue, _queueTarget: "Reviewing" });
}

export function areQueueWorkersActive(): boolean {
  return planPlugin !== null && executePlugin !== null && reviewPlugin !== null;
}

export async function getQueueStats(): Promise<Record<string, unknown>> {
  const [plan, execute, review] = await Promise.allSettled([
    planPlugin?.getStats(),
    executePlugin?.getStats(),
    reviewPlugin?.getStats(),
  ]);

  return {
    plan: plan.status === "fulfilled" ? plan.value : null,
    execute: execute.status === "fulfilled" ? execute.value : null,
    review: review.status === "fulfilled" ? review.value : null,
  };
}

function getCurrentIssue(id: string): IssueEntry | undefined {
  return runtimeState?.issues.find((i) => i.id === id);
}

function buildPlanHandler() {
  return async (record: Record<string, unknown>, context: {
    queueId: string;
    attempts: number;
    workerId: string;
    ack: (result?: unknown) => Promise<void>;
    nack: (error?: Error | string) => Promise<void>;
    renewLock: (extraMs?: number) => Promise<boolean>;
  }) => {
    const issueId = record.id as string;
    if (!issueId) {
      await context.ack();
      return;
    }

    const state = runtimeState;
    if (!state) {
      await context.nack("Runtime state not available");
      return;
    }

    const issue = getCurrentIssue(issueId);
    if (!issue || issue.state !== "Planning") {
      logger.debug({ issueId, currentState: issue?.state }, "[QueueWorkers:plan] Issue no longer in Planning state, skipping");
      await context.ack();
      return;
    }

    if (issue.planningStatus === "planning") {
      logger.debug({ issueId }, "[QueueWorkers:plan] Planning already in progress, skipping");
      await context.ack();
      return;
    }

    logger.info({ issueId, identifier: issue.identifier }, "[QueueWorkers:plan] Processing planning job");

    try {
      const { runPlanningJob } = await import("./issue-runner.ts");
      await runPlanningJob(state, issue);
      await context.ack();
    } catch (error) {
      logger.error({ err: error, issueId }, "[QueueWorkers:plan] Planning job failed");
      await context.nack(error instanceof Error ? error : String(error));
    }
  };
}

function buildExecuteHandler() {
  return async (record: Record<string, unknown>, context: {
    queueId: string;
    attempts: number;
    workerId: string;
    ack: (result?: unknown) => Promise<void>;
    nack: (error?: Error | string) => Promise<void>;
    renewLock: (extraMs?: number) => Promise<boolean>;
  }) => {
    const issueId = record.id as string;
    if (!issueId) {
      await context.ack();
      return;
    }

    const state = runtimeState;
    if (!state) {
      await context.nack("Runtime state not available");
      return;
    }

    const issue = getCurrentIssue(issueId);
    if (!issue || (issue.state !== "Queued" && issue.state !== "Running")) {
      logger.debug({ issueId, currentState: issue?.state }, "[QueueWorkers:execute] Issue not in Queued/Running state, skipping");
      await context.ack();
      return;
    }

    logger.info({ issueId, identifier: issue.identifier, state: issue.state }, "[QueueWorkers:execute] Processing execution job");

    const running = new Set<string>();

    try {
      const { runIssueOnce } = await import("./issue-runner.ts");
      await runIssueOnce(state, issue, running);
      await context.ack();
    } catch (error) {
      logger.error({ err: error, issueId }, "[QueueWorkers:execute] Execution job failed");
      await context.nack(error instanceof Error ? error : String(error));
    }
  };
}

function buildReviewHandler() {
  return async (record: Record<string, unknown>, context: {
    queueId: string;
    attempts: number;
    workerId: string;
    ack: (result?: unknown) => Promise<void>;
    nack: (error?: Error | string) => Promise<void>;
    renewLock: (extraMs?: number) => Promise<boolean>;
  }) => {
    const issueId = record.id as string;
    if (!issueId) {
      await context.ack();
      return;
    }

    const state = runtimeState;
    if (!state) {
      await context.nack("Runtime state not available");
      return;
    }

    const issue = getCurrentIssue(issueId);
    if (!issue || issue.state !== "Reviewing") {
      logger.debug({ issueId, currentState: issue?.state }, "[QueueWorkers:review] Issue not in Reviewing state, skipping");
      await context.ack();
      return;
    }

    logger.info({ issueId, identifier: issue.identifier }, "[QueueWorkers:review] Processing review job");

    const running = new Set<string>();

    try {
      const { runIssueOnce } = await import("./issue-runner.ts");
      await runIssueOnce(state, issue, running);
      await context.ack();
    } catch (error) {
      logger.error({ err: error, issueId }, "[QueueWorkers:review] Review job failed");
      await context.nack(error instanceof Error ? error : String(error));
    }
  };
}
