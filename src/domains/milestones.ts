import type {
  IssueEntry,
  JsonRecord,
  MilestoneEntry,
  MilestoneProgressSummary,
  MilestoneStatus,
  RuntimeState,
} from "../types.ts";
import { now, toStringValue } from "../concerns/helpers.ts";
import { COMPLETED_STATES } from "../concerns/constants.ts";

export function slugifyMilestoneName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "milestone";
}

export function normalizeMilestone(raw: JsonRecord): MilestoneEntry | null {
  const id = toStringValue(raw.id, "");
  if (!id) return null;

  const createdAt = toStringValue(raw.createdAt, now());
  const updatedAt = toStringValue(raw.updatedAt, createdAt);
  const name = toStringValue(raw.name, "").trim();
  if (!name) return null;

  return {
    id,
    slug: toStringValue(raw.slug, slugifyMilestoneName(name)),
    name,
    description: toStringValue(raw.description) || undefined,
    status: normalizeMilestoneStatus(raw.status),
    createdAt,
    updatedAt,
    progress: { scopeCount: 0, completedCount: 0, progressPercent: 0 },
    issueCount: 0,
  };
}

export function normalizeMilestoneStatus(value: unknown): MilestoneStatus {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === "planned"
    || normalized === "active"
    || normalized === "paused"
    || normalized === "done"
    || normalized === "cancelled"
    ? normalized
    : "planned";
}

export function createMilestoneFromPayload(payload: JsonRecord): MilestoneEntry {
  const createdAt = now();
  const name = toStringValue(payload.name, "").trim();
  if (!name) {
    throw new Error("Milestone name is required.");
  }

  return {
    id: toStringValue(payload.id, `milestone-${crypto.randomUUID()}`),
    slug: toStringValue(payload.slug, slugifyMilestoneName(name)),
    name,
    description: toStringValue(payload.description) || undefined,
    status: normalizeMilestoneStatus(payload.status),
    createdAt,
    updatedAt: createdAt,
    progress: { scopeCount: 0, completedCount: 0, progressPercent: 0 },
    issueCount: 0,
  };
}

export function findMilestone(state: RuntimeState, milestoneId: string): MilestoneEntry | undefined {
  return state.milestones.find((milestone) => milestone.id === milestoneId || milestone.slug === milestoneId);
}

export function deriveMilestoneProgressSummary(issues: IssueEntry[]): MilestoneProgressSummary {
  const scopedIssues = issues.filter((issue) => issue.state !== "Cancelled" && issue.state !== "Archived");
  const completedCount = scopedIssues.filter((issue) => COMPLETED_STATES.has(issue.state) && issue.state !== "Cancelled" && issue.state !== "Archived").length;
  const scopeCount = scopedIssues.length;
  return {
    scopeCount,
    completedCount,
    progressPercent: scopeCount === 0 ? 0 : Math.floor((completedCount / scopeCount) * 100),
  };
}

export function refreshMilestoneSummaries(state: RuntimeState): void {
  state.milestones = state.milestones.map((milestone) => {
    const linkedIssues = state.issues.filter((issue) => issue.milestoneId === milestone.id);
    return {
      ...milestone,
      progress: deriveMilestoneProgressSummary(linkedIssues),
      issueCount: linkedIssues.length,
    };
  });
}
