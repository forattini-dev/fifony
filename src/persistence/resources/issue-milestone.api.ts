import { toStringValue } from "../../concerns/helpers.ts";
import { logger } from "../../concerns/logger.ts";
import { addEvent } from "../../domains/issues.ts";
import { findMilestone, refreshMilestoneSummaries } from "../../domains/milestones.ts";
import { markIssueDirty } from "../dirty-tracker.ts";
import type { RuntimeState, IssueEntry } from "../../types.ts";

type IssueMilestoneDeps = {
  persistState: (state: RuntimeState) => Promise<unknown>;
};

type ContextWithIssueParams = {
  req: {
    param: (name: string) => string | undefined;
    json: () => Promise<Record<string, unknown>>;
  };
};

function findIssue(state: RuntimeState, issueId: string): IssueEntry | undefined {
  return state.issues.find((issue) => issue.id === issueId || issue.identifier === issueId);
}

function parseIssueId(c: unknown): string | null {
  const value = (c as ContextWithIssueParams)?.req?.param?.("id");
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function assignIssueMilestoneForState(
  state: RuntimeState,
  c: unknown,
  deps: IssueMilestoneDeps,
): Promise<{ body: unknown; status?: number }> {
  const issueId = parseIssueId(c);
  if (!issueId) {
    return { status: 400, body: { ok: false, error: "Issue id is required." } };
  }

  const issue = findIssue(state, issueId);
  if (!issue) {
    return { status: 404, body: { ok: false, error: "Issue not found." } };
  }

  try {
    const payload = await (c as ContextWithIssueParams).req.json();
    const rawMilestoneId = toStringValue(payload.milestoneId);
    const nextMilestoneId = rawMilestoneId || undefined;
    if (nextMilestoneId && !findMilestone(state, nextMilestoneId)) {
      return { status: 404, body: { ok: false, error: "Milestone not found." } };
    }

    issue.milestoneId = nextMilestoneId;
    issue.updatedAt = new Date().toISOString();
    state.updatedAt = issue.updatedAt;
    markIssueDirty(issue.id);
    refreshMilestoneSummaries(state);
    addEvent(
      state,
      issue.id,
      "manual",
      nextMilestoneId
        ? `${issue.identifier} assigned to milestone ${nextMilestoneId}.`
        : `${issue.identifier} removed from its milestone.`,
    );
    await deps.persistState(state);
    return { body: { ok: true, issue } };
  } catch (error) {
    logger.error({ err: error, issueId }, "[API] Failed to update issue milestone");
    return { status: 400, body: { ok: false, error: error instanceof Error ? error.message : String(error) } };
  }
}
