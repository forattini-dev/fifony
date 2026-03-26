import type { IssueEntry, IssueState } from "../types.ts";
import { transitionIssue } from "../domains/issues.ts";
import {
  syncIssueStateFromFsm,
  getIssueStateMachineTransitionPath,
} from "../domains/issue-state.ts";
import { logger } from "../concerns/logger.ts";

export type TransitionIssueInput = {
  issue: IssueEntry;
  target: IssueState;
  note: string;
};

type TransitionIssueDeps = {
  [key: string]: unknown;
};

/**
 * THE SINGLE WAY to transition an issue's state from commands/callers.
 * Queries the FSM for the real current state, finds the event path, then sends each event.
 */
export async function transitionIssueCommand(
  input: TransitionIssueInput,
  _deps?: TransitionIssueDeps,
): Promise<void> {
  const { issue, target, note } = input;

  // Resolve source-of-truth FSM state and reconcile in-memory entry if stale.
  let currentState = issue.state;
  const syncResult = await syncIssueStateFromFsm(issue, {
    reason: "Transition command reconciled issue state from FSM source of truth.",
  });
  if (syncResult.changed) {
    logger.debug(
      {
        issueId: issue.id,
        memoryState: syncResult.previousState,
        fsmState: syncResult.currentState,
      },
      "[Transition] Syncing stale in-memory state with FSM",
    );
    currentState = syncResult.currentState;
  }

  if (currentState === target) return;

  const path = getIssueStateMachineTransitionPath(currentState, target);
  if (!path || path.length === 0) {
    throw new Error(`State machine does not allow transition from '${currentState}' to '${target}' for issue ${issue.id}.`);
  }

  for (const event of path) {
    await transitionIssue(issue, event, { note });
  }
}
