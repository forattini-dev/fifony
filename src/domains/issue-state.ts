import type { IssueEntry, IssueState } from "../types.ts";
import { now } from "../concerns/helpers.ts";
import {
  findIssueStateMachineTransitionPath,
  getIssueResourceStateApi,
  getIssueStateMachinePlugin,
  getIssueTransitionHistory,
  getStateMachineTransitions,
  ISSUE_STATE_MACHINE_ID,
  visualizeStateMachine,
} from "../persistence/plugins/fsm-issue.ts";
import { markIssueDirty } from "../persistence/dirty-tracker.ts";

export type IssueStateReconcileResult = {
  changed: boolean;
  previousState: IssueState;
  currentState: IssueState;
};

export type IssueStateSyncOptions = {
  reason?: string;
};

export function syncIssueStateInMemory(
  issue: IssueEntry,
  targetState: IssueState,
  options: IssueStateSyncOptions = {},
): IssueStateReconcileResult {
  const previousState = issue.state;
  if (previousState === targetState) {
    return {
      changed: false,
      previousState,
      currentState: issue.state,
    };
  }

  issue.state = targetState;
  issue.updatedAt = now();
  issue.history.push(
    `[${issue.updatedAt}] ${options.reason ?? `Issue state synchronized in memory from ${previousState} to ${targetState}.`}`,
  );
  markIssueDirty(issue.id);

  return {
    changed: true,
    previousState,
    currentState: targetState,
  };
}

export async function syncIssueStateFromFsm(
  issue: IssueEntry,
  options: IssueStateSyncOptions = {},
): Promise<IssueStateReconcileResult> {
  const sourceState = await getIssueStateMachineState(issue.id);
  if (!sourceState) {
    return {
      changed: false,
      previousState: issue.state,
      currentState: issue.state,
    };
  }

  return syncIssueStateInMemory(issue, sourceState, {
    reason: options.reason ?? `Issue state synchronized from FSM source of truth to ${sourceState}.`,
  });
}

export function getIssueStateMachineTransitions(): Record<string, string[]> {
  return getStateMachineTransitions();
}

export function getIssueStateMachineVisualization(): string | null {
  return visualizeStateMachine();
}

export async function getIssueTransitionHistoryForIssue(
  issueId: string,
  options?: { limit?: number; offset?: number },
): Promise<unknown[]> {
  return getIssueTransitionHistory(issueId, options);
}

export function getIssueStateMachineTransitionPath(
  currentState: string,
  targetState: string,
): string[] | null {
  return findIssueStateMachineTransitionPath(null, currentState, targetState);
}

export async function getIssueStateMachineState(issueId: string): Promise<IssueState | null> {
  const plugin = getIssueStateMachinePlugin();
  if (!plugin?.getState) return null;

  try {
    const state = await plugin.getState(ISSUE_STATE_MACHINE_ID, issueId);
    if (typeof state === "string") {
      return state as IssueState;
    }
  } catch {
    return null;
  }

  return null;
}

export async function deleteIssueStateMachineResourceState(issueId: string): Promise<boolean> {
  const fsmApi = getIssueResourceStateApi();
  if (!fsmApi?.delete) return false;

  await fsmApi.delete(issueId);
  return true;
}
