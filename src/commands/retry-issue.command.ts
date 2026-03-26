import type { IssueEntry } from "../types.ts";
import type { IEventStore, IIssueRepository } from "../ports/index.ts";
import { TERMINAL_STATES } from "../concerns/constants.ts";
import { now } from "../concerns/helpers.ts";
import { assertPlanReadyForExecution, getPlanExecutionBlocker } from "../domains/contract-negotiation.ts";
import { requestReworkCommand } from "./request-rework.command.ts";
import { retryExecutionCommand } from "./retry-execution.command.ts";
import { transitionIssueCommand } from "./transition-issue.command.ts";

export type RetryIssueInput = {
  issue: IssueEntry;
  feedback?: string;
};

export async function retryIssueCommand(
  input: RetryIssueInput,
  deps: {
    issueRepository: IIssueRepository;
    eventStore: IEventStore;
  },
): Promise<void> {
  const { issue, feedback } = input;
  const note = feedback
    ? `Rework requested for ${issue.identifier}: ${feedback.slice(0, 200)}`
    : `Manual retry for ${issue.identifier}.`;

  if (TERMINAL_STATES.has(issue.state)) {
    await transitionIssueCommand({ issue, target: "Planning", note }, deps);
    if (issue.plan?.steps?.length && getPlanExecutionBlocker(issue) === null) {
      await transitionIssueCommand({ issue, target: "PendingApproval", note: "Existing plan found." }, deps);
      await transitionIssueCommand({ issue, target: "Queued", note: "Auto-queued after plan approval." }, deps);
    }
    deps.eventStore.addEvent(issue.id, "manual", `Manual retry requested for ${issue.id}.`);
    return;
  }

  if (issue.state === "Approved") {
    await transitionIssueCommand({ issue, target: "Planning", note }, deps);
    if (issue.plan?.steps?.length && getPlanExecutionBlocker(issue) === null) {
      await transitionIssueCommand({ issue, target: "PendingApproval", note: "Existing plan found." }, deps);
      await transitionIssueCommand({ issue, target: "Queued", note: "Auto-queued for rework." }, deps);
    }
    deps.eventStore.addEvent(issue.id, "manual", `Manual retry requested for ${issue.id}.`);
    return;
  }

  if (issue.state === "Blocked" && issue.lastFailedPhase === "review") {
    if (issue.checkpointStatus === "failed") {
      await retryExecutionCommand({ issue, note }, deps);
      return;
    }
    issue.lastError = undefined;
    issue.lastFailedPhase = undefined;
    await transitionIssueCommand({ issue, target: "Reviewing", note }, deps);
    deps.eventStore.addEvent(issue.id, "manual", `Manual retry requested for ${issue.id}.`);
    return;
  }

  if (issue.state === "Blocked") {
    await retryExecutionCommand({ issue, note }, deps);
    return;
  }

  if (issue.state === "Reviewing" || issue.state === "PendingDecision") {
    await requestReworkCommand(
      {
        issue,
        reviewerFeedback: feedback || issue.lastError || "Manual rework request.",
        note: `Manual rework requested for ${issue.identifier}.`,
        eventKind: "manual",
      },
      deps,
    );
    return;
  }

  if (issue.state === "PendingApproval") {
    assertPlanReadyForExecution(issue, "retry this issue");
    await transitionIssueCommand({ issue, target: "Queued", note }, deps);
    deps.eventStore.addEvent(issue.id, "manual", `Manual retry requested for ${issue.id}.`);
    return;
  }

  issue.lastError = undefined;
  issue.nextRetryAt = undefined;
  issue.updatedAt = now();
  deps.eventStore.addEvent(issue.id, "manual", `Manual retry requested for ${issue.id}.`);
}
