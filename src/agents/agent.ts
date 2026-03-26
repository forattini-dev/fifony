/**
 * agent.ts — public entry point
 *
 * Re-exports the full agent API consumed by scheduler.ts, api-server.ts, and other modules.
 * Implementation is split across the following modules:
 *   directive-parser.ts   — output parsing, token extraction, directive normalization
 *   pid-manager.ts        — PID file management and process liveness checks
 *   workspace-diff.ts     — diff computation and changed-path inference
 *   workspace-merge.ts    — worktree commit, merge, path hydration, routing signals
 *   session-state.ts      — session/pipeline state load, persist, and snapshot helpers
 *   prompt-builder.ts     — prompt construction for sessions, turns, and providers
 *   command-executor.ts   — runCommandWithTimeout and runHook
 *   workspace-setup.ts    — workspace creation, git worktree, and cleanWorkspace
 *   domains/agents.ts                         — public agent FSM facade for dispatch and phase execution
 */

// ── Re-exports from directive-parser ──────────────────────────────────────
export { addTokenUsage, readAgentDirective, extractTokenUsage, tryParseJsonOutput } from "./directive-parser.ts";

// ── Re-exports from pid-manager ───────────────────────────────────────────
export { readAgentPid, isProcessAlive, cleanStalePidFile, isDaemonAlive, isDaemonSocketReady, readDaemonPid, readDaemonExit } from "./pid-manager.ts";
export type { AgentPidInfo, DaemonExitRecord } from "./pid-manager.ts";

// ── Re-exports from workspace-diff ────────────────────────────────────────
export { computeDiffStats, inferChangedWorkspacePaths, parseDiffStats } from "../domains/workspace.ts";

// ── Re-exports from workspace-merge ───────────────────────────────────────
export { mergeWorkspace, hydrateIssuePathsFromWorkspace, shouldSkipMergePath, ensureWorktreeCommitted } from "../domains/workspace.ts";
export type { MergeResult } from "../domains/workspace.ts";

// ── Re-exports from session-state ─────────────────────────────────────────
export {
  loadAgentPipelineState,
  loadAgentPipelineSnapshotForIssue,
  loadAgentSessionSnapshotsForIssue,
} from "./session-state.ts";

// ── Re-exports from prompt-builder ────────────────────────────────────────
export { buildPrompt, buildTurnPrompt, buildProviderBasePrompt } from "./prompt-builder.ts";

// ── Re-exports from command-executor ──────────────────────────────────────
export { runCommandWithTimeout, runHook, writeToDaemon, attachToDaemon } from "./command-executor.ts";

// ── Re-exports from workspace-setup ───────────────────────────────────────
export { cleanWorkspace, prepareWorkspace, createGitWorktree } from "../domains/workspace.ts";

// ── Re-exports from agent-pipeline ────────────────────────────────────────
export { runAgentPipeline, runAgentSession } from "./agent-pipeline.ts";

// ── Re-exports from agent-fsm facade ──────────────────────────────────────
export {
  runPlanningJob,
  runManagedExecuteJob as runExecutePhase,
  runManagedReviewJob as runReviewPhase,
  canDispatchManagedAgent as canDispatchAgent,
} from "../domains/agents.ts";

// ── Public functions consumed by queue-workers.ts / api-server.ts ────────

import type { IssueEntry } from "../types.ts";
import { isAgentStillRunning, isDaemonAlive } from "./pid-manager.ts";

export { isAgentStillRunning };

export function issueHasResumableSession(issue: IssueEntry): boolean {
  if (!issue.workspacePath || issue.state !== "Running") return false;
  // Only treat as resumable if the daemon or the bare process is actually alive.
  // An issue with a workspace path but a dead process is NOT resumable — it
  // should be caught by the stale check rather than bypassed.
  return isDaemonAlive(issue.workspacePath) || isAgentStillRunning(issue).alive;
}
