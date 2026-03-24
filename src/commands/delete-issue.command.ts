import type { IssueEntry, RuntimeState } from "../types.ts";
import { readAgentPid } from "../agents/pid-manager.ts";
import { cleanWorkspace } from "../domains/workspace.ts";
import { logger } from "../concerns/logger.ts";
import { getIssueStateResource } from "../persistence/store.ts";
import { getIssueResourceStateApi } from "../persistence/plugins/issue-state-machine.ts";

export type DeleteIssueInput = {
  issue: IssueEntry;
  state: RuntimeState;
};

/**
 * Hard-delete an issue: kill agent, clean workspace, remove from memory + s3db.
 */
export async function deleteIssueCommand(input: DeleteIssueInput): Promise<void> {
  const { issue, state } = input;

  // 1. Kill running agent process if one exists
  const pidInfo = issue.workspacePath ? readAgentPid(issue.workspacePath) : null;
  if (pidInfo) {
    try {
      process.kill(-pidInfo.pid, "SIGTERM");
      logger.info({ pid: pidInfo.pid, issueId: issue.id }, "[Delete] Sent SIGTERM to agent process group");
    } catch {
      try { process.kill(pidInfo.pid, "SIGTERM"); } catch {}
    }
  }

  // 2. Clean workspace/worktree
  try {
    await cleanWorkspace(issue.id, issue, state);
  } catch (error) {
    logger.warn({ issueId: issue.id, err: String(error) }, "[Delete] Workspace cleanup failed (continuing)");
  }

  // 3. Remove from in-memory state
  const idx = state.issues.findIndex((i) => i.id === issue.id);
  if (idx >= 0) state.issues.splice(idx, 1);

  // 4. Remove related events
  state.events = state.events.filter((e) => e.issueId !== issue.id);

  // 5. Delete FSM state
  try {
    const fsmApi = getIssueResourceStateApi();
    if (fsmApi?.delete) await fsmApi.delete(issue.id);
  } catch (error) {
    logger.debug({ issueId: issue.id, err: String(error) }, "[Delete] FSM state cleanup (non-critical)");
  }

  // 6. Delete from s3db persistence
  try {
    const resource = getIssueStateResource();
    if (resource && typeof (resource as any).delete === "function") {
      await (resource as any).delete(issue.id);
    }
  } catch (error) {
    logger.debug({ issueId: issue.id, err: String(error) }, "[Delete] s3db record cleanup (non-critical)");
  }

  logger.info({ issueId: issue.id, identifier: issue.identifier }, "[Delete] Issue deleted");
}
