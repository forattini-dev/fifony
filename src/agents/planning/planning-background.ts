import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IssueEntry, IssuePlan, RuntimeState } from "../../types.ts";
import { WORKSPACE_ROOT } from "../../concerns/constants.ts";
import { idToSafePath, now } from "../../concerns/helpers.ts";
import { logger } from "../../concerns/logger.ts";
import { addEvent } from "../../domains/issues.ts";
import { addTokenUsage } from "../directive-parser.ts";
import { markIssueDirty } from "../../persistence/dirty-tracker.ts";
import { persistState, savePlanForIssue } from "../../persistence/store.ts";
import { getWorkflowConfig, loadRuntimeSettings } from "../../persistence/settings.ts";
import {
  applyCheckpointPolicyToPlan,
  applyHarnessModeToPlan,
  recommendCheckpointPolicyForIssue,
  recommendHarnessModeForIssue,
} from "../harness-policy.ts";
import { recordPolicyDecision } from "../../domains/policy-decisions.ts";
import { runContractNegotiation } from "../contract-negotiation.ts";
import { generatePlan } from "./plan-generator.ts";
import { refinePlan } from "./plan-refiner.ts";

function resolvePlanningWorkspace(issue: IssueEntry): string {
  return join(WORKSPACE_ROOT, idToSafePath(issue.id));
}

function applyPlanSuggestions(issue: IssueEntry, plan: IssuePlan): void {
  if (plan.suggestedPaths?.length && !(issue.paths?.length)) issue.paths = plan.suggestedPaths;
  if (plan.suggestedEffort && !issue.effort) issue.effort = plan.suggestedEffort;
}

function applyPlannerUsage(
  issue: IssueEntry,
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; model: string },
): void {
  if (usage.totalTokens <= 0) return;
  addTokenUsage(issue, {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    model: usage.model,
  }, "planner");
}

function applyAdaptiveHarnessSelection(state: RuntimeState, issue: IssueEntry, plan: IssuePlan): void {
  const plannedIssue: IssueEntry = {
    ...issue,
    plan,
    reviewProfile: undefined,
  };
  const recommendation = state.config.adaptiveHarnessSelection === false
    ? null
    : recommendHarnessModeForIssue(
      state.issues.filter((entry) => entry.id !== issue.id),
      plannedIssue,
      plan.harnessMode,
      state.config.adaptivePolicyMinSamples ?? 3,
    );

  if (recommendation && recommendation.mode !== plan.harnessMode) {
    const previousMode = plan.harnessMode;
    applyHarnessModeToPlan(plan, recommendation.mode);

    recordPolicyDecision(issue, {
      id: `policy.plan.v${issue.planVersion ?? 1}.harness-mode`,
      kind: "harness-mode",
      scope: "planning",
      planVersion: issue.planVersion ?? 1,
      basis: recommendation.basis,
      from: previousMode,
      to: plan.harnessMode,
      rationale: recommendation.rationale,
      recordedAt: now(),
      profile: recommendation.profile.primary,
    });

    addEvent(
      state,
      issue.id,
      "info",
      `Adaptive harness policy changed ${issue.identifier} from ${previousMode} to ${plan.harnessMode}: ${recommendation.rationale}`,
    );
  }

  const checkpointRecommendation = state.config.adaptiveHarnessSelection === false
    ? null
    : recommendCheckpointPolicyForIssue(
      state.issues.filter((entry) => entry.id !== issue.id),
      plannedIssue,
      plan.executionContract.checkpointPolicy,
      state.config.adaptivePolicyMinSamples ?? 3,
    );

  if (!checkpointRecommendation || checkpointRecommendation.checkpointPolicy === plan.executionContract.checkpointPolicy) return;

  const previousCheckpointPolicy = plan.executionContract.checkpointPolicy;
  applyCheckpointPolicyToPlan(plan, checkpointRecommendation.checkpointPolicy);
  recordPolicyDecision(issue, {
    id: `policy.plan.v${issue.planVersion ?? 1}.checkpoint-policy`,
    kind: "checkpoint-policy",
    scope: "planning",
    planVersion: issue.planVersion ?? 1,
    basis: checkpointRecommendation.basis,
    from: previousCheckpointPolicy,
    to: plan.executionContract.checkpointPolicy,
    rationale: checkpointRecommendation.rationale,
    recordedAt: now(),
    profile: checkpointRecommendation.profile.primary,
  });

  addEvent(
    state,
    issue.id,
    "info",
    `Adaptive checkpoint policy changed ${issue.identifier} from ${previousCheckpointPolicy} to ${plan.executionContract.checkpointPolicy}: ${checkpointRecommendation.rationale}`,
  );
}

async function loadWorkflowConfigOrNull() {
  try {
    return getWorkflowConfig(await loadRuntimeSettings());
  } catch {
    return null;
  }
}

async function finalizePlanUpdate(
  state: RuntimeState,
  issue: IssueEntry,
  plan: IssuePlan,
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; model: string },
  options?: { prompt?: string; activityLabel: string; successMessage: string },
): Promise<void> {
  issue.plan = plan;
  issue.planVersion = Math.max((issue.planVersion ?? 0), 1);
  issue.planningError = undefined;

  applyAdaptiveHarnessSelection(state, issue, plan);
  applyPlanSuggestions(issue, plan);
  applyPlannerUsage(issue, usage);

  const workspaceDir = resolvePlanningWorkspace(issue);
  mkdirSync(workspaceDir, { recursive: true });

  await savePlanForIssue(issue.id, plan, issue.planVersion);

  try {
    writeFileSync(join(workspaceDir, `plan.v${issue.planVersion}.json`), JSON.stringify(plan, null, 2), "utf8");
    if (options?.prompt) {
      writeFileSync(join(workspaceDir, `plan.v${issue.planVersion}.prompt.md`), options.prompt, "utf8");
    }
  } catch (error) {
    logger.warn({ err: String(error), issueId: issue.id }, "[Planning] Failed to write plan artifacts");
  }

  const workflowConfig = await loadWorkflowConfigOrNull();
  await runContractNegotiation(state, issue, workflowConfig, workspaceDir);

  issue.planningStatus = "idle";
  issue.planningStartedAt = undefined;
  issue.updatedAt = now();
  markIssueDirty(issue.id);

  addEvent(state, issue.id, "progress", options?.successMessage ?? `${options?.activityLabel ?? "Plan"} completed for ${issue.identifier}.`);
  if (usage.totalTokens > 0) {
    addEvent(
      state,
      issue.id,
      "info",
      `${options?.activityLabel ?? "Plan"} tokens (${issue.identifier}): ${usage.totalTokens.toLocaleString()} (in: ${usage.inputTokens.toLocaleString()}, out: ${usage.outputTokens.toLocaleString()}) [${usage.model}]`,
    );
  }
  await persistState(state);
}

/**
 * Start plan generation in the background. Returns immediately.
 * Updates issue.plan and broadcasts via WS when done.
 */
export function generatePlanInBackground(
  state: RuntimeState,
  issue: IssueEntry,
  options?: { fast?: boolean },
): void {
  const fast = options?.fast ?? false;

  issue.planningStatus = "planning";
  issue.planningStartedAt = now();
  issue.planningError = undefined;
  issue.updatedAt = now();
  issue.contractNegotiationStatus = undefined;
  issue.contractNegotiationAttempt = 0;
  markIssueDirty(issue.id);

  addEvent(state, issue.id, "info", `${fast ? "Fast plan" : "Plan"} generation starting for ${issue.identifier} (provider detection in progress).`);

  generatePlan(issue.title, issue.description, state.config, null, { fast })
    .then(async ({ plan, usage, prompt }) => {
      await finalizePlanUpdate(state, issue, plan, usage, {
        prompt,
        activityLabel: fast ? "Fast plan" : "Plan",
        successMessage: `${fast ? "Fast plan" : "Plan"} generated for ${issue.identifier}: ${plan.steps.length} steps, complexity: ${plan.estimatedComplexity}.`,
      });
    })
    .catch(async (err) => {
      issue.planningStatus = "idle";
      issue.planningStartedAt = undefined;
      issue.planningError = err instanceof Error ? err.message : String(err);
      issue.updatedAt = now();
      markIssueDirty(issue.id);
      addEvent(state, issue.id, "error", `Plan generation failed for ${issue.identifier}: ${issue.planningError}`);
      await persistState(state);
      logger.error({ err }, `Background plan generation failed for ${issue.identifier}`);
    });
}

/**
 * Start plan refinement in the background. Returns immediately.
 * Updates issue.plan and broadcasts via WS when done.
 */
export function refinePlanInBackground(
  state: RuntimeState,
  issue: IssueEntry,
  feedback: string,
): void {
  issue.planningStatus = "planning";
  issue.planningStartedAt = now();
  issue.planningError = undefined;
  issue.updatedAt = now();
  issue.contractNegotiationStatus = undefined;
  issue.contractNegotiationAttempt = 0;
  markIssueDirty(issue.id);

  const feedbackSnippet = feedback.length > 60 ? `${feedback.slice(0, 57)}...` : feedback;
  addEvent(state, issue.id, "info", `Plan refinement starting for ${issue.identifier}: "${feedbackSnippet}".`);

  refinePlan(issue, feedback, state.config, null)
    .then(async ({ plan, usage }) => {
      await finalizePlanUpdate(state, issue, plan, usage, {
        activityLabel: "Refinement",
        successMessage: `Plan refined for ${issue.identifier}: "${feedback.length > 80 ? `${feedback.slice(0, 77)}...` : feedback}" → ${plan.steps.length} steps, complexity: ${plan.estimatedComplexity}.`,
      });
    })
    .catch(async (err) => {
      issue.planningStatus = "idle";
      issue.planningStartedAt = undefined;
      issue.planningError = err instanceof Error ? err.message : String(err);
      issue.updatedAt = now();
      markIssueDirty(issue.id);
      addEvent(state, issue.id, "error", `Plan refinement failed for ${issue.identifier}: ${issue.planningError}`);
      await persistState(state);
      logger.error({ err }, `Background plan refinement failed for ${issue.identifier}`);
    });
}
