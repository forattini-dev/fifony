import type { IssueEntry, PolicyDecision } from "../types.ts";
import { markIssueDirty } from "../persistence/dirty-tracker.ts";

export function recordPolicyDecision(issue: IssueEntry, decision: PolicyDecision): PolicyDecision {
  const existing = Array.isArray(issue.policyDecisions) ? issue.policyDecisions : [];
  const next = [...existing];
  const index = next.findIndex((entry) => entry.id === decision.id);
  if (index >= 0) {
    next[index] = decision;
  } else {
    next.push(decision);
  }

  next.sort((left, right) => {
    const leftAt = Date.parse(left.recordedAt);
    const rightAt = Date.parse(right.recordedAt);
    if (!Number.isNaN(leftAt) && !Number.isNaN(rightAt) && leftAt !== rightAt) return rightAt - leftAt;
    return right.id.localeCompare(left.id);
  });

  issue.policyDecisions = next;
  markIssueDirty(issue.id);
  return decision;
}
