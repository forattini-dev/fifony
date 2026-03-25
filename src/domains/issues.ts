import { markIssueDirty, markEventDirty } from "../persistence/dirty-tracker.ts";
import { recordEvent as recordLedgerEvent } from "./tokens.ts";
import type {
  IssueEntry,
  IssueState,
  JsonRecord,
  RuntimeConfig,
  RuntimeEvent,
  RuntimeEventType,
  RuntimeState,
} from "../types.ts";
import {
  executeTransition,
} from "../persistence/plugins/issue-state-machine.ts";
import {
  PERSIST_EVENTS_MAX,
  TERMINAL_STATES,
  TARGET_ROOT,
} from "../concerns/constants.ts";
import type { ProjectMetadata } from "./project.ts";
import { resolveProjectMetadata } from "./project.ts";
import {
  now,
  isoWeek,
  toStringValue,
  toNumberValue,
  toBooleanValue,
  toStringArray,
  clamp,
  normalizeState,
  parseIssueState,
  withRetryBackoff,
} from "../concerns/helpers.ts";
import { logger } from "../concerns/logger.ts";
import { parseEffortConfig } from "./config.ts";
import { computeMetrics as _computeMetrics } from "./metrics.ts";

export { computeMetrics } from "./metrics.ts";
export { deriveConfig, applyWorkflowConfig, validateConfig } from "./config.ts";

export function normalizeIssue(
  raw: JsonRecord,
): IssueEntry | null {
  const id = toStringValue(raw.id, "");
  if (!id) return null;

  const createdAt = toStringValue(raw.createdAt, now());
  const updatedAt = toStringValue(raw.updatedAt, createdAt);
  const issue: IssueEntry = {
    id,
    identifier: toStringValue(raw.identifier, id),
    title: toStringValue(raw.title, `Issue ${id}`),
    description: toStringValue(raw.description, ""),
    state: normalizeState(raw.state, raw.plan && typeof raw.plan === "object" ? "PendingApproval" : "Planning"),
    branchName: toStringValue(raw.branchName),
    url: toStringValue(raw.url),
    assigneeId: toStringValue(raw.assigneeId),
    labels: toStringArray(raw.labels),
    paths: toStringArray(raw.paths),
    blockedBy: toStringArray(raw.blockedBy),
    assignedToWorker: toBooleanValue(raw.assignedToWorker, true),
    createdAt,
    updatedAt,
    history: [],
    attempts: toNumberValue(raw.attempts, 0),
    maxAttempts: toNumberValue(raw.maxAttempts, 3),
    nextRetryAt: toStringValue(raw.nextRetryAt),
    planVersion: 0,
    executeAttempt: 0,
    reviewAttempt: 0,
    planHistory: [],
  };

  return issue;
}

export function nextLocalIssueId(issues: IssueEntry[]): string {
  const maxId = issues.reduce((current, issue) => {
    const match = issue.identifier.match(/^#(\d+)$/);
    if (!match) return current;
    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) ? Math.max(current, parsed) : current;
  }, 0);

  return `#${maxId + 1}`;
}

export function createIssueFromPayload(
  payload: JsonRecord,
  issues: IssueEntry[],
  defaultBranch?: string,
): IssueEntry {
  const identifier = toStringValue(payload.identifier, nextLocalIssueId(issues));
  const id = toStringValue(payload.id, identifier.replace(/^#/, "issue-"));
  logger.info({ id, identifier, title: toStringValue(payload.title, "").slice(0, 80) }, "[Issues] Creating new issue");
  const createdAt = now();
  const blockedBy = toStringArray(payload.blockedBy);
  const paths = toStringArray(payload.paths);
  const images = toStringArray(payload.images);
  const initialState = parseIssueState(payload.state) ?? (payload.plan ? "PendingApproval" : "Planning");

  const issue: IssueEntry = {
    id,
    identifier,
    title: toStringValue(payload.title, `Issue ${identifier}`),
    description: toStringValue(payload.description, ""),
    state: initialState,
    branchName: toStringValue(payload.branchName),
    baseBranch: toStringValue(payload.baseBranch) || defaultBranch,
    url: toStringValue(payload.url),
    assigneeId: toStringValue(payload.assigneeId),
    labels: toStringArray(payload.labels),
    paths,
    blockedBy,
    assignedToWorker: true,
    createdAt,
    updatedAt: createdAt,
    history: [`[${createdAt}] Issue created via API.`],
    attempts: 0,
    maxAttempts: clamp(toNumberValue(payload.maxAttempts, 3), 1, 10),
    terminalWeek: "",
    images: images.length ? images : undefined,
    issueType: toStringValue(payload.issueType) || undefined,
    effort: parseEffortConfig(payload.effort),
    plan: payload.plan && typeof payload.plan === "object" ? payload.plan as IssueEntry["plan"] : undefined,
    planVersion: payload.plan ? 1 : 0,
    executeAttempt: 0,
    reviewAttempt: 0,
    planHistory: [],
  };

  // If plan provides suggestions, apply them
  if (issue.plan) {
    if (issue.plan.suggestedPaths?.length && !issue.paths?.length) {
      issue.paths = issue.plan.suggestedPaths;
    }
    if (issue.plan.suggestedEffort && !issue.effort) {
      issue.effort = issue.plan.suggestedEffort;
    }
  }

  return issue;
}

export function dedupHistoryEntries(issues: IssueEntry[]): void {
  for (const issue of issues) {
    const seen = new Set<string>();
    issue.history = issue.history.filter((entry) => {
      const key = entry.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

export function buildRuntimeState(
  previous: RuntimeState | null,
  config: RuntimeConfig,
  projectMetadata: ProjectMetadata = resolveProjectMetadata([], TARGET_ROOT),
): RuntimeState {
  const mergedIssues = (previous?.issues ?? []).reduce<IssueEntry[]>((issues, rawIssue) => {
      if (!rawIssue || typeof rawIssue !== "object") return issues;

      const existing = rawIssue as IssueEntry;
      issues.push({
        ...existing,
        id: toStringValue(existing.id, ""),
        identifier: toStringValue(existing.identifier, existing.id),
        title: toStringValue(existing.title, `Issue ${toStringValue(existing.identifier, existing.id)}`),
        description: toStringValue(existing.description, ""),
        state: normalizeState(existing.state, existing.plan ? "PendingApproval" : "Planning"),
        paths: toStringArray(existing.paths),
        labels: toStringArray(existing.labels),
        blockedBy: toStringArray(existing.blockedBy),
        history: Array.isArray(existing.history) ? existing.history : [],
        attempts: clamp(toNumberValue(existing.attempts, 0), 0, config.maxAttemptsDefault),
        maxAttempts: clamp(toNumberValue(existing.maxAttempts, config.maxAttemptsDefault), 1, config.maxAttemptsDefault),
        nextRetryAt: toStringValue(existing.nextRetryAt),
        updatedAt: toStringValue(existing.updatedAt, now()),
        createdAt: toStringValue(existing.createdAt, now()),
        planVersion: toNumberValue(existing.planVersion, existing.plan ? 1 : 0),
        executeAttempt: toNumberValue(existing.executeAttempt, toNumberValue(existing.attempts, 0)),
        reviewAttempt: toNumberValue(existing.reviewAttempt, toNumberValue(existing.attempts, 0)),
        planHistory: Array.isArray(existing.planHistory) ? existing.planHistory : [],
      });
      return issues;
    }, [])
    .filter((issue) => issue.id);

  // Backfill terminalWeek for existing terminal issues that don't have it
  for (const issue of mergedIssues) {
    if (TERMINAL_STATES.has(issue.state) && !issue.terminalWeek) {
      issue.terminalWeek = isoWeek(issue.completedAt || issue.updatedAt);
    } else if (!TERMINAL_STATES.has(issue.state)) {
      issue.terminalWeek = "";
    }
  }

  dedupHistoryEntries(mergedIssues);

  const metrics = _computeMetrics(mergedIssues);

  return {
    startedAt: previous?.startedAt ?? now(),
    updatedAt: now(),
    trackerKind: "filesystem",
    sourceRepoUrl: TARGET_ROOT,
    sourceRef: "workspace",
    projectName: projectMetadata.projectName,
    detectedProjectName: projectMetadata.detectedProjectName,
    projectNameSource: projectMetadata.projectNameSource,
    queueTitle: projectMetadata.queueTitle,
    config: {
      ...config,
      dashboardPort: previous?.config.dashboardPort,
    },
    issues: mergedIssues,
    events: previous?.events ?? [],
    metrics,
    notes: previous?.notes ?? [
      "Local TypeScript runtime bootstrapped.",
      "Codex-only execution path enabled.",
      "No external tracker dependency (filesystem-backed local mode).",
    ],
  };
}

export function addEvent(
  state: RuntimeState,
  issueId: string | undefined,
  kind: RuntimeEventType,
  message: string,
): void {
  const event: RuntimeEvent = {
    id: `${Date.now()}-${state.events.length + 1}`,
    issueId,
    kind,
    message,
    at: now(),
  };

  state.events = [event, ...state.events].slice(0, PERSIST_EVENTS_MAX);
  markEventDirty(event.id);

  // Track event in daily ledger for analytics sparkline
  try { recordLedgerEvent(); } catch { /* non-critical */ }

  // Increment per-issue event counter (tracked by EventualConsistency plugin for daily analytics)
  if (issueId) {
    const issue = state.issues.find((i) => i.id === issueId);
    if (issue) {
      issue.eventsCount = (issue.eventsCount || 0) + 1;
      markIssueDirty(issue.id);
    }
  }

  logger.info({ issueId, kind }, message);
}

/**
 * Transition an issue via the unified FSM. This is the single public API.
 * The plugin handles guards, entry actions, dirty tracking, events, and enqueue.
 */
export async function transitionIssue(
  issue: IssueEntry,
  event: string,
  context: Record<string, unknown> = {},
): Promise<void> {
  logger.debug({ issueId: issue.id, identifier: issue.identifier, from: issue.state, event, context }, "[State] Issue transition");
  await executeTransition(issue, event, { ...context, issue });
}

export function issueDependenciesResolved(issue: IssueEntry, allIssues: IssueEntry[]): boolean {
  if (issue.blockedBy.length === 0) return true;
  const map = new Map(allIssues.map((entry) => [entry.id, entry]));
  return issue.blockedBy.every((dependencyId) => {
    const dep = map.get(dependencyId);
    return dep?.state === "Approved" || dep?.state === "Merged";
  });
}

export function getNextRetryAt(issue: IssueEntry, baseMs: number): string {
  const nextAttempt = issue.attempts + 1;
  const nextDelay = withRetryBackoff(nextAttempt, baseMs);
  return new Date(Date.now() + nextDelay).toISOString();
}
