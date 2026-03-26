import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildReviewRouteKey,
  recommendCheckpointPolicyForIssue,
  recommendHarnessModeForIssue,
  recommendReviewRouteForIssue,
  serializeReviewRouteSnapshot,
} from "../src/agents/harness-policy.ts";
import type { AgentProviderDefinition, ContractNegotiationRun, IssueEntry, IssuePlan, ReviewRun } from "../src/types.ts";

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

function makeContractNegotiationRun(overrides: Partial<ContractNegotiationRun> = {}): ContractNegotiationRun {
  return {
    id: "contract.v1a1",
    planVersion: 1,
    attempt: 1,
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
    promptFile: "/tmp/contract-prompt.md",
    startedAt: "2026-03-26T00:00:00.000Z",
    completedAt: "2026-03-26T00:00:30.000Z",
    sessionSuccess: true,
    continueRequested: false,
    blocked: false,
    exitCode: 0,
    turns: 2,
    decisionStatus: "approved",
    summary: "Contract approved",
    rationale: "Ready to execute",
    concerns: [],
    concernsCount: 0,
    blockingConcernsCount: 0,
    advisoryConcernsCount: 0,
    appliedRefinement: false,
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
  const providedReviewRuns = overrides.reviewRuns;
  const reviewRun = Array.isArray(providedReviewRuns) ? providedReviewRuns[0] : makeReviewRun();
  return makeIssue({
    state: "Merged",
    reviewProfile: reviewRun?.reviewProfile,
    gradingReport: reviewRun
      ? {
        scope: "final",
        overallVerdict: reviewRun.overallVerdict ?? "PASS",
        blockingVerdict: reviewRun.blockingVerdict ?? "PASS",
        reviewAttempt: reviewRun.attempt,
        criteria: [],
      }
      : undefined,
    reviewRuns: Array.isArray(providedReviewRuns) ? providedReviewRuns : [reviewRun],
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

  it("upgrades to contractual when negotiation history repeatedly finds contract gaps", () => {
    const currentIssue = makeIssue({
      title: "Polish onboarding drawer",
      labels: ["frontend", "ux"],
      plan: makePlan({
        estimatedComplexity: "medium",
        harnessMode: "standard",
        suggestedPaths: ["app/src/components/OnboardingDrawer.tsx"],
        acceptanceCriteria: [
          {
            id: "AC-1",
            description: "Drawer feels polished and consistent",
            category: "design",
            verificationMethod: "ui_walkthrough",
            evidenceExpected: "Interaction flow is clear",
            blocking: true,
            weight: 3,
          },
        ],
        executionContract: {
          summary: "Ship a polished onboarding drawer",
          deliverables: ["working drawer"],
          requiredChecks: [],
          requiredEvidence: [],
          focusAreas: ["app/src/components/OnboardingDrawer.tsx"],
          checkpointPolicy: "final_only",
        },
      }),
    });

    const uiProfile = { ...makeReviewRun().reviewProfile, primary: "ui-polish" as const };
    const historicalIssues = [
      makeCompletedIssue({
        id: "neg-1",
        identifier: "#N1",
        plan: makePlan({
          harnessMode: "contractual",
          estimatedComplexity: "medium",
          suggestedPaths: ["app/src/components/OnboardingDrawer.tsx"],
          acceptanceCriteria: currentIssue.plan!.acceptanceCriteria,
        }),
        contractNegotiationRuns: [
          makeContractNegotiationRun({
            reviewProfile: uiProfile,
            decisionStatus: "revise",
            summary: "Contract missed responsive states",
            blockingConcernsCount: 2,
            concernsCount: 3,
            appliedRefinement: true,
          }),
          makeContractNegotiationRun({
            id: "contract.v1a2",
            attempt: 2,
            reviewProfile: uiProfile,
            decisionStatus: "approved",
            summary: "Contract approved after refinement",
          }),
        ],
        reviewRuns: [makeReviewRun({ reviewProfile: uiProfile, blockingVerdict: "PASS" })],
      }),
      makeCompletedIssue({
        id: "neg-2",
        identifier: "#N2",
        plan: makePlan({
          harnessMode: "contractual",
          estimatedComplexity: "medium",
          suggestedPaths: ["app/src/components/OnboardingDrawer.tsx"],
          acceptanceCriteria: currentIssue.plan!.acceptanceCriteria,
        }),
        contractNegotiationRuns: [
          makeContractNegotiationRun({
            reviewProfile: uiProfile,
            decisionStatus: "revise",
            summary: "Contract missed mobile verification",
            blockingConcernsCount: 1,
            concernsCount: 2,
            appliedRefinement: true,
          }),
          makeContractNegotiationRun({
            id: "contract.v1a2",
            attempt: 2,
            reviewProfile: uiProfile,
            decisionStatus: "approved",
            summary: "Contract approved after refinement",
          }),
        ],
        reviewRuns: [makeReviewRun({ reviewProfile: uiProfile, blockingVerdict: "PASS" })],
      }),
      makeCompletedIssue({
        id: "neg-3",
        identifier: "#N3",
        plan: makePlan({
          harnessMode: "contractual",
          estimatedComplexity: "medium",
          suggestedPaths: ["app/src/components/OnboardingDrawer.tsx"],
          acceptanceCriteria: currentIssue.plan!.acceptanceCriteria,
        }),
        contractNegotiationRuns: [
          makeContractNegotiationRun({
            reviewProfile: uiProfile,
            decisionStatus: "revise",
            summary: "Contract lacked accessibility evidence",
            blockingConcernsCount: 2,
            concernsCount: 2,
            appliedRefinement: true,
          }),
          makeContractNegotiationRun({
            id: "contract.v1a2",
            attempt: 2,
            reviewProfile: uiProfile,
            decisionStatus: "approved",
            summary: "Contract approved after refinement",
          }),
        ],
        reviewRuns: [makeReviewRun({ reviewProfile: uiProfile, blockingVerdict: "PASS" })],
      }),
    ];

    const recommendation = recommendHarnessModeForIssue(historicalIssues, currentIssue, "standard", 3);

    assert.ok(recommendation);
    assert.equal(recommendation?.mode, "contractual");
    assert.equal(recommendation?.basis, "historical");
    assert.match(recommendation?.rationale || "", /contract negotiation found blocking concerns/i);
  });

  it("downgrades to standard when contractual negotiations are consistently no-op and review parity holds", () => {
    const currentIssue = makeIssue({
      title: "Refine internal notes rendering",
      plan: makePlan({
        estimatedComplexity: "medium",
        harnessMode: "contractual",
        suggestedPaths: ["src/domains/notes.ts"],
      }),
    });

    const generalProfile = makeReviewRun().reviewProfile;
    const historicalIssues = [
      makeCompletedIssue({
        id: "ctr-1",
        identifier: "#C1",
        plan: makePlan({ harnessMode: "contractual", suggestedPaths: ["src/domains/notes.ts"] }),
        contractNegotiationRuns: [makeContractNegotiationRun({ reviewProfile: generalProfile })],
        reviewRuns: [makeReviewRun({ reviewProfile: generalProfile, blockingVerdict: "PASS" })],
      }),
      makeCompletedIssue({
        id: "ctr-2",
        identifier: "#C2",
        plan: makePlan({ harnessMode: "contractual", suggestedPaths: ["src/domains/notes.ts"] }),
        contractNegotiationRuns: [makeContractNegotiationRun({ reviewProfile: generalProfile })],
        reviewRuns: [makeReviewRun({ reviewProfile: generalProfile, blockingVerdict: "PASS" })],
      }),
      makeCompletedIssue({
        id: "ctr-3",
        identifier: "#C3",
        plan: makePlan({ harnessMode: "contractual", suggestedPaths: ["src/domains/notes.ts"] }),
        contractNegotiationRuns: [makeContractNegotiationRun({ reviewProfile: generalProfile })],
        reviewRuns: [makeReviewRun({ reviewProfile: generalProfile, blockingVerdict: "PASS" })],
      }),
      makeCompletedIssue({
        id: "std-1",
        identifier: "#S1",
        plan: makePlan({ harnessMode: "standard", suggestedPaths: ["src/domains/notes.ts"] }),
        reviewRuns: [makeReviewRun({ reviewProfile: generalProfile, blockingVerdict: "PASS" })],
      }),
      makeCompletedIssue({
        id: "std-2",
        identifier: "#S2",
        plan: makePlan({ harnessMode: "standard", suggestedPaths: ["src/domains/notes.ts"] }),
        reviewRuns: [makeReviewRun({ reviewProfile: generalProfile, blockingVerdict: "PASS" })],
      }),
      makeCompletedIssue({
        id: "std-3",
        identifier: "#S3",
        plan: makePlan({ harnessMode: "standard", suggestedPaths: ["src/domains/notes.ts"] }),
        reviewRuns: [makeReviewRun({ reviewProfile: generalProfile, blockingVerdict: "PASS" })],
      }),
    ];

    const recommendation = recommendHarnessModeForIssue(historicalIssues, currentIssue, "contractual", 3);

    assert.ok(recommendation);
    assert.equal(recommendation?.mode, "standard");
    assert.equal(recommendation?.basis, "historical");
    assert.match(recommendation?.rationale || "", /approved on first pass/i);
  });
});

describe("recommendCheckpointPolicyForIssue", () => {
  it("enables checkpointed review heuristically for high-risk contractual work", () => {
    const currentIssue = makeIssue({
      title: "Tighten workflow lifecycle invariants",
      labels: ["workflow", "fsm"],
      plan: makePlan({
        estimatedComplexity: "high",
        harnessMode: "contractual",
        suggestedPaths: ["src/persistence/plugins/fsm-agent.ts"],
        executionContract: {
          ...makePlan().executionContract,
          focusAreas: ["src/persistence/plugins/fsm-agent.ts"],
          checkpointPolicy: "final_only",
        },
      }),
    });

    const recommendation = recommendCheckpointPolicyForIssue([], currentIssue, "final_only", 3);

    assert.ok(recommendation);
    assert.equal(recommendation?.checkpointPolicy, "checkpointed");
    assert.equal(recommendation?.basis, "heuristic");
  });

  it("upgrades to checkpointed when checkpoint history catches issues before final review", () => {
    const currentIssue = makeIssue({
      title: "Improve integration safety for sync pipeline",
      plan: makePlan({
        estimatedComplexity: "medium",
        harnessMode: "contractual",
        suggestedPaths: ["src/domains/workspace.ts"],
        executionContract: {
          ...makePlan().executionContract,
          focusAreas: ["src/domains/workspace.ts"],
          checkpointPolicy: "final_only",
        },
      }),
    });

    const integrationProfile = { ...makeReviewRun().reviewProfile, primary: "integration-safety" as const };
    const checkpointedHistory = ["cp-1", "cp-2", "cp-3"].map((id, index) => makeCompletedIssue({
      id,
      identifier: `#${id.toUpperCase()}`,
      plan: makePlan({
        harnessMode: "contractual",
        suggestedPaths: ["src/domains/workspace.ts"],
        executionContract: {
          ...makePlan().executionContract,
          focusAreas: ["src/domains/workspace.ts"],
          checkpointPolicy: "checkpointed",
        },
      }),
      reviewRuns: [
        makeReviewRun({
          id: `review.checkpoint.${id}`,
          scope: "checkpoint",
          attempt: 1,
          cycle: 101,
          reviewProfile: integrationProfile,
          blockingVerdict: index === 0 ? "FAIL" : "PASS",
          overallVerdict: index === 0 ? "FAIL" : "PASS",
        }),
        makeReviewRun({
          id: `review.final.${id}`,
          scope: "final",
          attempt: 1,
          cycle: 1,
          reviewProfile: integrationProfile,
          blockingVerdict: "PASS",
        }),
      ],
    }));
    const finalOnlyHistory = ["fo-1", "fo-2", "fo-3"].map((id) => makeCompletedIssue({
      id,
      identifier: `#${id.toUpperCase()}`,
      plan: makePlan({
        harnessMode: "contractual",
        suggestedPaths: ["src/domains/workspace.ts"],
        executionContract: {
          ...makePlan().executionContract,
          focusAreas: ["src/domains/workspace.ts"],
          checkpointPolicy: "final_only",
        },
      }),
      reviewRuns: [makeReviewRun({
        id: `review.final.${id}`,
        scope: "final",
        reviewProfile: integrationProfile,
        blockingVerdict: "PASS",
      })],
    }));

    const recommendation = recommendCheckpointPolicyForIssue(
      [...checkpointedHistory, ...finalOnlyHistory],
      currentIssue,
      "final_only",
      3,
    );

    assert.ok(recommendation);
    assert.equal(recommendation?.checkpointPolicy, "checkpointed");
    assert.equal(recommendation?.basis, "historical");
    assert.match(recommendation?.rationale || "", /checkpointed runs caught blocking issues/i);
  });

  it("downgrades to final_only when checkpoints add little value", () => {
    const currentIssue = makeIssue({
      title: "Polish internal notes rendering",
      plan: makePlan({
        estimatedComplexity: "medium",
        harnessMode: "contractual",
        suggestedPaths: ["src/domains/notes.ts"],
        executionContract: {
          ...makePlan().executionContract,
          focusAreas: ["src/domains/notes.ts"],
          checkpointPolicy: "checkpointed",
        },
      }),
    });

    const generalProfile = makeReviewRun().reviewProfile;
    const checkpointedHistory = ["cp-low-1", "cp-low-2", "cp-low-3"].map((id) => makeCompletedIssue({
      id,
      identifier: `#${id.toUpperCase()}`,
      plan: makePlan({
        harnessMode: "contractual",
        suggestedPaths: ["src/domains/notes.ts"],
        executionContract: {
          ...makePlan().executionContract,
          focusAreas: ["src/domains/notes.ts"],
          checkpointPolicy: "checkpointed",
        },
      }),
      reviewRuns: [
        makeReviewRun({
          id: `review.checkpoint.${id}`,
          scope: "checkpoint",
          attempt: 1,
          cycle: 101,
          reviewProfile: generalProfile,
          blockingVerdict: "PASS",
        }),
        makeReviewRun({
          id: `review.final.${id}`,
          scope: "final",
          attempt: 1,
          cycle: 1,
          reviewProfile: generalProfile,
          blockingVerdict: "PASS",
        }),
      ],
    }));
    const finalOnlyHistory = ["fo-low-1", "fo-low-2", "fo-low-3"].map((id) => makeCompletedIssue({
      id,
      identifier: `#${id.toUpperCase()}`,
      plan: makePlan({
        harnessMode: "contractual",
        suggestedPaths: ["src/domains/notes.ts"],
        executionContract: {
          ...makePlan().executionContract,
          focusAreas: ["src/domains/notes.ts"],
          checkpointPolicy: "final_only",
        },
      }),
      reviewRuns: [makeReviewRun({
        id: `review.final.${id}`,
        scope: "final",
        reviewProfile: generalProfile,
        blockingVerdict: "PASS",
      })],
    }));

    const recommendation = recommendCheckpointPolicyForIssue(
      [...checkpointedHistory, ...finalOnlyHistory],
      currentIssue,
      "checkpointed",
      3,
    );

    assert.ok(recommendation);
    assert.equal(recommendation?.checkpointPolicy, "final_only");
    assert.equal(recommendation?.basis, "historical");
    assert.match(recommendation?.rationale || "", /almost never catch issues/i);
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
