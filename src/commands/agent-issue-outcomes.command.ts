import type { IssueEntry } from "../types.ts";
import type { IEventStore, IIssueRepository } from "../ports/index.ts";
import { transitionIssueCommand } from "./transition-issue.command.ts";

type OutcomeDeps = {
  issueRepository: IIssueRepository;
  eventStore: IEventStore;
};

export async function sendIssueToManualDecisionCommand(
  issue: IssueEntry,
  note: string,
  deps: OutcomeDeps,
): Promise<void> {
  await transitionIssueCommand({ issue, target: "PendingDecision", note }, deps);
}

export async function approveIssueAfterReviewCommand(
  issue: IssueEntry,
  note: string,
  deps: OutcomeDeps,
): Promise<void> {
  await transitionIssueCommand({ issue, target: "Approved", note }, deps);
}

export async function startIssueReviewCommand(
  issue: IssueEntry,
  note: string,
  deps: OutcomeDeps,
): Promise<void> {
  await transitionIssueCommand({ issue, target: "Reviewing", note }, deps);
}

export async function blockIssueForRetryCommand(
  issue: IssueEntry,
  note: string,
  deps: OutcomeDeps,
): Promise<void> {
  await transitionIssueCommand({ issue, target: "Blocked", note }, deps);
}

export async function cancelIssueFromAgentCommand(
  issue: IssueEntry,
  note: string,
  deps: OutcomeDeps,
): Promise<void> {
  await transitionIssueCommand({ issue, target: "Cancelled", note }, deps);
}
