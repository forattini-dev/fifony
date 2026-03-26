import type { IssueEntry } from "../types.ts";

export function requiresContractNegotiation(issue: Pick<IssueEntry, "plan">): boolean {
  return issue.plan?.harnessMode === "contractual";
}

export function isContractNegotiationApproved(
  issue: Pick<IssueEntry, "plan" | "contractNegotiationStatus">,
): boolean {
  return !requiresContractNegotiation(issue) || issue.contractNegotiationStatus === "approved";
}

export function needsContractNegotiationWork(
  issue: Pick<IssueEntry, "plan" | "contractNegotiationStatus">,
): boolean {
  return requiresContractNegotiation(issue)
    && issue.contractNegotiationStatus !== "approved"
    && issue.contractNegotiationStatus !== "failed";
}

export function getPlanExecutionBlocker(issue: Pick<IssueEntry, "identifier" | "plan" | "planningStatus" | "contractNegotiationStatus">): string | null {
  if (issue.planningStatus === "planning") {
    return `Cannot advance ${issue.identifier} while planning is still running.`;
  }

  if (!issue.plan?.steps?.length) {
    return `Cannot advance ${issue.identifier} because no execution plan is available yet.`;
  }

  if (!requiresContractNegotiation(issue)) return null;

  if (issue.contractNegotiationStatus === "running") {
    return `Cannot advance ${issue.identifier} while contract negotiation is still running.`;
  }

  if (issue.contractNegotiationStatus !== "approved") {
    const status = issue.contractNegotiationStatus ?? "pending";
    return `Cannot advance ${issue.identifier} because contractual harness requires approved contract negotiation. Current status: ${status}.`;
  }

  return null;
}

export function assertPlanReadyForExecution(
  issue: Pick<IssueEntry, "identifier" | "plan" | "planningStatus" | "contractNegotiationStatus">,
  action: string,
): void {
  const blocker = getPlanExecutionBlocker(issue);
  if (!blocker) return;
  throw new Error(`${blocker} Refine, replan, or wait for negotiation before trying to ${action}.`);
}
