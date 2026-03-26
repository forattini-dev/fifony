import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { GradingReport, IssueEntry, ReviewRun } from "../src/types.ts";
import {
  buildRecurringFailureContext,
  collectRecurringFailurePatterns,
  findRecurringBlockingFailures,
  recordReviewFailures,
} from "../src/agents/review-failure-history.ts";

function makeIssue(overrides: Partial<IssueEntry> = {}): IssueEntry {
  const createdAt = "2026-03-26T00:00:00.000Z";
  return {
    id: "issue-review-history-1",
    identifier: "#RH-1",
    title: "Track review failure history",
    description: "Persist repeated evaluator failures",
    state: "Reviewing",
    labels: [],
    blockedBy: [],
    assignedToWorker: true,
    createdAt,
    updatedAt: createdAt,
    history: [],
    attempts: 0,
    maxAttempts: 3,
    planVersion: 2,
    executeAttempt: 1,
    reviewAttempt: 2,
    reviewRuns: [],
    reviewFailureHistory: [],
    ...overrides,
  };
}

function makeReviewRun(overrides: Partial<ReviewRun> = {}): ReviewRun {
  return {
    id: "review.final.v2a2",
    scope: "final",
    planVersion: 2,
    attempt: 2,
    cycle: 1,
    status: "completed",
    reviewProfile: {
      primary: "api-contract",
      secondary: [],
      rationale: [],
      focusAreas: [],
      failureModes: [],
      evidencePriorities: [],
      severityBias: "strict",
    },
    routing: {
      provider: "codex",
      model: "gpt-5.4",
      overlays: [],
      selectionReason: "Adaptive reviewer route",
    },
    promptFile: "/tmp/review.md",
    startedAt: "2026-03-26T10:00:00.000Z",
    completedAt: "2026-03-26T10:01:00.000Z",
    overallVerdict: "FAIL",
    blockingVerdict: "FAIL",
    ...overrides,
  };
}

function makeReport(overrides: Partial<GradingReport> = {}): GradingReport {
  return {
    scope: "final",
    overallVerdict: "FAIL",
    blockingVerdict: "FAIL",
    reviewAttempt: 2,
    criteria: [
      {
        id: "AC-1",
        description: "API contract stays stable",
        category: "integration",
        verificationMethod: "api_probe",
        evidenceExpected: "Routes return the documented status codes",
        blocking: true,
        weight: 3,
        result: "FAIL",
        evidence: "PATCH /api/items still returns 500 for invalid body",
      },
      {
        id: "AC-2",
        description: "Advisory polish",
        category: "design",
        verificationMethod: "ui_walkthrough",
        evidenceExpected: "Empty state spacing looks consistent",
        blocking: false,
        weight: 1,
        result: "FAIL",
        evidence: "Spacing remains uneven in the empty state",
      },
    ],
    ...overrides,
  };
}

describe("review failure history", () => {
  it("records failed criteria from completed review runs", () => {
    const issue = makeIssue();
    const run = makeReviewRun();
    const report = makeReport();

    const history = recordReviewFailures(issue, run, report, "2026-03-26T10:01:00.000Z");

    assert.equal(history.length, 2);
    const blocking = history.find((entry) => entry.criterionId === "AC-1");
    const advisory = history.find((entry) => entry.criterionId === "AC-2");
    assert.ok(blocking);
    assert.ok(advisory);
    assert.equal(blocking?.routing?.provider, "codex");
  });

  it("finds recurring blocking failures only for criteria failing again in the current report", () => {
    const issue = makeIssue({
      reviewFailureHistory: [
        {
          id: "review.final.v2a1:AC-1",
          runId: "review.final.v2a1",
          scope: "final",
          planVersion: 2,
          attempt: 1,
          criterionId: "AC-1",
          description: "API contract stays stable",
          category: "integration",
          verificationMethod: "api_probe",
          blocking: true,
          weight: 3,
          evidence: "POST /api/items returned 500",
          recordedAt: "2026-03-26T09:55:00.000Z",
          reviewProfile: "api-contract",
          routing: { provider: "codex", overlays: [] },
        },
        {
          id: "review.final.v2a1:AC-9",
          runId: "review.final.v2a1",
          scope: "final",
          planVersion: 2,
          attempt: 1,
          criterionId: "AC-9",
          description: "A different failure",
          category: "validation",
          verificationMethod: "run_command",
          blocking: true,
          weight: 3,
          evidence: "pnpm test failed",
          recordedAt: "2026-03-26T09:55:00.000Z",
          reviewProfile: "api-contract",
          routing: { provider: "codex", overlays: [] },
        },
      ],
    });
    const currentRun = makeReviewRun();
    const currentReport = makeReport();
    recordReviewFailures(issue, currentRun, currentReport, currentRun.completedAt ?? "2026-03-26T10:01:00.000Z");

    const patterns = findRecurringBlockingFailures(issue, currentReport, "final", 2);

    assert.equal(patterns.length, 1);
    assert.equal(patterns[0]?.criterionId, "AC-1");
    assert.equal(patterns[0]?.count, 2);
  });

  it("builds prompt context from recurring failures in the current plan version", () => {
    const issue = makeIssue({
      reviewFailureHistory: [
        {
          id: "review.final.v2a1:AC-1",
          runId: "review.final.v2a1",
          scope: "final",
          planVersion: 2,
          attempt: 1,
          criterionId: "AC-1",
          description: "API contract stays stable",
          category: "integration",
          verificationMethod: "api_probe",
          blocking: true,
          weight: 3,
          evidence: "POST /api/items returned 500",
          recordedAt: "2026-03-26T09:55:00.000Z",
          reviewProfile: "api-contract",
          routing: { provider: "codex", overlays: [] },
        },
        {
          id: "review.final.v2a2:AC-1",
          runId: "review.final.v2a2",
          scope: "final",
          planVersion: 2,
          attempt: 2,
          criterionId: "AC-1",
          description: "API contract stays stable",
          category: "integration",
          verificationMethod: "api_probe",
          blocking: true,
          weight: 3,
          evidence: "PATCH /api/items still returns 500",
          recordedAt: "2026-03-26T10:05:00.000Z",
          reviewProfile: "api-contract",
          routing: { provider: "codex", overlays: [] },
        },
      ],
    });

    const patterns = collectRecurringFailurePatterns(issue, { currentPlanVersionOnly: true, minOccurrences: 2 });
    const context = buildRecurringFailureContext(issue);

    assert.equal(patterns.length, 1);
    assert.match(context, /Recurring Reviewer Failures/i);
    assert.match(context, /AC-1/);
    assert.match(context, /attempts 1, 2/i);
    assert.match(context, /PATCH \/api\/items still returns 500/i);
  });
});
