import type { IssueEntry, ReviewProfileName, ReviewRun, RuntimeMetrics } from "../types.ts";
import { serializeReviewRouteSnapshot } from "../agents/harness-policy.ts";

function resolveAnalyticsReviewRun(issue: IssueEntry): ReviewRun | null {
  const reviewRuns = Array.isArray(issue.reviewRuns) ? issue.reviewRuns : [];
  const completed = reviewRuns.filter((entry) => entry.status === "completed");
  const candidates = completed.filter((entry) => entry.scope === "final");
  const pool = candidates.length > 0 ? candidates : completed;
  if (pool.length === 0) return null;
  return [...pool].sort((left, right) => {
    const leftAt = Date.parse(left.completedAt ?? left.startedAt);
    const rightAt = Date.parse(right.completedAt ?? right.startedAt);
    if (!Number.isNaN(leftAt) && !Number.isNaN(rightAt) && leftAt !== rightAt) return rightAt - leftAt;
    return right.attempt - left.attempt;
  })[0] ?? null;
}

function formatReviewerRoute(reviewRun: ReviewRun | null): string {
  if (!reviewRun) return "unknown";
  return serializeReviewRouteSnapshot(reviewRun.routing);
}

export function computeMetrics(issues: IssueEntry[]): RuntimeMetrics {
  let planning = 0;
  let queued = 0;
  let inProgress = 0;
  let blocked = 0;
  let done = 0;
  let merged = 0;
  let cancelled = 0;
  const completionTimes: number[] = [];

  for (const issue of issues) {
    // Completion time stats — only for Merged issues (truly finished)
    if (issue.state === "Merged") {
      const duration = issue.durationMs;
      const candidate = typeof duration === "number" && Number.isFinite(duration)
        ? duration
        : Number.isFinite(Date.parse(issue.startedAt ?? "")) && Number.isFinite(Date.parse(issue.completedAt ?? ""))
          ? Date.parse(issue.completedAt) - Date.parse(issue.startedAt)
          : NaN;
      if (Number.isFinite(candidate) && candidate >= 0) {
        completionTimes.push(candidate);
      }
    }

    switch (issue.state) {
      case "Planning":
        planning += 1;
        break;
      case "PendingApproval":
        queued += 1;
        break;
      case "Queued":
      case "Running":
      case "Reviewing":
      case "PendingDecision":
        inProgress += 1;
        break;
      case "Blocked":
        blocked += 1;
        break;
      case "Approved":
        done += 1;
        break;
      case "Merged":
        merged += 1;
        break;
      case "Cancelled":
        cancelled += 1;
        break;
    }
  }

  if (completionTimes.length === 0) {
    return {
      total: issues.length,
      planning,
      queued,
      inProgress,
      blocked,
      done,
      merged,
      cancelled,
      activeWorkers: 0,
    };
  }

  const sortedCompletionTimes = completionTimes.slice().sort((a, b) => a - b);
  const totalCompletionMs = sortedCompletionTimes.reduce((acc, value) => acc + value, 0);
  const mid = Math.floor(sortedCompletionTimes.length / 2);
  const medianCompletionMs = sortedCompletionTimes.length % 2 === 1
    ? sortedCompletionTimes[mid]
    : Math.round((sortedCompletionTimes[mid - 1] + sortedCompletionTimes[mid]) / 2);

  return {
    total: issues.length,
    planning,
    queued,
    inProgress,
    blocked,
    done,
    merged,
    cancelled,
    activeWorkers: 0,
    avgCompletionMs: Math.round(totalCompletionMs / completionTimes.length),
    medianCompletionMs,
    fastestCompletionMs: sortedCompletionTimes[0]!,
    slowestCompletionMs: sortedCompletionTimes[sortedCompletionTimes.length - 1]!,
  };
}

export function computeQualityGateMetrics(issues: IssueEntry[]) {
  type ReviewProfileBucket = {
    reviewedIssues: number;
    completedReviewedIssues: number;
    failedCriteria: number;
    blockingFailedCriteria: number;
    advisoryFailedCriteria: number;
  };

  type ReviewerRouteBucket = ReviewProfileBucket;

  const reviewedIssues = issues.filter((issue) =>
    (issue.reviewAttempt ?? 0) > 0
    || !!issue.gradingReport
    || !!issue.reviewingAt,
  );
  const completedReviewedIssues = reviewedIssues.filter((issue) => issue.state === "Approved" || issue.state === "Merged");
  const reviewReworkIssues = reviewedIssues.filter((issue) =>
    (issue.previousAttemptSummaries ?? []).some((summary) => summary.phase === "review"),
  );
  const firstPassPasses = completedReviewedIssues.filter((issue) =>
    (issue.reviewAttempt ?? 0) <= 1
    && !(issue.previousAttemptSummaries ?? []).some((summary) => summary.phase === "review"),
  );

  const criteriaByCategory: Record<string, { pass: number; fail: number; skip: number }> = {};
  const byReviewerRoute: Record<string, ReviewerRouteBucket> = {};
  const byReviewProfile: Record<ReviewProfileName | "unknown", ReviewProfileBucket> = {
    "general-quality": { reviewedIssues: 0, completedReviewedIssues: 0, failedCriteria: 0, blockingFailedCriteria: 0, advisoryFailedCriteria: 0 },
    "ui-polish": { reviewedIssues: 0, completedReviewedIssues: 0, failedCriteria: 0, blockingFailedCriteria: 0, advisoryFailedCriteria: 0 },
    "workflow-fsm": { reviewedIssues: 0, completedReviewedIssues: 0, failedCriteria: 0, blockingFailedCriteria: 0, advisoryFailedCriteria: 0 },
    "integration-safety": { reviewedIssues: 0, completedReviewedIssues: 0, failedCriteria: 0, blockingFailedCriteria: 0, advisoryFailedCriteria: 0 },
    "api-contract": { reviewedIssues: 0, completedReviewedIssues: 0, failedCriteria: 0, blockingFailedCriteria: 0, advisoryFailedCriteria: 0 },
    "security-hardening": { reviewedIssues: 0, completedReviewedIssues: 0, failedCriteria: 0, blockingFailedCriteria: 0, advisoryFailedCriteria: 0 },
    unknown: { reviewedIssues: 0, completedReviewedIssues: 0, failedCriteria: 0, blockingFailedCriteria: 0, advisoryFailedCriteria: 0 },
  };
  const byHarnessMode: Record<"solo" | "standard" | "contractual", {
    reviewedIssues: number;
    completedReviewedIssues: number;
    reworkIssues: number;
    firstPassPasses: number;
    totalCriteria: number;
    failedCriteria: number;
    advisoryFailedCriteria: number;
    blockingFailedCriteria: number;
  }> = {
    solo: { reviewedIssues: 0, completedReviewedIssues: 0, reworkIssues: 0, firstPassPasses: 0, totalCriteria: 0, failedCriteria: 0, advisoryFailedCriteria: 0, blockingFailedCriteria: 0 },
    standard: { reviewedIssues: 0, completedReviewedIssues: 0, reworkIssues: 0, firstPassPasses: 0, totalCriteria: 0, failedCriteria: 0, advisoryFailedCriteria: 0, blockingFailedCriteria: 0 },
    contractual: { reviewedIssues: 0, completedReviewedIssues: 0, reworkIssues: 0, firstPassPasses: 0, totalCriteria: 0, failedCriteria: 0, advisoryFailedCriteria: 0, blockingFailedCriteria: 0 },
  };
  let totalCriteria = 0;
  let failedCriteria = 0;
  let blockingFailedCriteria = 0;
  let advisoryFailedCriteria = 0;
  const policyDecisionSummary = {
    total: 0,
    harnessModeChanges: 0,
    reviewRecoveryReplans: 0,
    byKind: {
      "harness-mode": 0,
      "review-recovery": 0,
    },
    byBasis: {
      historical: 0,
      heuristic: 0,
      runtime: 0,
    },
  };

  for (const issue of reviewedIssues) {
    const harnessMode = issue.plan?.harnessMode ?? "standard";
    const harnessBucket = byHarnessMode[harnessMode];
    const reviewProfile = issue.reviewProfile?.primary ?? "unknown";
    const reviewProfileBucket = byReviewProfile[reviewProfile];
    const reviewRouteKey = formatReviewerRoute(resolveAnalyticsReviewRun(issue));
    const reviewRouteBucket = byReviewerRoute[reviewRouteKey] ||= {
      reviewedIssues: 0,
      completedReviewedIssues: 0,
      failedCriteria: 0,
      blockingFailedCriteria: 0,
      advisoryFailedCriteria: 0,
    };
    harnessBucket.reviewedIssues += 1;
    reviewProfileBucket.reviewedIssues += 1;
    reviewRouteBucket.reviewedIssues += 1;
    if (issue.state === "Approved" || issue.state === "Merged") harnessBucket.completedReviewedIssues += 1;
    if (issue.state === "Approved" || issue.state === "Merged") reviewProfileBucket.completedReviewedIssues += 1;
    if (issue.state === "Approved" || issue.state === "Merged") reviewRouteBucket.completedReviewedIssues += 1;
    if ((issue.previousAttemptSummaries ?? []).some((summary) => summary.phase === "review")) harnessBucket.reworkIssues += 1;
    if ((issue.reviewAttempt ?? 0) <= 1 && !(issue.previousAttemptSummaries ?? []).some((summary) => summary.phase === "review")) {
      harnessBucket.firstPassPasses += 1;
    }
    for (const criterion of issue.gradingReport?.criteria ?? []) {
      totalCriteria += 1;
      harnessBucket.totalCriteria += 1;
      if (criterion.result === "FAIL") {
        failedCriteria += 1;
        harnessBucket.failedCriteria += 1;
        reviewProfileBucket.failedCriteria += 1;
        reviewRouteBucket.failedCriteria += 1;
        if (criterion.blocking) {
          blockingFailedCriteria += 1;
          harnessBucket.blockingFailedCriteria += 1;
          reviewProfileBucket.blockingFailedCriteria += 1;
          reviewRouteBucket.blockingFailedCriteria += 1;
        } else {
          advisoryFailedCriteria += 1;
          harnessBucket.advisoryFailedCriteria += 1;
          reviewProfileBucket.advisoryFailedCriteria += 1;
          reviewRouteBucket.advisoryFailedCriteria += 1;
        }
      }
      const bucket = criteriaByCategory[criterion.category] ||= { pass: 0, fail: 0, skip: 0 };
      if (criterion.result === "PASS") bucket.pass += 1;
      if (criterion.result === "FAIL") bucket.fail += 1;
      if (criterion.result === "SKIP") bucket.skip += 1;
    }
  }

  for (const issue of issues) {
    for (const decision of issue.policyDecisions ?? []) {
      policyDecisionSummary.total += 1;
      if (decision.kind === "harness-mode") policyDecisionSummary.harnessModeChanges += 1;
      if (decision.kind === "review-recovery" && decision.to === "replan") {
        policyDecisionSummary.reviewRecoveryReplans += 1;
      }
      if (decision.kind in policyDecisionSummary.byKind) {
        policyDecisionSummary.byKind[decision.kind as keyof typeof policyDecisionSummary.byKind] += 1;
      }
      if (decision.basis in policyDecisionSummary.byBasis) {
        policyDecisionSummary.byBasis[decision.basis as keyof typeof policyDecisionSummary.byBasis] += 1;
      }
    }
  }

  const average = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

  return {
    reviewedIssues: reviewedIssues.length,
    completedReviewedIssues: completedReviewedIssues.length,
    reviewReworkRate: reviewedIssues.length ? reviewReworkIssues.length / reviewedIssues.length : null,
    firstPassReviewPassRate: completedReviewedIssues.length ? firstPassPasses.length / completedReviewedIssues.length : null,
    avgReviewAttempts: average(reviewedIssues.map((issue) => issue.reviewAttempt ?? 0)),
    avgExecuteAttempts: average(reviewedIssues.map((issue) => issue.executeAttempt ?? 0)),
    totalCriteria,
    failedCriteria,
    blockingFailedCriteria,
    advisoryFailedCriteria,
    criteriaFailureRate: totalCriteria ? failedCriteria / totalCriteria : null,
    criteriaByCategory,
    policyDecisions: policyDecisionSummary,
    byReviewProfile,
    byReviewerRoute,
    byHarnessMode: {
      solo: {
        ...byHarnessMode.solo,
        reviewReworkRate: byHarnessMode.solo.reviewedIssues ? byHarnessMode.solo.reworkIssues / byHarnessMode.solo.reviewedIssues : null,
        firstPassReviewPassRate: byHarnessMode.solo.completedReviewedIssues ? byHarnessMode.solo.firstPassPasses / byHarnessMode.solo.completedReviewedIssues : null,
        criteriaFailureRate: byHarnessMode.solo.totalCriteria ? byHarnessMode.solo.failedCriteria / byHarnessMode.solo.totalCriteria : null,
      },
      standard: {
        ...byHarnessMode.standard,
        reviewReworkRate: byHarnessMode.standard.reviewedIssues ? byHarnessMode.standard.reworkIssues / byHarnessMode.standard.reviewedIssues : null,
        firstPassReviewPassRate: byHarnessMode.standard.completedReviewedIssues ? byHarnessMode.standard.firstPassPasses / byHarnessMode.standard.completedReviewedIssues : null,
        criteriaFailureRate: byHarnessMode.standard.totalCriteria ? byHarnessMode.standard.failedCriteria / byHarnessMode.standard.totalCriteria : null,
      },
      contractual: {
        ...byHarnessMode.contractual,
        reviewReworkRate: byHarnessMode.contractual.reviewedIssues ? byHarnessMode.contractual.reworkIssues / byHarnessMode.contractual.reviewedIssues : null,
        firstPassReviewPassRate: byHarnessMode.contractual.completedReviewedIssues ? byHarnessMode.contractual.firstPassPasses / byHarnessMode.contractual.completedReviewedIssues : null,
        criteriaFailureRate: byHarnessMode.contractual.totalCriteria ? byHarnessMode.contractual.failedCriteria / byHarnessMode.contractual.totalCriteria : null,
      },
    },
  };
}
