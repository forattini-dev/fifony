import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IssueEntry } from "../src/types.ts";

describe("analytics contract", () => {
  it("hydrates top issues with per-phase breakdown", async () => {
    const { hydrate, getAnalytics } = await import("../src/domains/tokens.ts");

    const issue = {
      id: "issue-analytics-1",
      identifier: "#42",
      title: "Hydrated analytics",
      tokenUsage: {
        inputTokens: 120,
        outputTokens: 80,
        totalTokens: 200,
        costUsd: 1.5,
      },
      tokensByPhase: {
        planner: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        executor: { inputTokens: 70, outputTokens: 50, totalTokens: 120 },
        reviewer: { inputTokens: 30, outputTokens: 20, totalTokens: 50 },
      },
    } as IssueEntry;

    hydrate([issue]);
    const analytics = getAnalytics();
    const top = analytics.topIssues[0];

    assert.equal(top.identifier, "#42");
    assert.equal(top.totalTokens, 200);
    assert.equal(top.inputTokens, 120);
    assert.equal(top.outputTokens, 80);
    assert.equal(top.costUsd, 1.5);
    assert.equal(top.byPhase?.executor?.totalTokens, 120);
    assert.equal(top.byPhase?.planner?.totalTokens, 30);
    assert.equal(top.byPhase?.reviewer?.totalTokens, 50);
  });

  it("incremental record keeps top issue phase split in sync", async () => {
    const { hydrate, record, getAnalytics } = await import("../src/domains/tokens.ts");

    hydrate([]);
    const issue = {
      id: "issue-analytics-2",
      identifier: "#99",
      title: "Incremental analytics",
    } as IssueEntry;

    record(issue, { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.2, model: "gpt-5.4" }, "planner");
    record(issue, { inputTokens: 30, outputTokens: 10, totalTokens: 40, costUsd: 0.4, model: "gpt-5.4" }, "executor");

    const analytics = getAnalytics();
    const top = analytics.topIssues.find((entry) => entry.id === issue.id);

    assert.ok(top, "recorded issue should appear in topIssues");
    assert.equal(top?.totalTokens, 55);
    assert.equal(top?.inputTokens, 40);
    assert.equal(top?.outputTokens, 15);
    assert.equal(top?.costUsd, 0.6000000000000001);
    assert.equal(top?.byPhase?.planner?.totalTokens, 15);
    assert.equal(top?.byPhase?.executor?.totalTokens, 40);
  });

  it("computes quality gate metrics from review reports", async () => {
    const { computeQualityGateMetrics } = await import("../src/domains/metrics.ts");

    const issues = [
      {
        id: "issue-qg-1",
        identifier: "#100",
        title: "Reviewed once and merged",
        state: "Merged",
        plan: { harnessMode: "standard" },
        reviewProfile: {
          primary: "general-quality",
          secondary: [],
          rationale: [],
          focusAreas: [],
          failureModes: [],
          evidencePriorities: [],
          severityBias: "",
        },
        reviewAttempt: 1,
        executeAttempt: 1,
        previousAttemptSummaries: [],
        gradingReport: {
          scope: "final",
          overallVerdict: "PASS",
          blockingVerdict: "PASS",
          reviewAttempt: 1,
          criteria: [
            {
              id: "AC-1",
              description: "Tests pass",
              category: "validation",
              verificationMethod: "run_command",
              evidenceExpected: "pnpm test exits 0",
              blocking: true,
              weight: 3,
              result: "PASS",
              evidence: "pnpm test passed",
            },
          ],
        },
        reviewRuns: [
          {
            id: "review.final.v1a1",
            scope: "final",
            planVersion: 1,
            attempt: 1,
            cycle: 1,
            status: "completed",
            reviewProfile: {
              primary: "general-quality",
              secondary: [],
              rationale: [],
              focusAreas: [],
              failureModes: [],
              evidencePriorities: [],
              severityBias: "",
            },
            routing: {
              provider: "codex",
              model: "gpt-5.4",
              reasoningEffort: "medium",
              overlays: [],
            },
            promptFile: "/tmp/review-prompt.md",
            startedAt: "2026-03-26T00:00:00.000Z",
            completedAt: "2026-03-26T00:01:00.000Z",
            sessionSuccess: true,
            continueRequested: false,
            blocked: false,
            exitCode: 0,
            turns: 2,
            overallVerdict: "PASS",
            blockingVerdict: "PASS",
            criteriaCount: 1,
            failedCriteriaCount: 0,
            blockingFailedCriteriaCount: 0,
            advisoryFailedCriteriaCount: 0,
          },
        ],
        policyDecisions: [
          {
            id: "policy.plan.v1.harness-mode",
            kind: "harness-mode",
            scope: "planning",
            planVersion: 1,
            basis: "historical",
            from: "standard",
            to: "contractual",
            rationale: "Adaptive harness policy changed mode based on lift.",
            recordedAt: "2026-03-26T00:00:30.000Z",
            profile: "general-quality",
          },
        ],
      },
      {
        id: "issue-qg-2",
        identifier: "#101",
        title: "Needed rework",
        state: "Approved",
        plan: { harnessMode: "contractual" },
        reviewProfile: {
          primary: "security-hardening",
          secondary: [],
          rationale: [],
          focusAreas: [],
          failureModes: [],
          evidencePriorities: [],
          severityBias: "",
        },
        reviewAttempt: 2,
        executeAttempt: 2,
        previousAttemptSummaries: [
          { planVersion: 1, executeAttempt: 1, phase: "review", error: "AC-1 failed", timestamp: "2026-03-26T00:00:00.000Z" },
        ],
        gradingReport: {
          scope: "final",
          overallVerdict: "FAIL",
          blockingVerdict: "FAIL",
          reviewAttempt: 2,
          criteria: [
            {
              id: "AC-1",
              description: "API returns 401",
              category: "security",
              verificationMethod: "api_probe",
              evidenceExpected: "Observed 401 response",
              blocking: true,
              weight: 3,
              result: "FAIL",
              evidence: "Observed 200 instead of 401",
            },
          ],
        },
        reviewRuns: [
          {
            id: "review.checkpoint.v1a1",
            scope: "checkpoint",
            planVersion: 1,
            attempt: 1,
            cycle: 101,
            status: "completed",
            reviewProfile: {
              primary: "security-hardening",
              secondary: [],
              rationale: [],
              focusAreas: [],
              failureModes: [],
              evidencePriorities: [],
              severityBias: "",
            },
            routing: {
              provider: "claude",
              model: "claude-opus-4-6",
              reasoningEffort: "extra-high",
              overlays: ["security-hardening"],
            },
            promptFile: "/tmp/checkpoint-review-prompt.md",
            startedAt: "2026-03-26T00:00:00.000Z",
            completedAt: "2026-03-26T00:02:00.000Z",
            sessionSuccess: false,
            continueRequested: true,
            blocked: false,
            exitCode: 0,
            turns: 2,
            overallVerdict: "FAIL",
            blockingVerdict: "FAIL",
            criteriaCount: 1,
            failedCriteriaCount: 1,
            blockingFailedCriteriaCount: 1,
            advisoryFailedCriteriaCount: 0,
          },
          {
            id: "review.final.v1a2",
            scope: "final",
            planVersion: 1,
            attempt: 2,
            cycle: 1,
            status: "completed",
            reviewProfile: {
              primary: "security-hardening",
              secondary: [],
              rationale: [],
              focusAreas: [],
              failureModes: [],
              evidencePriorities: [],
              severityBias: "",
            },
            routing: {
              provider: "claude",
              model: "claude-opus-4-6",
              reasoningEffort: "extra-high",
              overlays: ["security-hardening"],
            },
            promptFile: "/tmp/review-prompt.md",
            startedAt: "2026-03-26T00:03:00.000Z",
            completedAt: "2026-03-26T00:05:00.000Z",
            sessionSuccess: false,
            continueRequested: true,
            blocked: false,
            exitCode: 0,
            turns: 3,
            overallVerdict: "FAIL",
            blockingVerdict: "FAIL",
            criteriaCount: 1,
            failedCriteriaCount: 1,
            blockingFailedCriteriaCount: 1,
            advisoryFailedCriteriaCount: 0,
          },
        ],
        policyDecisions: [
          {
            id: "policy.final.v1a2.review-recovery",
            kind: "review-recovery",
            scope: "final-review",
            planVersion: 1,
            attempt: 2,
            basis: "runtime",
            from: "rework",
            to: "replan",
            rationale: "Recurring final review failures detected.",
            recordedAt: "2026-03-26T00:05:30.000Z",
            profile: "security-hardening",
            reviewScope: "final",
          },
        ],
      },
    ] as IssueEntry[];

    const metrics = computeQualityGateMetrics(issues);
    assert.equal(metrics.reviewedIssues, 2);
    assert.equal(metrics.completedReviewedIssues, 2);
    assert.equal(metrics.reviewReworkRate, 0.5);
    assert.equal(metrics.firstPassReviewPassRate, 0.5);
    assert.equal(metrics.failedCriteria, 1);
    assert.equal(metrics.criteriaByCategory.security.fail, 1);
    assert.equal(metrics.byReviewProfile["general-quality"].reviewedIssues, 1);
    assert.equal(metrics.byReviewProfile["security-hardening"].blockingFailedCriteria, 1);
    assert.equal(metrics.byReviewerRoute["codex/gpt-5.4 | [medium]"].reviewedIssues, 1);
    assert.equal(metrics.byReviewerRoute["claude/claude-opus-4-6 | [extra-high] | overlays:security-hardening"].blockingFailedCriteria, 1);
    assert.equal(metrics.byHarnessMode.standard.reviewedIssues, 1);
    assert.equal(metrics.byHarnessMode.standard.firstPassReviewPassRate, 1);
    assert.equal(metrics.byHarnessMode.contractual.reviewedIssues, 1);
    assert.equal(metrics.byHarnessMode.contractual.reviewReworkRate, 1);
    assert.equal(metrics.byHarnessMode.contractual.failedCriteria, 1);
    assert.equal(metrics.policyDecisions.total, 2);
    assert.equal(metrics.policyDecisions.harnessModeChanges, 1);
    assert.equal(metrics.policyDecisions.reviewRecoveryReplans, 1);
    assert.equal(metrics.policyDecisions.byBasis.historical, 1);
    assert.equal(metrics.policyDecisions.byBasis.runtime, 1);
  });
});
