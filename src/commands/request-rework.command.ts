import type { IssueEntry, RuntimeEventType } from "../types.ts";
import type { IIssueRepository, IEventStore } from "../ports/index.ts";
import { transitionIssueCommand } from "./transition-issue.command.ts";

export type RequestReworkInput = {
  issue: IssueEntry;
  /** Raw reviewer output — archived so onEnterQueued can analyze it */
  reviewerFeedback: string;
  /** Human-readable event message. If omitted, a default reviewer message is emitted. */
  note?: string;
  eventKind?: RuntimeEventType;
};

/**
 * Reviewer-requested rework: send the issue back for re-execution.
 *
 * Semantics: the reviewer found issues with the current execution and
 * wants the agent to try again, informed by the review feedback.
 * - Sets `lastFailedPhase = "review"` so AttemptSummary is tagged correctly
 * - Captures reviewer feedback as `lastError` for failure-analyzer to parse
 * - Lets the FSM increment `attempts` on the `REQUEUE` transition
 * - Transitions Reviewing/PendingDecision → Queued via PendingDecision intermediate
 *   (FSM onEnterQueued archives the failure into `previousAttemptSummaries`)
 *
 * For retrying from Blocked state, use `retryExecutionCommand` instead.
 * For re-planning, use `replanIssueCommand` instead.
 */
export async function requestReworkCommand(
  input: RequestReworkInput,
  deps: {
    issueRepository: IIssueRepository;
    eventStore: IEventStore;
  },
): Promise<void> {
  const { issue, reviewerFeedback, note, eventKind } = input;

  if (issue.state !== "Reviewing" && issue.state !== "PendingDecision") {
    throw new Error(
      `requestReworkCommand requires Reviewing or PendingDecision state, got ${issue.state}.`,
    );
  }

  const archivalFeedback = reviewerFeedback.trim()
    || note?.trim()
    || issue.lastError
    || "Manual rework request.";

  // Tag the failure for structured archival
  issue.lastError = archivalFeedback;
  issue.lastFailedPhase = "review";

  // Reviewing → PendingDecision (intermediate) → Queued
  if (issue.state === "Reviewing") {
    await transitionIssueCommand(
      { issue, target: "PendingDecision", note: `Reviewer completed for ${issue.identifier}.` },
      deps,
    );
  }

  await transitionIssueCommand(
    { issue, target: "Queued", note: archivalFeedback },
    deps,
  );
  // FSM onEnterQueued handles: archive previousAttemptSummaries with phase="review", clear lastError/nextRetryAt, enqueue

  deps.eventStore.addEvent(
    issue.id,
    eventKind ?? "runner",
    note ?? `Issue ${issue.identifier} sent back for rework by reviewer.`,
  );
}
