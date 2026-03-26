import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildReviewRouteKey,
  recommendHarnessModeForIssue,
  recommendReviewRouteForIssue,
  serializeReviewRouteSnapshot,
} from "../src/agents/harness-policy.ts";
import type { AgentProviderDefinition, IssueEntry, IssuePlan, ReviewRun } from "../src/types.ts";

function makePlan(overrides: Partial<IssuePlan> = {}): IssuePlan {
  return {
    summary: "Harness policy fixture",
    estimatedComplexity: "medium",
    harnessMode: "standard",
    steps: [{ step: 1, action: "Implement feature" }],
    acceptanceCriteria: [
      {
        id: "AC-1",
        description: "Core behavior works",
        category: "functionality",
        verificationMethod: "code_inspection",
        evidenceExpected: "Code path is coherent",
        blocking: true,
        weight: 3,
      },
    ],
    executionContract: {
      summary: "Fixture execution contract",
      deliverables: ["working behavior"],
      requiredChecks: [],
      requiredEvidence: [],
      focusAreas: ["src/index.ts"],
      checkpointPolicy: "final_only",
    },
    suggestedPaths: ["src/index.ts"],
    suggestedSkills: [],
    suggestedAgents: [],
    suggestedEffort: { default: "medium", reviewer: "medium" },
    provider: "codex",
    createdAt: "2026-03-26T00:00:00.000Z",
    ...overrides,
  };
}

function makeReviewRun(overrides: Partial<ReviewRun> = {}): ReviewRun {
  return {
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
      provider: "claude",
      model: "opus",
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
    ...overrides,
  };
}

function makeIssue(overrides: Partial<IssueEntry> = {}): IssueEntry {
  return {
    id: "issue-1",
    identifier: "#1",
    title: "Harness fixture",
    description: "Harness fixture",
    state: "Reviewing",
    labels: [],
    blockedBy: [],
    assignedToWorker: true,
    createdAt: "2026-03-26T00:00:00.000Z",
    updatedAt: "2026-03-26T00:00:00.000Z",
    history: [],
    attempts: 0,
    maxAttempts: 3,
    planVersion: 1,
    executeAttempt: 1,
    reviewAttempt: 1,
    plan: makePlan(),
    ...overrides,
  };
}

function makeCompletedIssue(overrides: Partial<IssueEntry> = {}): IssueEntry {
  const reviewRun = overrides.reviewRuns?.[0] ?? makeReviewRun();
  return makeIssue({
    state: "Merged",
    reviewProfile: reviewRun.reviewProfile,
    gradingReport: {
      scope: "final",
      overallVerdict: reviewRun.overallVerdict ?? "PASS",
      blockingVerdict: reviewRun.blockingVerdict ?? "PASS",
      reviewAttempt: reviewRun.attempt,
      criteria: [],
    },
    reviewRuns: [reviewRun],
    ...overrides,
  });
}

describe("serializeReviewRouteSnapshot", () => {
  it("builds a stable route key with provider/model/effort/overlays", () => {
    const routeKey = serializeReviewRouteSnapshot({
      provider: "claude",
      model: "opus",
      reasoningEffort: "high",
      overlays: ["frontend-design", "impeccable"],
    });

    assert.equal(routeKey, "claude/opus | [high] | overlays:frontend-design,impeccable");
  });
});

describe("recommendHarnessModeForIssue", () => {
  it("upgrades high-risk work to contractual when history supports it", () => {
    const currentIssue = makeIssue({
      title: "Fix checkpoint lifecycle",
      labels: ["workflow", "fsm"],
      plan: makePlan({
        estimatedComplexity: "high",
        harnessMode: "standard",
        suggestedPaths: ["src/persistence/plugins/fsm-agent.ts"],
      }),
    });

    const historicalIssues = [
      makeCompletedIssue({
        id: "hist-1",
        identifier: "#H1",
        plan: makePlan({ harnessMode: "contractual", estimatedComplexity: "high", suggestedPaths: ["src/persistence/plugins/fsm-agent.ts"] }),
        reviewRuns: [makeReviewRun({ reviewProfile: { ...makeReviewRun().reviewProfile, primary: "workflow-fsm" }, blockingVerdict: "PASS" })],
      }),
      makeCompletedIssue({
        id: "hist-2",
        identifier: "#H2",
        plan: makePlan({ harnessMode: "contractual", estimatedComplexity: "high", suggestedPaths: ["src/persistence/plugins/fsm-agent.ts"] }),
        reviewRuns: [makeReviewRun({ reviewProfile: { ...makeReviewRun().reviewProfile, primary: "workflow-fsm" }, blockingVerdict: "PASS" })],
      }),
      makeCompletedIssue({
        id: "hist-3",
        identifier: "#H3",
        plan: makePlan({ harnessMode: "contractual", estimatedComplexity: "high", suggestedPaths: ["src/persistence/plugins/fsm-agent.ts"] }),
        reviewRuns: [makeReviewRun({ reviewProfile: { ...makeReviewRun().reviewProfile, primary: "workflow-fsm" }, blockingVerdict: "PASS" })],
      }),
    ];

    const recommendation = recommendHarnessModeForIssue(historicalIssues, currentIssue, "standard", 3);

    assert.ok(recommendation);
    assert.equal(recommendation?.mode, "contractual");
    assert.equal(recommendation?.basis, "historical");
    assert.match(recommendation?.rationale || "", /workflow-fsm/i);
  });

  it("upgrades medium/high work away from solo even without history", () => {
    const currentIssue = makeIssue({
      title: "Add API contract validation",
      plan: makePlan({
        estimatedComplexity: "medium",
        harnessMode: "solo",
        suggestedPaths: ["src/routes/state.ts"],
      }),
    });

    const recommendation = recommendHarnessModeForIssue([], currentIssue, "solo", 3);

    assert.ok(recommendation);
    assert.equal(recommendation?.mode, "contractual");
    assert.equal(recommendation?.basis, "heuristic");
  });
});

describe("recommendReviewRouteForIssue", () => {
  const claudeCandidate: AgentProviderDefinition = {
    provider: "claude",
    role: "reviewer",
    command: "",
    model: "opus",
    profile: "",
    profilePath: "",
    profileInstructions: "",
    reasoningEffort: "high",
    overlays: ["workflow-audit"],
  };
  const codexCandidate: AgentProviderDefinition = {
    provider: "codex",
    role: "reviewer",
    command: "",
    model: "gpt-5.4",
    profile: "",
    profilePath: "",
    profileInstructions: "",
    reasoningEffort: "high",
    overlays: ["workflow-audit"],
  };

  it("prefers the historically stronger route for the active review profile", () => {
    const currentIssue = makeIssue({
      title: "Fix queue lifecycle",
      labels: ["workflow"],
      plan: makePlan({
        estimatedComplexity: "high",
        suggestedPaths: ["src/persistence/plugins/fsm-agent.ts"],
      }),
    });

    const historicalIssues = [
      makeCompletedIssue({
        id: "route-1",
        identifier: "#R1",
        reviewRuns: [makeReviewRun({
          reviewProfile: { ...makeReviewRun().reviewProfile, primary: "workflow-fsm" },
          routing: { provider: "codex", model: "gpt-5.4", reasoningEffort: "high", overlays: ["workflow-audit"] },
          blockingVerdict: "PASS",
        })],
      }),
      makeCompletedIssue({
        id: "route-2",
        identifier: "#R2",
        reviewRuns: [makeReviewRun({
          reviewProfile: { ...makeReviewRun().reviewProfile, primary: "workflow-fsm" },
          routing: { provider: "codex", model: "gpt-5.4", reasoningEffort: "high", overlays: ["workflow-audit"] },
          blockingVerdict: "PASS",
        })],
      }),
      makeCompletedIssue({
        id: "route-3",
        identifier: "#R3",
        reviewRuns: [makeReviewRun({
          reviewProfile: { ...makeReviewRun().reviewProfile, primary: "workflow-fsm" },
          routing: { provider: "codex", model: "gpt-5.4", reasoningEffort: "high", overlays: ["workflow-audit"] },
          blockingVerdict: "PASS",
        })],
      }),
      makeCompletedIssue({
        id: "route-4",
        identifier: "#R4",
        reviewRuns: [makeReviewRun({
          reviewProfile: { ...makeReviewRun().reviewProfile, primary: "workflow-fsm" },
          routing: { provider: "claude", model: "opus", reasoningEffort: "high", overlays: ["workflow-audit"] },
          blockingVerdict: "FAIL",
        })],
      }),
    ];

    const recommendation = recommendReviewRouteForIssue(
      historicalIssues,
      currentIssue,
      [claudeCandidate, codexCandidate],
      3,
    );

    assert.ok(recommendation);
    assert.equal(buildReviewRouteKey(recommendation!.candidate), buildReviewRouteKey(codexCandidate));
    assert.equal(recommendation?.basis, "historical");
    assert.match(recommendation?.rationale || "", /gate pass/i);
  });

  it("falls back to profile affinity when history is sparse", () => {
    const currentIssue = makeIssue({
      title: "Polish onboarding drawer",
      labels: ["frontend", "ux"],
      plan: makePlan({
        suggestedPaths: ["app/src/components/OnboardingDrawer.tsx"],
        acceptanceCriteria: [
          {
            id: "AC-1",
            description: "Drawer feels polished",
            category: "design",
            verificationMethod: "ui_walkthrough",
            evidenceExpected: "Visual polish verified",
            blocking: true,
            weight: 3,
          },
        ],
      }),
    });

    const recommendation = recommendReviewRouteForIssue([], currentIssue, [codexCandidate, claudeCandidate], 3);

    assert.ok(recommendation);
    assert.equal(buildReviewRouteKey(recommendation!.candidate), buildReviewRouteKey(claudeCandidate));
    assert.equal(recommendation?.basis, "heuristic");
  });
});
