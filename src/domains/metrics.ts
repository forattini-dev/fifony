import type {
  ContextPipelineStageName,
  ContractNegotiationRun,
  IssueEntry,
  ReviewProfileName,
  ReviewRun,
  RuntimeMetrics,
} from "../types.ts";
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

function resolveAnalyticsContractNegotiationRuns(issue: IssueEntry): ContractNegotiationRun[] {
  const runs = Array.isArray(issue.contractNegotiationRuns) ? issue.contractNegotiationRuns : [];
  const completed = runs.filter((entry) => entry.status === "completed");
  if (completed.length === 0) return [];

  const latestPlanVersion = completed.reduce((maxPlanVersion, entry) => Math.max(maxPlanVersion, entry.planVersion ?? 0), 0);
  return completed
    .filter((entry) => (entry.planVersion ?? 0) === latestPlanVersion)
    .sort((left, right) => {
      if ((left.attempt ?? 0) !== (right.attempt ?? 0)) return (left.attempt ?? 0) - (right.attempt ?? 0);
      const leftAt = Date.parse(left.completedAt ?? left.startedAt);
      const rightAt = Date.parse(right.completedAt ?? right.startedAt);
      if (!Number.isNaN(leftAt) && !Number.isNaN(rightAt) && leftAt !== rightAt) return leftAt - rightAt;
      return left.id.localeCompare(right.id);
    });
}

function resolveAnalyticsCheckpointReviewRuns(issue: IssueEntry): ReviewRun[] {
  const reviewRuns = Array.isArray(issue.reviewRuns) ? issue.reviewRuns : [];
  const completed = reviewRuns.filter((entry) => entry.status === "completed" && entry.scope === "checkpoint");
  if (completed.length === 0) return [];

  const latestPlanVersion = completed.reduce((maxPlanVersion, entry) => Math.max(maxPlanVersion, entry.planVersion ?? 0), 0);
  return completed
    .filter((entry) => (entry.planVersion ?? 0) === latestPlanVersion)
    .sort((left, right) => {
      if ((left.attempt ?? 0) !== (right.attempt ?? 0)) return (left.attempt ?? 0) - (right.attempt ?? 0);
      const leftAt = Date.parse(left.completedAt ?? left.startedAt);
      const rightAt = Date.parse(right.completedAt ?? right.startedAt);
      if (!Number.isNaN(leftAt) && !Number.isNaN(rightAt) && leftAt !== rightAt) return leftAt - rightAt;
      return left.id.localeCompare(right.id);
    });
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
  type ContractNegotiationBucket = {
    negotiatedIssues: number;
    approvedIssues: number;
    firstPassApprovals: number;
    revisedIssues: number;
    blockingConcernIssues: number;
    totalRounds: number;
  };
  type CheckpointPolicyBucket = {
    reviewedIssues: number;
    completedReviewedIssues: number;
    gatePasses: number;
    firstPassPasses: number;
    reworkIssues: number;
    checkpointRuns: number;
    checkpointPassedIssues: number;
    checkpointFailedIssues: number;
  };
  type ContextRoleBucket = {
    reports: number;
    selectedHits: number;
    totalHits: number;
    discardedHits: number;
  };
  type ContextLayerBucket = {
    hitCount: number;
    selectedHitCount: number;
    discardedHitCount: number;
  };
  type ContextStageBucket = {
    reports: number;
    completed: number;
    skipped: number;
    totalDurationMs: number;
    totalInputCount: number;
    totalOutputCount: number;
    budgetedRuns: number;
    totalBudgetLimit: number;
  };

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
  const contractNegotiationByProfile: Record<ReviewProfileName | "unknown", ContractNegotiationBucket> = {
    "general-quality": { negotiatedIssues: 0, approvedIssues: 0, firstPassApprovals: 0, revisedIssues: 0, blockingConcernIssues: 0, totalRounds: 0 },
    "ui-polish": { negotiatedIssues: 0, approvedIssues: 0, firstPassApprovals: 0, revisedIssues: 0, blockingConcernIssues: 0, totalRounds: 0 },
    "workflow-fsm": { negotiatedIssues: 0, approvedIssues: 0, firstPassApprovals: 0, revisedIssues: 0, blockingConcernIssues: 0, totalRounds: 0 },
    "integration-safety": { negotiatedIssues: 0, approvedIssues: 0, firstPassApprovals: 0, revisedIssues: 0, blockingConcernIssues: 0, totalRounds: 0 },
    "api-contract": { negotiatedIssues: 0, approvedIssues: 0, firstPassApprovals: 0, revisedIssues: 0, blockingConcernIssues: 0, totalRounds: 0 },
    "security-hardening": { negotiatedIssues: 0, approvedIssues: 0, firstPassApprovals: 0, revisedIssues: 0, blockingConcernIssues: 0, totalRounds: 0 },
    unknown: { negotiatedIssues: 0, approvedIssues: 0, firstPassApprovals: 0, revisedIssues: 0, blockingConcernIssues: 0, totalRounds: 0 },
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
  const byCheckpointPolicy: Record<"final_only" | "checkpointed", CheckpointPolicyBucket> = {
    final_only: {
      reviewedIssues: 0,
      completedReviewedIssues: 0,
      gatePasses: 0,
      firstPassPasses: 0,
      reworkIssues: 0,
      checkpointRuns: 0,
      checkpointPassedIssues: 0,
      checkpointFailedIssues: 0,
    },
    checkpointed: {
      reviewedIssues: 0,
      completedReviewedIssues: 0,
      gatePasses: 0,
      firstPassPasses: 0,
      reworkIssues: 0,
      checkpointRuns: 0,
      checkpointPassedIssues: 0,
      checkpointFailedIssues: 0,
    },
  };
  let totalCriteria = 0;
  let failedCriteria = 0;
  let blockingFailedCriteria = 0;
  let advisoryFailedCriteria = 0;
  const contractNegotiationSummary: ContractNegotiationBucket = {
    negotiatedIssues: 0,
    approvedIssues: 0,
    firstPassApprovals: 0,
    revisedIssues: 0,
    blockingConcernIssues: 0,
    totalRounds: 0,
  };
  const policyDecisionSummary = {
    total: 0,
    harnessModeChanges: 0,
    checkpointPolicyChanges: 0,
    reviewRecoveryReplans: 0,
    byKind: {
      "harness-mode": 0,
      "checkpoint-policy": 0,
      "review-recovery": 0,
    },
    byBasis: {
      historical: 0,
      heuristic: 0,
      runtime: 0,
    },
  };
  const memoryPipeline = {
    issuesWithMemoryFlushes: 0,
    totalMemoryFlushes: 0,
    issuesWithContextReports: 0,
    issuesWithStageReports: 0,
    issuesWithCompaction: 0,
    byRole: {
      planner: { reports: 0, selectedHits: 0, totalHits: 0, discardedHits: 0 } as ContextRoleBucket,
      executor: { reports: 0, selectedHits: 0, totalHits: 0, discardedHits: 0 } as ContextRoleBucket,
      reviewer: { reports: 0, selectedHits: 0, totalHits: 0, discardedHits: 0 } as ContextRoleBucket,
    },
    byLayer: {
      bootstrap: { hitCount: 0, selectedHitCount: 0, discardedHitCount: 0 } as ContextLayerBucket,
      "workspace-memory": { hitCount: 0, selectedHitCount: 0, discardedHitCount: 0 } as ContextLayerBucket,
      "issue-memory": { hitCount: 0, selectedHitCount: 0, discardedHitCount: 0 } as ContextLayerBucket,
      retrieval: { hitCount: 0, selectedHitCount: 0, discardedHitCount: 0 } as ContextLayerBucket,
    },
    byStage: {
      ingest: { reports: 0, completed: 0, skipped: 0, totalDurationMs: 0, totalInputCount: 0, totalOutputCount: 0, budgetedRuns: 0, totalBudgetLimit: 0 } as ContextStageBucket,
      "flush-memory": { reports: 0, completed: 0, skipped: 0, totalDurationMs: 0, totalInputCount: 0, totalOutputCount: 0, budgetedRuns: 0, totalBudgetLimit: 0 } as ContextStageBucket,
      retrieve: { reports: 0, completed: 0, skipped: 0, totalDurationMs: 0, totalInputCount: 0, totalOutputCount: 0, budgetedRuns: 0, totalBudgetLimit: 0 } as ContextStageBucket,
      budget: { reports: 0, completed: 0, skipped: 0, totalDurationMs: 0, totalInputCount: 0, totalOutputCount: 0, budgetedRuns: 0, totalBudgetLimit: 0 } as ContextStageBucket,
      compact: { reports: 0, completed: 0, skipped: 0, totalDurationMs: 0, totalInputCount: 0, totalOutputCount: 0, budgetedRuns: 0, totalBudgetLimit: 0 } as ContextStageBucket,
      assemble: { reports: 0, completed: 0, skipped: 0, totalDurationMs: 0, totalInputCount: 0, totalOutputCount: 0, budgetedRuns: 0, totalBudgetLimit: 0 } as ContextStageBucket,
    } satisfies Record<ContextPipelineStageName, ContextStageBucket>,
  };

  for (const issue of reviewedIssues) {
    const harnessMode = issue.plan?.harnessMode ?? "standard";
    const harnessBucket = byHarnessMode[harnessMode];
    const checkpointPolicy = issue.plan?.executionContract?.checkpointPolicy === "checkpointed" ? "checkpointed" : "final_only";
    const checkpointBucket = byCheckpointPolicy[checkpointPolicy];
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
    if (harnessMode === "contractual") checkpointBucket.reviewedIssues += 1;
    reviewProfileBucket.reviewedIssues += 1;
    reviewRouteBucket.reviewedIssues += 1;
    if (issue.state === "Approved" || issue.state === "Merged") harnessBucket.completedReviewedIssues += 1;
    if ((issue.state === "Approved" || issue.state === "Merged") && harnessMode === "contractual") checkpointBucket.completedReviewedIssues += 1;
    if (issue.state === "Approved" || issue.state === "Merged") reviewProfileBucket.completedReviewedIssues += 1;
    if (issue.state === "Approved" || issue.state === "Merged") reviewRouteBucket.completedReviewedIssues += 1;
    if ((issue.previousAttemptSummaries ?? []).some((summary) => summary.phase === "review")) harnessBucket.reworkIssues += 1;
    if ((issue.previousAttemptSummaries ?? []).some((summary) => summary.phase === "review") && harnessMode === "contractual") checkpointBucket.reworkIssues += 1;
    if ((issue.reviewAttempt ?? 0) <= 1 && !(issue.previousAttemptSummaries ?? []).some((summary) => summary.phase === "review")) {
      harnessBucket.firstPassPasses += 1;
      if (harnessMode === "contractual" && (issue.state === "Approved" || issue.state === "Merged")) checkpointBucket.firstPassPasses += 1;
    }
    const finalReviewRun = resolveAnalyticsReviewRun(issue);
    if (finalReviewRun?.blockingVerdict === "PASS" && harnessMode === "contractual") checkpointBucket.gatePasses += 1;
    if (harnessMode === "contractual" && checkpointPolicy === "checkpointed") {
      const checkpointRuns = resolveAnalyticsCheckpointReviewRuns(issue);
      checkpointBucket.checkpointRuns += checkpointRuns.length;
      if (checkpointRuns.some((entry) => entry.blockingVerdict === "PASS")) checkpointBucket.checkpointPassedIssues += 1;
      if (checkpointRuns.some((entry) => entry.blockingVerdict === "FAIL")) checkpointBucket.checkpointFailedIssues += 1;
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
    if ((issue.memoryFlushCount ?? 0) > 0) {
      memoryPipeline.issuesWithMemoryFlushes += 1;
      memoryPipeline.totalMemoryFlushes += issue.memoryFlushCount ?? 0;
    }

    const contextReportsByRole = issue.contextReportsByRole ?? {};
    const roles = Object.entries(contextReportsByRole)
      .filter(([, report]) => report && typeof report === "object");

    if (roles.length > 0) {
      memoryPipeline.issuesWithContextReports += 1;
    }

    let stageReportsRecorded = false;
    let compactionObserved = false;

    for (const [role, report] of roles) {
      if (!(role in memoryPipeline.byRole) || !report) continue;
      const roleBucket = memoryPipeline.byRole[role as keyof typeof memoryPipeline.byRole];
      roleBucket.reports += 1;
      roleBucket.selectedHits += report.selectedHits ?? 0;
      roleBucket.totalHits += report.totalHits ?? 0;
      roleBucket.discardedHits += report.discardedHits ?? 0;

      for (const layer of report.layers ?? []) {
        if (!(layer.name in memoryPipeline.byLayer)) continue;
        const layerBucket = memoryPipeline.byLayer[layer.name as keyof typeof memoryPipeline.byLayer];
        layerBucket.hitCount += layer.hitCount ?? 0;
        layerBucket.selectedHitCount += layer.selectedHitCount ?? 0;
        layerBucket.discardedHitCount += layer.discardedHitCount ?? 0;
      }

      for (const stage of report.stages ?? []) {
        if (!(stage.name in memoryPipeline.byStage)) continue;
        const stageBucket = memoryPipeline.byStage[stage.name as keyof typeof memoryPipeline.byStage];
        stageBucket.reports += 1;
        if (stage.status === "completed") stageBucket.completed += 1;
        if (stage.status === "skipped") stageBucket.skipped += 1;
        stageBucket.totalDurationMs += stage.durationMs ?? 0;
        stageBucket.totalInputCount += stage.inputCount ?? 0;
        stageBucket.totalOutputCount += stage.outputCount ?? 0;
        if (typeof stage.budgetLimit === "number") {
          stageBucket.budgetedRuns += 1;
          stageBucket.totalBudgetLimit += stage.budgetLimit;
        }
        stageReportsRecorded = true;
        if (stage.name === "compact" && stage.status === "completed") compactionObserved = true;
      }
    }

    if (stageReportsRecorded) {
      memoryPipeline.issuesWithStageReports += 1;
    }
    if (compactionObserved) {
      memoryPipeline.issuesWithCompaction += 1;
    }

    const negotiationRuns = resolveAnalyticsContractNegotiationRuns(issue);
    if (negotiationRuns.length === 0) continue;

    const latestRun = negotiationRuns[negotiationRuns.length - 1]!;
    const profileName = latestRun.reviewProfile?.primary ?? "unknown";
    const bucket = contractNegotiationByProfile[profileName];
    contractNegotiationSummary.negotiatedIssues += 1;
    contractNegotiationSummary.totalRounds += negotiationRuns.length;
    bucket.negotiatedIssues += 1;
    bucket.totalRounds += negotiationRuns.length;

    if (latestRun.decisionStatus === "approved") {
      contractNegotiationSummary.approvedIssues += 1;
      bucket.approvedIssues += 1;
    }
    if (negotiationRuns.length === 1 && negotiationRuns[0]?.decisionStatus === "approved") {
      contractNegotiationSummary.firstPassApprovals += 1;
      bucket.firstPassApprovals += 1;
    }
    if (negotiationRuns.some((entry) => entry.decisionStatus === "revise" || entry.appliedRefinement)) {
      contractNegotiationSummary.revisedIssues += 1;
      bucket.revisedIssues += 1;
    }
    if (negotiationRuns.some((entry) => (entry.blockingConcernsCount ?? 0) > 0)) {
      contractNegotiationSummary.blockingConcernIssues += 1;
      bucket.blockingConcernIssues += 1;
    }
  }

  for (const issue of issues) {
    for (const decision of issue.policyDecisions ?? []) {
      policyDecisionSummary.total += 1;
      if (decision.kind === "harness-mode") policyDecisionSummary.harnessModeChanges += 1;
      if (decision.kind === "checkpoint-policy") policyDecisionSummary.checkpointPolicyChanges += 1;
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
  const finalizeContractBucket = (bucket: ContractNegotiationBucket) => ({
    ...bucket,
    approvalRate: bucket.negotiatedIssues ? bucket.approvedIssues / bucket.negotiatedIssues : null,
    firstPassApprovalRate: bucket.negotiatedIssues ? bucket.firstPassApprovals / bucket.negotiatedIssues : null,
    revisionRate: bucket.negotiatedIssues ? bucket.revisedIssues / bucket.negotiatedIssues : null,
    blockingConcernRate: bucket.negotiatedIssues ? bucket.blockingConcernIssues / bucket.negotiatedIssues : null,
    avgRoundsPerIssue: bucket.negotiatedIssues ? bucket.totalRounds / bucket.negotiatedIssues : null,
  });
  const finalizeCheckpointBucket = (bucket: CheckpointPolicyBucket) => ({
    ...bucket,
    gatePassRate: bucket.reviewedIssues ? bucket.gatePasses / bucket.reviewedIssues : null,
    firstPassReviewPassRate: bucket.completedReviewedIssues ? bucket.firstPassPasses / bucket.completedReviewedIssues : null,
    reviewReworkRate: bucket.reviewedIssues ? bucket.reworkIssues / bucket.reviewedIssues : null,
    checkpointCatchRate: bucket.reviewedIssues ? bucket.checkpointFailedIssues / bucket.reviewedIssues : null,
    checkpointPassRate: bucket.reviewedIssues ? bucket.checkpointPassedIssues / bucket.reviewedIssues : null,
    avgCheckpointRunsPerIssue: bucket.reviewedIssues ? bucket.checkpointRuns / bucket.reviewedIssues : null,
  });
  const finalizeStageBucket = (bucket: ContextStageBucket) => ({
    ...bucket,
    completionRate: bucket.reports ? bucket.completed / bucket.reports : null,
    avgDurationMs: bucket.reports ? bucket.totalDurationMs / bucket.reports : null,
    avgInputCount: bucket.reports ? bucket.totalInputCount / bucket.reports : null,
    avgOutputCount: bucket.reports ? bucket.totalOutputCount / bucket.reports : null,
    avgBudgetLimit: bucket.budgetedRuns ? bucket.totalBudgetLimit / bucket.budgetedRuns : null,
  });

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
    contractNegotiation: {
      ...finalizeContractBucket(contractNegotiationSummary),
      byReviewProfile: {
        "general-quality": finalizeContractBucket(contractNegotiationByProfile["general-quality"]),
        "ui-polish": finalizeContractBucket(contractNegotiationByProfile["ui-polish"]),
        "workflow-fsm": finalizeContractBucket(contractNegotiationByProfile["workflow-fsm"]),
        "integration-safety": finalizeContractBucket(contractNegotiationByProfile["integration-safety"]),
        "api-contract": finalizeContractBucket(contractNegotiationByProfile["api-contract"]),
        "security-hardening": finalizeContractBucket(contractNegotiationByProfile["security-hardening"]),
        unknown: finalizeContractBucket(contractNegotiationByProfile.unknown),
      },
    },
    checkpointPolicy: {
      final_only: finalizeCheckpointBucket(byCheckpointPolicy.final_only),
      checkpointed: finalizeCheckpointBucket(byCheckpointPolicy.checkpointed),
    },
    memoryPipeline: {
      ...memoryPipeline,
      memoryFlushCoverageRate: issues.length ? memoryPipeline.issuesWithMemoryFlushes / issues.length : null,
      contextReportCoverageRate: issues.length ? memoryPipeline.issuesWithContextReports / issues.length : null,
      stageReportCoverageRate: issues.length ? memoryPipeline.issuesWithStageReports / issues.length : null,
      compactionCoverageRate: issues.length ? memoryPipeline.issuesWithCompaction / issues.length : null,
      avgFlushesPerIssueWithMemory: memoryPipeline.issuesWithMemoryFlushes
        ? memoryPipeline.totalMemoryFlushes / memoryPipeline.issuesWithMemoryFlushes
        : null,
      byStage: {
        ingest: finalizeStageBucket(memoryPipeline.byStage.ingest),
        "flush-memory": finalizeStageBucket(memoryPipeline.byStage["flush-memory"]),
        retrieve: finalizeStageBucket(memoryPipeline.byStage.retrieve),
        budget: finalizeStageBucket(memoryPipeline.byStage.budget),
        compact: finalizeStageBucket(memoryPipeline.byStage.compact),
        assemble: finalizeStageBucket(memoryPipeline.byStage.assemble),
      },
    },
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
