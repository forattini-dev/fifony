import type {
  GradingReport,
  IssueEntry,
  ReviewFailureRecord,
  ReviewRun,
  ReviewScope,
} from "../types.ts";

export type ReviewFailurePattern = {
  criterionId: string;
  description: string;
  category: ReviewFailureRecord["category"];
  blocking: boolean;
  count: number;
  attempts: number[];
  scopes: ReviewScope[];
  latestEvidence: string;
  latestRecordedAt: string;
};

type CollectFailurePatternOptions = {
  scope?: ReviewScope;
  blockingOnly?: boolean;
  currentPlanVersionOnly?: boolean;
  minOccurrences?: number;
  limit?: number;
};

function sortFailureHistory(history: ReviewFailureRecord[]): ReviewFailureRecord[] {
  return [...history].sort((left, right) => {
    const leftAt = Date.parse(left.recordedAt);
    const rightAt = Date.parse(right.recordedAt);
    if (!Number.isNaN(leftAt) && !Number.isNaN(rightAt) && leftAt !== rightAt) return rightAt - leftAt;
    return left.id.localeCompare(right.id);
  });
}

export function recordReviewFailures(
  issue: IssueEntry,
  reviewRun: ReviewRun | null,
  gradingReport: GradingReport | null,
  recordedAt: string,
): ReviewFailureRecord[] {
  if (!reviewRun || !gradingReport) return issue.reviewFailureHistory ?? [];

  const failedCriteria = gradingReport.criteria.filter((criterion) => criterion.result === "FAIL");
  if (failedCriteria.length === 0) return issue.reviewFailureHistory ?? [];

  const existing = Array.isArray(issue.reviewFailureHistory) ? issue.reviewFailureHistory : [];
  const next = [...existing];

  for (const criterion of failedCriteria) {
    const record: ReviewFailureRecord = {
      id: `${reviewRun.id}:${criterion.id}`,
      runId: reviewRun.id,
      scope: reviewRun.scope,
      planVersion: reviewRun.planVersion ?? (issue.planVersion ?? 1),
      attempt: reviewRun.attempt ?? gradingReport.reviewAttempt ?? 1,
      criterionId: criterion.id,
      description: criterion.description,
      category: criterion.category,
      verificationMethod: criterion.verificationMethod,
      blocking: criterion.blocking,
      weight: criterion.weight,
      evidence: criterion.evidence,
      recordedAt,
      reviewProfile: reviewRun.reviewProfile?.primary,
      routing: reviewRun.routing,
    };

    const existingIndex = next.findIndex((entry) => entry.id === record.id);
    if (existingIndex >= 0) {
      next[existingIndex] = record;
    } else {
      next.push(record);
    }
  }

  issue.reviewFailureHistory = sortFailureHistory(next);
  return issue.reviewFailureHistory;
}

export function collectRecurringFailurePatterns(
  issue: IssueEntry,
  options: CollectFailurePatternOptions = {},
): ReviewFailurePattern[] {
  const {
    scope,
    blockingOnly = false,
    currentPlanVersionOnly = false,
    minOccurrences = 2,
    limit = 6,
  } = options;
  const currentPlanVersion = issue.planVersion ?? 1;
  const history = (issue.reviewFailureHistory ?? []).filter((entry) => {
    if (scope && entry.scope !== scope) return false;
    if (blockingOnly && !entry.blocking) return false;
    if (currentPlanVersionOnly && entry.planVersion !== currentPlanVersion) return false;
    return true;
  });

  const patterns = new Map<string, ReviewFailurePattern>();
  for (const entry of history) {
    const key = `${entry.scope}:${entry.criterionId}`;
    const existing = patterns.get(key);
    if (!existing) {
      patterns.set(key, {
        criterionId: entry.criterionId,
        description: entry.description,
        category: entry.category,
        blocking: entry.blocking,
        count: 1,
        attempts: [entry.attempt],
        scopes: [entry.scope],
        latestEvidence: entry.evidence,
        latestRecordedAt: entry.recordedAt,
      });
      continue;
    }

    existing.count += 1;
    if (!existing.attempts.includes(entry.attempt)) existing.attempts.push(entry.attempt);
    if (!existing.scopes.includes(entry.scope)) existing.scopes.push(entry.scope);
    if (Date.parse(entry.recordedAt) >= Date.parse(existing.latestRecordedAt)) {
      existing.latestEvidence = entry.evidence;
      existing.latestRecordedAt = entry.recordedAt;
    }
  }

  return [...patterns.values()]
    .filter((pattern) => pattern.count >= minOccurrences)
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return right.latestRecordedAt.localeCompare(left.latestRecordedAt);
    })
    .slice(0, limit);
}

export function findRecurringBlockingFailures(
  issue: IssueEntry,
  gradingReport: GradingReport,
  scope: ReviewScope,
  minOccurrences = 2,
): ReviewFailurePattern[] {
  const currentBlockingIds = new Set(
    gradingReport.criteria
      .filter((criterion) => criterion.result === "FAIL" && criterion.blocking)
      .map((criterion) => criterion.id),
  );
  if (currentBlockingIds.size === 0) return [];

  return collectRecurringFailurePatterns(issue, {
    scope,
    blockingOnly: true,
    currentPlanVersionOnly: true,
    minOccurrences,
    limit: currentBlockingIds.size,
  }).filter((pattern) => currentBlockingIds.has(pattern.criterionId));
}

export function buildRecurringFailureContext(
  issue: IssueEntry,
  scope?: ReviewScope,
): string {
  const patterns = collectRecurringFailurePatterns(issue, {
    scope,
    currentPlanVersionOnly: true,
    minOccurrences: 2,
    limit: 5,
  });
  if (patterns.length === 0) return "";

  const lines = ["## Recurring Reviewer Failures", ""];
  lines.push("The reviewer has already flagged these patterns more than once. Treat them as the highest-priority risks before asking for another review.", "");
  for (const pattern of patterns) {
    const attemptLabel = pattern.attempts.length > 0
      ? `attempts ${pattern.attempts.sort((a, b) => a - b).join(", ")}`
      : "multiple attempts";
    lines.push(`- **${pattern.criterionId}** [${pattern.category}] failed ${pattern.count} time(s) across ${attemptLabel}: ${pattern.description}`);
    if (pattern.latestEvidence) {
      lines.push(`  Latest evidence: ${pattern.latestEvidence}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
