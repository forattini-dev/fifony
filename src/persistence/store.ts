import type {
  RuntimeState,
  RuntimeStateRecord,
  IssueEntry,
  MilestoneEntry,
  RuntimeEvent,
  RuntimeSettingRecord,
  ServiceEntry,
  VariableEntry,
  S3dbModule,
  S3dbDatabase,
  S3dbResource,
} from "../types.ts";
import {
  S3DB_DATABASE_PATH,
  S3DB_ISSUE_RESOURCE,
  EMBEDDING_VECTOR_DIMENSIONS,
  S3DB_RUNTIME_RECORD_ID,
  S3DB_RUNTIME_SCHEMA_VERSION,
  S3DB_CONTEXT_FRAGMENT_RESOURCE,
} from "../concerns/constants.ts";
import { now, debugBoot, fail } from "../concerns/helpers.ts";
import { logger } from "../concerns/logger.ts";
import { getMetrics } from "./metrics-cache.ts";
import { clearApiRuntimeContext } from "../persistence/plugins/api-runtime-context.ts";
import { broadcastToWebSocketClients } from "../persistence/plugins/api-server.ts";
import { NATIVE_RESOURCE_CONFIGS, NATIVE_RESOURCE_NAMES } from "./resources/index.ts";
import {
  setIssueStateMachinePlugin,
  setIssueResourceStateApi,
  issueStateMachineConfig,
} from "./plugins/fsm-issue.ts";
import { serviceStateMachineConfig, setServiceResourceStateApi } from "./plugins/fsm-service.ts";

let loadedS3dbModule: S3dbModule | null = null;
let stateDb: S3dbDatabase | null = null;
let runtimeStateResource: S3dbResource | null = null;
let issueStateResource: S3dbResource | null = null;
let milestoneStateResource: S3dbResource | null = null;
let issuePlanResource: S3dbResource | null = null;
let eventStateResource: S3dbResource | null = null;
let settingStateResource: S3dbResource | null = null;
let agentSessionResource: S3dbResource | null = null;
let agentPipelineResource: S3dbResource | null = null;
let serviceResource: S3dbResource | null = null;
let variablesResource: S3dbResource | null = null;
let contextFragmentResource: S3dbResource | null = null;
let activeApiPlugin: { stop?: () => Promise<void> } | null = null;
let activeStateMachinePlugin: { stop?: () => Promise<void> } | null = null;
let activeServiceStateMachinePlugin: { stop?: () => Promise<void> } | null = null;
let activeAgentStateMachinePlugin: { stop?: () => Promise<void> } | null = null;
let activeEcPlugin: S3dbModule["EventualConsistencyPlugin"] extends new (...a: never[]) => infer R ? R | null : null = null;

import {
  markIssueDirty,
  markMilestoneDirty,
  markIssuePlanDirty,
  markEventDirty,
  hasDirtyState,
  getDirtyIssueIds,
  getDirtyMilestoneIds,
  getDirtyEventIds,
  snapshotAndClearDirtyIssueIds,
  snapshotAndClearDirtyMilestoneIds,
  snapshotAndClearDirtyIssuePlanIds,
  snapshotAndClearDirtyEventIds,
  markAllIssuesDirty,
  markAllMilestonesDirty,
  markAllIssuePlansDirty,
  markAllEventsDirty,
} from "./dirty-tracker.ts";
import { normalizeMilestone, refreshMilestoneSummaries } from "../domains/milestones.ts";

export { markIssueDirty, markMilestoneDirty, markIssuePlanDirty, markEventDirty, hasDirtyState };

export function getStateDb(): S3dbDatabase | null { return stateDb; }
export function getIssueStateResource(): S3dbResource | null { return issueStateResource; }
export function getMilestoneStateResource(): S3dbResource | null { return milestoneStateResource; }
export function getIssuePlanResource(): S3dbResource | null { return issuePlanResource; }
export function getEventStateResource(): S3dbResource | null { return eventStateResource; }
export function getSettingStateResource(): S3dbResource | null { return settingStateResource; }
export function getAgentSessionResource(): S3dbResource | null { return agentSessionResource; }
export function getAgentPipelineResource(): S3dbResource | null { return agentPipelineResource; }
export function getServiceResource(): S3dbResource | null { return serviceResource; }
export function getVariablesResource(): S3dbResource | null { return variablesResource; }
export function getContextFragmentResource(): S3dbResource | null { return contextFragmentResource; }

// ── Plan resource helpers (1:N model) ─────────────────────────────────────

import { randomUUID } from "node:crypto";

/** Save a new plan version for an issue. Marks previous plans as not current. */
export async function savePlanForIssue(issueId: string, plan: unknown, version: number): Promise<string> {
  if (!issuePlanResource) throw new Error("Issue plan resource not initialized");
  // Mark previous current plans as not current
  try {
    const existing = await (issuePlanResource as any).list({
      partition: "byIssueCurrent",
      partitionValues: { issueId, current: true },
    });
    if (Array.isArray(existing)) {
      for (const old of existing) {
        if (old?.id) await (issuePlanResource as any).patch(old.id, { current: false });
      }
    }
  } catch { /* first plan or partition not ready */ }

  const planId = `plan-${randomUUID()}`;
  await (issuePlanResource as any).insert({
    id: planId,
    issueId,
    version,
    current: true,
    plan,
  });
  return planId;
}

/** Get the current (active) plan for an issue. Returns null if none. */
export async function getCurrentPlanForIssue(issueId: string): Promise<{ id: string; plan: unknown; version: number } | null> {
  if (!issuePlanResource) return null;
  try {
    const results = await (issuePlanResource as any).list({
      partition: "byIssueCurrent",
      partitionValues: { issueId, current: true },
      limit: 1,
    });
    if (Array.isArray(results) && results.length > 0 && results[0]?.plan) {
      return { id: results[0].id, plan: results[0].plan, version: results[0].version ?? 1 };
    }
  } catch { /* partition not ready or no plans */ }
  return null;
}

/** Get all plans for an issue, ordered by version. */
export async function getPlansForIssue(issueId: string): Promise<Array<{ id: string; plan: unknown; version: number; current: boolean }>> {
  if (!issuePlanResource) return [];
  try {
    const results = await (issuePlanResource as any).list({
      partition: "byIssue",
      partitionValues: { issueId },
    });
    if (!Array.isArray(results)) return [];
    return results
      .filter((r: any) => r?.id && r?.plan)
      .map((r: any) => ({ id: r.id, plan: r.plan, version: r.version ?? 1, current: !!r.current }))
      .sort((a: any, b: any) => a.version - b.version);
  } catch { return []; }
}
export function setActiveApiPlugin(plugin: { stop?: () => Promise<void> } | null): void { activeApiPlugin = plugin; }
let activeWebSocketPlugin: { stop?: () => Promise<void> } | null = null;

export async function loadS3dbModule(): Promise<S3dbModule> {
  if (loadedS3dbModule) return loadedS3dbModule;

  try {
    const imported = await import("s3db.js");
    const ApiPlugin = await imported.loadApiPlugin();

    loadedS3dbModule = {
      S3db: imported.S3db as S3dbModule["S3db"],
      SqliteClient: imported.SqliteClient as S3dbModule["SqliteClient"],
      VectorPlugin: imported.VectorPlugin as S3dbModule["VectorPlugin"],
      ApiPlugin: ApiPlugin as S3dbModule["ApiPlugin"],
      WebSocketPlugin: imported.WebSocketPlugin as S3dbModule["WebSocketPlugin"],
      StateMachinePlugin: imported.StateMachinePlugin as S3dbModule["StateMachinePlugin"],
      EventualConsistencyPlugin: imported.EventualConsistencyPlugin as unknown as S3dbModule["EventualConsistencyPlugin"],
      S3QueuePlugin: imported.S3QueuePlugin as S3dbModule["S3QueuePlugin"],
    };
    return loadedS3dbModule;
  } catch (error) {
    fail(`Failed to load s3db.js: ${String(error)}`);
  }
}

export async function initStateStore(): Promise<void> {
  debugBoot("initStateStore:start");
  logger.info("[Boot] Loading s3db.js module…");
  const { S3db, SqliteClient, StateMachinePlugin, VectorPlugin } = await loadS3dbModule();
  debugBoot("initStateStore:module-loaded");

  stateDb = new S3db({
    client: new SqliteClient({ basePath: S3DB_DATABASE_PATH }),
  });

  logger.info({ db: S3DB_DATABASE_PATH }, "[Boot] Connecting to SQLite database…");
  await stateDb.connect();
  debugBoot("initStateStore:connected");

  logger.info({ count: NATIVE_RESOURCE_CONFIGS.length }, "[Boot] Registering resources…");
  for (const resourceConfig of NATIVE_RESOURCE_CONFIGS) {
    await stateDb.createResource(resourceConfig);
  }
  logger.info("[Boot] Installing plugins…");

  if (VectorPlugin) {
    try {
      await stateDb.usePlugin(
        new VectorPlugin({
          dimensions: EMBEDDING_VECTOR_DIMENSIONS,
          distanceMetric: "cosine",
          emitEvents: false,
          verboseEvents: false,
          partitionPolicy: "warn",
          maxUnpartitionedRecords: 1000,
          searchPageSize: 200,
        }) as unknown,
        "vector",
      );
      logger.info("Vector plugin installed for semantic context retrieval.");
    } catch (error) {
      logger.warn(`Vector plugin failed to install: ${String(error)}`);
    }
  }

  if (StateMachinePlugin) {
    const stateMachinePlugin = await stateDb.usePlugin(
      new StateMachinePlugin(issueStateMachineConfig) as unknown,
      "state-machine",
    ) as Record<string, unknown>;

    activeStateMachinePlugin = stateMachinePlugin as { stop?: () => Promise<void> };
    const bind = (method: unknown) => typeof method === "function" ? (method as Function).bind(stateMachinePlugin) : undefined;
    setIssueStateMachinePlugin({
      send: bind(stateMachinePlugin.send),
      getMachineDefinition: bind(stateMachinePlugin.getMachineDefinition),
      getState: bind(stateMachinePlugin.getState),
      initializeEntity: bind(stateMachinePlugin.initializeEntity),
      getValidEvents: bind(stateMachinePlugin.getValidEvents),
      getTransitionHistory: bind(stateMachinePlugin.getTransitionHistory),
      visualize: bind(stateMachinePlugin.visualize),
      waitForPendingEvents: bind(stateMachinePlugin.waitForPendingEvents),
    } as any);
  } else {
    logger.warn("StateMachinePlugin not available. Issue transitions will use local logic only.");
  }

  // ── Service State Machine Plugin ────────────────────────────────────────────
  if (StateMachinePlugin) {
    try {
      const serviceSmPlugin = await stateDb.usePlugin(
        new StateMachinePlugin(serviceStateMachineConfig) as unknown,
        "service-state-machine",
      ) as Record<string, unknown>;

      activeServiceStateMachinePlugin = serviceSmPlugin as { stop?: () => Promise<void> };
      logger.info("Service StateMachinePlugin installed.");
    } catch (error) {
      logger.warn(`Service StateMachinePlugin failed to install: ${String(error)}`);
    }
  }

  // ── Agent State Machine Plugin ──────────────────────────────────────────────
  if (StateMachinePlugin) {
    try {
      const { agentStateMachineConfig } = await import("./plugins/fsm-agent.ts");
      const agentSmPlugin = await stateDb.usePlugin(
        new StateMachinePlugin(agentStateMachineConfig) as unknown,
        "agent-state-machine",
      ) as Record<string, unknown>;

      activeAgentStateMachinePlugin = agentSmPlugin as { stop?: () => Promise<void> };
      logger.info("Agent StateMachinePlugin installed.");
    } catch (error) {
      logger.warn(`Agent StateMachinePlugin failed to install: ${String(error)}`);
    }
  }

  // EventualConsistency plugin for token usage analytics
  const { EventualConsistencyPlugin } = await loadS3dbModule();
  if (EventualConsistencyPlugin) {
    try {
      const ecPlugin = new EventualConsistencyPlugin({
        resources: {
          [S3DB_ISSUE_RESOURCE]: [
            // Per-model totals (dynamic keys: { "claude-sonnet-4-6": 12345, "o4-mini": 6789 })
            { field: "usage.tokens", fieldPath: "usage.tokens", initialValue: 0, cohort: { granularity: "day" } },
            // Overall volume
            { field: "tokenUsage.totalTokens", fieldPath: "tokenUsage.totalTokens", initialValue: 0, cohort: { granularity: "day" } },
            { field: "tokenUsage.inputTokens", fieldPath: "tokenUsage.inputTokens", initialValue: 0, cohort: { granularity: "day" } },
            { field: "tokenUsage.outputTokens", fieldPath: "tokenUsage.outputTokens", initialValue: 0, cohort: { granularity: "day" } },
            // Per-phase volume
            { field: "tokensByPhase.planner.totalTokens", fieldPath: "tokensByPhase.planner.totalTokens", initialValue: 0, cohort: { granularity: "day" } },
            { field: "tokensByPhase.executor.totalTokens", fieldPath: "tokensByPhase.executor.totalTokens", initialValue: 0, cohort: { granularity: "day" } },
            { field: "tokensByPhase.reviewer.totalTokens", fieldPath: "tokensByPhase.reviewer.totalTokens", initialValue: 0, cohort: { granularity: "day" } },
            // Event count (incremented on each addEvent call for this issue)
            { field: "eventsCount", fieldPath: "eventsCount", initialValue: 0, cohort: { granularity: "day" } },
            // Code churn (set at merge time, accumulated per day)
            { field: "linesAdded", fieldPath: "linesAdded", initialValue: 0, cohort: { granularity: "day" } },
            { field: "linesRemoved", fieldPath: "linesRemoved", initialValue: 0, cohort: { granularity: "day" } },
            { field: "filesChanged", fieldPath: "filesChanged", initialValue: 0, cohort: { granularity: "day" } },
          ],
        },
        enableAnalytics: true,
        analytics: { enabled: true },
        cohort: { granularity: "day", timezone: "UTC" },
        analyticsConfig: { rollupStrategy: "incremental", retentionDays: 90 },
        autoConsolidate: true,
        consolidationInterval: 30_000,
      });
      await stateDb.usePlugin(ecPlugin as unknown, "eventual-consistency");
      activeEcPlugin = ecPlugin as typeof activeEcPlugin;
      logger.info("EventualConsistency plugin installed for token usage analytics.");
    } catch (error) {
      logger.warn(`EventualConsistency plugin failed to install: ${String(error)}`);
    }
  }

  const [
    runtimeStateResourceName,
    issueResourceName,
    milestoneResourceName,
    issuePlanResourceName,
    eventResourceName,
    settingResourceName,
    agentSessionResourceName,
    agentPipelineResourceName,
    serviceResourceName,
    variablesResourceName,
    contextFragmentResourceName,
  ] = NATIVE_RESOURCE_NAMES;
  runtimeStateResource = await stateDb.getResource(runtimeStateResourceName);
  issueStateResource = await stateDb.getResource(issueResourceName);
  milestoneStateResource = await stateDb.getResource(milestoneResourceName);
  issuePlanResource = await stateDb.getResource(issuePlanResourceName);
  eventStateResource = await stateDb.getResource(eventResourceName);
  settingStateResource = await stateDb.getResource(settingResourceName);
  agentSessionResource = await stateDb.getResource(agentSessionResourceName);
  agentPipelineResource = await stateDb.getResource(agentPipelineResourceName);
  serviceResource = await stateDb.getResource(serviceResourceName);
  variablesResource = await stateDb.getResource(variablesResourceName);
  contextFragmentResource = await stateDb.getResource(contextFragmentResourceName || S3DB_CONTEXT_FRAGMENT_RESOURCE);

  // Capture resource.state API injected by StateMachinePlugin (resource-level shortcuts)
  if (issueStateResource && (issueStateResource as any).state) {
    const stateApi = (issueStateResource as any).state;
    setIssueResourceStateApi({
      send: stateApi.send?.bind(stateApi),
      get: stateApi.get?.bind(stateApi),
      canTransition: stateApi.canTransition?.bind(stateApi),
      history: stateApi.history?.bind(stateApi),
      initialize: stateApi.initialize?.bind(stateApi),
      getValidEvents: stateApi.getValidEvents?.bind(stateApi),
      delete: stateApi.delete?.bind(stateApi),
    });
    debugBoot("initStateStore:resource-state-api-bound");
  }

  // Capture service resource.state API injected by Service StateMachinePlugin
  if (serviceResource && (serviceResource as any).state) {
    const svcStateApi = (serviceResource as any).state;
    setServiceResourceStateApi({
      send: svcStateApi.send?.bind(svcStateApi),
      get: svcStateApi.get?.bind(svcStateApi),
      initialize: svcStateApi.initialize?.bind(svcStateApi),
    });
    debugBoot("initStateStore:service-resource-state-api-bound");
  }

  debugBoot("initStateStore:resources-ready");
}

export function isStateNotFoundError(error: unknown): boolean {
  if (error instanceof Error) {
    return /not found|does not exist|no such key/i.test(error.message);
  }
  if (typeof error === "string") {
    return /not found|does not exist|no such key/i.test(error);
  }
  return false;
}

export async function loadPersistedState(): Promise<RuntimeState | null> {
  if (!runtimeStateResource) {
    logger.debug("[Store] No runtime state resource available, skipping load");
    return null;
  }

  logger.debug("[Store] Loading persisted state from s3db");
  try {
    const record = await runtimeStateResource.get(S3DB_RUNTIME_RECORD_ID);
    if (record?.state && typeof record.state === "object") {
      const state = record.state as RuntimeState;
      if (Array.isArray(state.issues) && state.issues.length > 0) {
        // Hydrate current plans from the 1:N issue_plans resource
        // Plans are stored separately and excluded from issue records,
        // so the blob may have stale/missing plan data after restarts.
        for (const issue of state.issues) {
          try {
            const current = await getCurrentPlanForIssue(issue.id);
            if (current) {
              issue.plan = current.plan as IssueEntry["plan"];
            }
          } catch (err) {
            logger.warn({ issueId: issue.id, err: String(err) }, "[Store] Failed to hydrate plan on load");
          }
        }
        return state;
      }
      // State blob has no issues — try recovering from individual issue records
      logger.warn("Runtime state blob has no issues, attempting recovery from issue resource...");
    }
  } catch (error) {
    if (!isStateNotFoundError(error)) {
      logger.warn(`Could not load persisted state from s3db (will attempt issue recovery): ${String(error)}`);
    }
  }

  // Fallback: recover issues from individual s3db issue records
  return recoverStateFromIssueResource();
}

async function recoverStateFromIssueResource(): Promise<RuntimeState | null> {
  if (!issueStateResource) return null;

  try {
    const records = await (issueStateResource as any).list({ limit: 500 });
    if (!Array.isArray(records) || records.length === 0) return null;

    const issues = records
      .filter((r: any) => r?.id && r?.identifier && r?.state)
      .map((r: any) => r as RuntimeState["issues"][number]);

    if (issues.length === 0) return null;

    logger.info(`Recovered ${issues.length} issue(s) from s3db issue resource.`);

    // Hydrate current plan for each issue from the 1:N issue_plans resource
    for (const issue of issues) {
      try {
        const current = await getCurrentPlanForIssue(issue.id);
        if (current) {
          issue.plan = current.plan as IssueEntry["plan"];
          logger.debug({ issueId: issue.id, version: current.version }, "[Recovery] Hydrated current plan");
        }
      } catch (err) {
        logger.warn({ issueId: issue.id, err: String(err) }, "[Recovery] Failed to load plan");
      }
    }

    return {
      startedAt: now(),
      updatedAt: now(),
      trackerKind: "filesystem",
      sourceRepoUrl: "",
      sourceRef: "workspace",
      config: {} as any,
      milestones: [],
      issues,
      events: [],
      metrics: getMetrics(issues),
      notes: ["State recovered from individual issue records after corruption."],
      variables: [],
    };
  } catch (error) {
    logger.warn(`Failed to recover issues from s3db: ${String(error)}`);
    return null;
  }
}

export async function persistState(state: RuntimeState): Promise<void> {
  refreshMilestoneSummaries(state);
  state.metrics = {
    ...getMetrics(state.issues),
    activeWorkers: state.metrics.activeWorkers,
  };

  if (!runtimeStateResource) return;

  // Only write the runtime state blob if something changed
  const dirty = hasDirtyState();
  const dirtyIssueCount = getDirtyIssueIds().size;
  const dirtyMilestoneCount = getDirtyMilestoneIds().size;
  const dirtyEventCount = getDirtyEventIds().size;
  if (dirty || dirtyIssueCount > 0 || dirtyMilestoneCount > 0 || dirtyEventCount > 0) {
    logger.debug({ dirty, dirtyIssues: dirtyIssueCount, dirtyMilestones: dirtyMilestoneCount, dirtyEvents: dirtyEventCount }, "[Store] Persisting state");
  }

  if (dirty) {
    await runtimeStateResource.replace(S3DB_RUNTIME_RECORD_ID, {
      id: S3DB_RUNTIME_RECORD_ID,
      schemaVersion: S3DB_RUNTIME_SCHEMA_VERSION,
      trackerKind: "filesystem",
      runtimeTag: "local-only",
      updatedAt: now(),
      state,
    } satisfies RuntimeStateRecord);
  }

  const dirtyMilestones = milestoneStateResource ? snapshotAndClearDirtyMilestoneIds() : new Set<string>();
  if (milestoneStateResource && dirtyMilestones.size > 0) {
    for (const milestone of state.milestones) {
      if (!dirtyMilestones.has(milestone.id)) continue;
      const clean = {
        id: milestone.id,
        slug: milestone.slug,
        name: milestone.name,
        description: milestone.description,
        status: milestone.status,
        createdAt: milestone.createdAt,
        updatedAt: milestone.updatedAt,
      };
      try {
        await milestoneStateResource.replace(milestone.id, clean);
      } catch (error) {
        logger.warn(`Failed to persist milestone ${milestone.id}: ${String(error)}`);
      }
    }
  }

  // Snapshot dirty IDs before iterating to avoid losing IDs added during persist
  const dirtyIssues = issueStateResource ? snapshotAndClearDirtyIssueIds() : new Set<string>();
  if (issueStateResource && dirtyIssues.size > 0) {
    for (const issue of state.issues) {
      if (!dirtyIssues.has(issue.id)) continue;
      // s3db requires valid datetime or undefined — clean empty strings
      // Exclude plan/planHistory — those live in issue_plans resource
      const { plan: _plan, planHistory: _planHistory, ...issueCore } = issue;
      const clean = {
        ...issueCore,
        nextRetryAt: issue.nextRetryAt || undefined,
        startedAt: issue.startedAt || undefined,
        completedAt: issue.completedAt || undefined,
        workspacePreparedAt: issue.workspacePreparedAt || undefined,
        commandExitCode: typeof issue.commandExitCode === "number" ? issue.commandExitCode : undefined,
      };
      try {
        await issueStateResource.replace(issue.id, clean);
      } catch (error) {
        logger.warn(`Failed to persist issue ${issue.id}: ${String(error)}`);
      }
    }
  }

  // Plans are flushed immediately via savePlanForIssue() on generation — no dirty cycle needed.
  // Clear any stale dirty plan IDs from the tracker.
  snapshotAndClearDirtyIssuePlanIds();

  const dirtyEvents = eventStateResource ? snapshotAndClearDirtyEventIds() : new Set<string>();
  if (eventStateResource && dirtyEvents.size > 0) {
    for (const event of state.events) {
      if (!dirtyEvents.has(event.id)) continue;
      await eventStateResource.replace(event.id, event satisfies RuntimeEvent);
    }
  }

  // Push state to connected WebSocket clients
  broadcastToWebSocketClients({
    type: "state:update",
    metrics: state.metrics,
    milestones: state.milestones,
    issues: state.issues,
    events: state.events.slice(0, 50),
    updatedAt: state.updatedAt,
  });
}

/** Force persist all issues (used during boot and shutdown). */
export async function persistStateFull(state: RuntimeState): Promise<void> {
  markAllMilestonesDirty(state.milestones.map((milestone) => milestone.id));
  markAllIssuesDirty(state.issues.map((i) => i.id));
  markAllIssuePlansDirty(state.issues.map((i) => i.id));
  markAllEventsDirty(state.events.map((e) => e.id));
  await persistState(state);
}

export async function loadPersistedSettings(): Promise<RuntimeSettingRecord[]> {
  if (!settingStateResource?.list) return [];

  try {
    const records = await settingStateResource.list({ limit: 500 });
    return Array.isArray(records)
      ? records.filter((record): record is RuntimeSettingRecord =>
        Boolean(
          record &&
          typeof record.id === "string" &&
          typeof record.scope === "string",
        ),
      )
      : [];
  } catch (error) {
    logger.warn(`Failed to load persisted settings from s3db: ${String(error)}`);
    return [];
  }
}

export async function replacePersistedSetting(setting: RuntimeSettingRecord): Promise<void> {
  if (!settingStateResource) return;
  await settingStateResource.replace(setting.id, setting);
}

// ── Services resource helpers ────────────────────────────────────────────────

export async function loadPersistedServices(): Promise<ServiceEntry[]> {
  if (!serviceResource?.list) return [];
  try {
    const records = await serviceResource.list({ limit: 200 });
    return Array.isArray(records)
      ? records.filter((r): r is ServiceEntry =>
        Boolean(r && typeof r.id === "string" && typeof r.command === "string"),
      )
      : [];
  } catch (error) {
    logger.warn(`Failed to load services from s3db: ${String(error)}`);
    return [];
  }
}

export async function loadLegacyPersistedServices(): Promise<ServiceEntry[]> {
  if (!stateDb?.getResource) return [];
  try {
    const legacyResource = await stateDb.getResource("dev_servers");
    const records = await legacyResource?.list?.({ limit: 200 });
    return Array.isArray(records)
      ? records.filter((record): record is ServiceEntry =>
        Boolean(record && typeof record.id === "string" && typeof record.command === "string")
      )
      : [];
  } catch {
    return [];
  }
}

export async function replacePersistedService(entry: ServiceEntry): Promise<void> {
  if (!serviceResource) return;
  await serviceResource.replace(entry.id, { ...entry, updatedAt: now() });
}

export async function loadPersistedMilestones(): Promise<MilestoneEntry[]> {
  if (!milestoneStateResource?.list) return [];
  try {
    const records = await milestoneStateResource.list({ limit: 500 });
    return Array.isArray(records)
      ? records
        .map((record) => normalizeMilestone(record as Record<string, unknown>))
        .filter((milestone): milestone is MilestoneEntry => milestone !== null)
      : [];
  } catch (error) {
    logger.warn(`Failed to load milestones from s3db: ${String(error)}`);
    return [];
  }
}

export async function deletePersistedService(id: string): Promise<void> {
  if (!serviceResource) return;
  try { await (serviceResource as any).delete(id); } catch {}
}

export async function replaceAllServices(entries: ServiceEntry[]): Promise<void> {
  if (!serviceResource) return;
  const existing = await loadPersistedServices();
  const incomingIds = new Set(entries.map((e) => e.id));
  // Delete removed entries
  await Promise.all(
    existing.filter((e) => !incomingIds.has(e.id)).map((e) => deletePersistedService(e.id)),
  );
  // Upsert all current entries
  await Promise.all(entries.map((e) => replacePersistedService(e)));
}

// ── Variables resource helpers ───────────────────────────────────────────────

export async function loadPersistedVariables(): Promise<VariableEntry[]> {
  if (!variablesResource?.list) return [];
  try {
    const records = await variablesResource.list({ limit: 1000 });
    return Array.isArray(records)
      ? records.filter((r): r is VariableEntry =>
        Boolean(r && typeof r.id === "string" && typeof r.key === "string"),
      )
      : [];
  } catch (error) {
    logger.warn(`Failed to load variables from s3db: ${String(error)}`);
    return [];
  }
}

export async function upsertPersistedVariable(entry: VariableEntry): Promise<void> {
  if (!variablesResource) return;
  await variablesResource.replace(entry.id, { ...entry, updatedAt: now() });
}

export async function deletePersistedVariable(id: string): Promise<void> {
  if (!variablesResource) return;
  try { await (variablesResource as any).delete(id); } catch {}
}

/**
 * Query EC plugin for daily event counts (sum of eventsCount deltas per day).
 * Returns last N days as { date: "2026-03-18", events: 5 }[].
 */
export async function getEcDailyEvents(days = 90): Promise<Array<{ date: string; events: number }>> {
  if (!activeEcPlugin?.getLastNDays) return [];
  try {
    const raw = await activeEcPlugin.getLastNDays(S3DB_ISSUE_RESOURCE, "eventsCount", days);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((r: unknown) => {
        const rec = r as Record<string, unknown>;
        const date = (rec.date ?? rec.cohort ?? rec.key ?? "") as string;
        const events = Number(rec.total ?? rec.value ?? rec.sum ?? rec.count ?? 0);
        return { date: String(date).slice(0, 10), events };
      })
      .filter((e) => e.date && e.events > 0);
  } catch {
    return [];
  }
}

/**
 * Query EC plugin for daily code churn (linesAdded + linesRemoved + filesChanged per day).
 */
export async function getEcDailyLines(days = 90): Promise<Array<{ date: string; linesAdded: number; linesRemoved: number; filesChanged: number }>> {
  if (!activeEcPlugin?.getLastNDays) return [];
  try {
    const [addedRaw, removedRaw, filesRaw] = await Promise.all([
      activeEcPlugin.getLastNDays(S3DB_ISSUE_RESOURCE, "linesAdded", days),
      activeEcPlugin.getLastNDays(S3DB_ISSUE_RESOURCE, "linesRemoved", days),
      activeEcPlugin.getLastNDays(S3DB_ISSUE_RESOURCE, "filesChanged", days),
    ]);

    const toMap = (raw: unknown): Map<string, number> => {
      if (!Array.isArray(raw)) return new Map();
      return new Map(
        raw
          .map((r: unknown) => {
            const rec = r as Record<string, unknown>;
            const date = String(rec.date ?? rec.cohort ?? rec.key ?? "").slice(0, 10);
            const value = Number(rec.total ?? rec.value ?? rec.sum ?? rec.count ?? 0);
            return [date, value] as [string, number];
          })
          .filter(([date]) => date.length === 10),
      );
    };

    const addedMap = toMap(addedRaw);
    const removedMap = toMap(removedRaw);
    const filesMap = toMap(filesRaw);
    const allDates = new Set([...addedMap.keys(), ...removedMap.keys(), ...filesMap.keys()]);

    return Array.from(allDates)
      .map((date) => ({
        date,
        linesAdded: addedMap.get(date) ?? 0,
        linesRemoved: removedMap.get(date) ?? 0,
        filesChanged: filesMap.get(date) ?? 0,
      }))
      .filter((e) => e.linesAdded > 0 || e.linesRemoved > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

export async function closeStateStore(): Promise<void> {
  logger.info("[Store] Closing state store and plugins");
  clearApiRuntimeContext();

  try {
    const { stopQueueWorkers } = await import("./plugins/queue-workers.ts");
    await stopQueueWorkers();
  } catch (error) {
    logger.warn(`Failed to stop queue workers: ${String(error)}`);
  }

  if (activeEcPlugin?.stop) {
    try {
      await activeEcPlugin.stop();
    } catch (error) {
      logger.warn(`Failed to stop EventualConsistency plugin: ${String(error)}`);
    } finally {
      activeEcPlugin = null;
    }
  }
  if (activeServiceStateMachinePlugin?.stop) {
    try {
      await activeServiceStateMachinePlugin.stop();
    } catch (error) {
      logger.warn(`Failed to stop Service StateMachine plugin: ${String(error)}`);
    } finally {
      activeServiceStateMachinePlugin = null;
    }
  }
  if (activeAgentStateMachinePlugin?.stop) {
    try {
      await activeAgentStateMachinePlugin.stop();
    } catch (error) {
      logger.warn(`Failed to stop Agent StateMachine plugin: ${String(error)}`);
    } finally {
      activeAgentStateMachinePlugin = null;
    }
  }
  if (activeStateMachinePlugin?.stop) {
    try {
      await activeStateMachinePlugin.stop();
    } catch (error) {
      logger.warn(`Failed to stop StateMachine plugin: ${String(error)}`);
    } finally {
      activeStateMachinePlugin = null;
      setIssueStateMachinePlugin(null);
      setIssueResourceStateApi(null);
    }
  }
  if (activeWebSocketPlugin?.stop) {
    try {
      await activeWebSocketPlugin.stop();
    } catch (error) {
      logger.warn(`Failed to stop WebSocket plugin: ${String(error)}`);
    } finally {
      activeWebSocketPlugin = null;
    }
  }
  if (activeApiPlugin?.stop) {
    try {
      await activeApiPlugin.stop();
    } catch (error) {
      logger.warn(`Failed to stop API plugin: ${String(error)}`);
    } finally {
      activeApiPlugin = null;
    }
  }

  if (!stateDb) return;

  try {
    await stateDb.disconnect();
  } catch (error) {
    logger.warn(`Failed to close s3db runtime store: ${String(error)}`);
  } finally {
    stateDb = null;
    runtimeStateResource = null;
    issueStateResource = null;
    milestoneStateResource = null;
    issuePlanResource = null;
    eventStateResource = null;
    settingStateResource = null;
    agentSessionResource = null;
    agentPipelineResource = null;
  }
}
