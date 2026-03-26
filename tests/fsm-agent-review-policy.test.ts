import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyHarnessReviewPolicy, resolveHarnessMode, requiresCheckpointReview } from "../src/persistence/plugins/fsm-agent.ts";
import type { GradingReport, IssueEntry } from "../src/types.ts";

function makeIssue(overrides: Partial<IssueEntry> = {}): IssueEntry {
  return {
    id: "fsm-agent-policy-1",
    identifier: "#FSM-1",
    title: "Enforce contractual review policy",
    description: "Test contractual harness policy normalization",
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
    reviewAttempt: 0,
    plan: {
      summary: "Protect review with canonical contractual criteria",
      estimatedComplexity: "high",
      harnessMode: "contractual",
      steps: [
        { step: 1, action: "Implement review gate" },
      ],
      acceptanceCriteria: [
        {
          id: "AC-1",
          description: "Critical path works",
          category: "functionality",
          verificationMethod: "ui_walkthrough",
          evidenceExpected: "Flow succeeds in the UI",
          blocking: true,
          weight: 3,
        },
        {
          id: "AC-2",
          description: "Tests pass",
          category: "validation",
          verificationMethod: "run_command",
          evidenceExpected: "pnpm test exits 0",
          blocking: true,
          weight: 3,
        },
      ],
      executionContract: {
        summary: "Feature is implemented and reviewed against the contract",
        deliverables: ["working feature"],
        requiredChecks: ["pnpm test"],
        requiredEvidence: ["UI flow works", "Tests pass"],
        focusAreas: ["src/feature.ts"],
        checkpointPolicy: "checkpointed",
      },
      suggestedPaths: ["src/feature.ts"],
      suggestedSkills: [],
      suggestedAgents: [],
      suggestedEffort: { executor: "high", reviewer: "medium" },
      provider: "claude",
      createdAt: "2026-03-26T00:00:00.000Z",
    },
    ...overrides,
  };
}

function makeReport(overrides: Partial<GradingReport> = {}): GradingReport {
  return {
    scope: "final",
    overallVerdict: "PASS",
    blockingVerdict: "PASS",
    reviewAttempt: 1,
    criteria: [
      {
        id: "AC-1",
        description: "Wrong text that should be replaced",
        category: "design",
        verificationMethod: "code_inspection",
        evidenceExpected: "n/a",
        blocking: true,
        weight: 1,
        result: "PASS",
        evidence: "UI flow was exercised",
      },
    ],
    ...overrides,
  };
}

describe("resolveHarnessMode", () => {
  it("defaults missing plans to standard", () => {
    const issue = makeIssue({ plan: undefined });
    assert.equal(resolveHarnessMode(issue), "standard");
  });

  it("returns the configured harness mode", () => {
    assert.equal(resolveHarnessMode(makeIssue()), "contractual");
  });
});

describe("requiresCheckpointReview", () => {
  it("requires checkpoint only for contractual checkpointed plans without a pass timestamp", () => {
    assert.equal(requiresCheckpointReview(makeIssue()), true);
    assert.equal(requiresCheckpointReview(makeIssue({ checkpointPassedAt: "2026-03-26T00:00:00.000Z" })), false);
    assert.equal(requiresCheckpointReview(makeIssue({
      plan: {
        ...makeIssue().plan!,
        harnessMode: "standard",
      },
    })), false);
    assert.equal(requiresCheckpointReview(makeIssue({
      plan: {
        ...makeIssue().plan!,
        executionContract: {
          ...makeIssue().plan!.executionContract,
          checkpointPolicy: "final_only",
        },
      },
    })), false);
  });
});

describe("applyHarnessReviewPolicy", () => {
  it("injects missing contractual criteria as FAIL", () => {
    const issue = makeIssue();
    const report = makeReport();
    const normalized = applyHarnessReviewPolicy(issue, report);

    assert.equal(normalized.overallVerdict, "FAIL");
    assert.equal(normalized.blockingVerdict, "FAIL");
    assert.equal(normalized.criteria.length, 2);
    const missing = normalized.criteria.find((criterion) => criterion.id === "AC-2");
    assert.ok(missing, "missing contractual criterion should be synthesized");
    assert.equal(missing?.result, "FAIL");
    assert.match(missing?.evidence || "", /did not evaluate this required blocking criterion/i);
  });

  it("rewrites reviewer metadata to the canonical plan criterion", () => {
    const issue = makeIssue();
    const report = makeReport();
    const normalized = applyHarnessReviewPolicy(issue, report);
    const criterion = normalized.criteria.find((entry) => entry.id === "AC-1");

    assert.ok(criterion);
    assert.equal(criterion?.description, "Wrong text that should be replaced");
    assert.equal(criterion?.category, "functionality");
    assert.equal(criterion?.verificationMethod, "ui_walkthrough");
    assert.equal(criterion?.evidenceExpected, "Flow succeeds in the UI");
    assert.equal(criterion?.weight, 3);
  });

  it("turns SKIP on blocking contractual criteria into FAIL", () => {
    const issue = makeIssue();
    const report = makeReport({
      criteria: [
        {
          id: "AC-1",
          description: "Skipped criterion",
          category: "functionality",
          verificationMethod: "ui_walkthrough",
          evidenceExpected: "Flow succeeds in the UI",
          blocking: true,
          weight: 3,
          result: "SKIP",
          evidence: "Reviewer could not exercise the UI",
        },
        {
          id: "AC-2",
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
    });
    const normalized = applyHarnessReviewPolicy(issue, report);

    const criterion = normalized.criteria.find((entry) => entry.id === "AC-1");
    assert.equal(criterion?.result, "FAIL");
    assert.match(criterion?.evidence || "", /skipped a blocking contractual criterion/i);
    assert.equal(normalized.overallVerdict, "FAIL");
    assert.equal(normalized.blockingVerdict, "FAIL");
  });

  it("treats advisory failures as non-blocking gate findings", () => {
    const issue = makeIssue({
      plan: {
        ...makeIssue().plan!,
        acceptanceCriteria: [
          ...makeIssue().plan!.acceptanceCriteria,
          {
            id: "AC-3",
            description: "Visual polish remains coherent",
            category: "design",
            verificationMethod: "ui_walkthrough",
            evidenceExpected: "No obvious polish regressions",
            blocking: false,
            weight: 1,
          },
        ],
      },
    });
    const report = makeReport({
      criteria: [
        {
          id: "AC-1",
          description: "Critical path works",
          category: "functionality",
          verificationMethod: "ui_walkthrough",
          evidenceExpected: "Flow succeeds in the UI",
          blocking: true,
          weight: 3,
          result: "PASS",
          evidence: "Critical path succeeded",
        },
        {
          id: "AC-2",
          description: "Tests pass",
          category: "validation",
          verificationMethod: "run_command",
          evidenceExpected: "pnpm test exits 0",
          blocking: true,
          weight: 3,
          result: "PASS",
          evidence: "pnpm test passed",
        },
        {
          id: "AC-3",
          description: "Visual polish remains coherent",
          category: "design",
          verificationMethod: "ui_walkthrough",
          evidenceExpected: "No obvious polish regressions",
          blocking: false,
          weight: 1,
          result: "FAIL",
          evidence: "Spacing is uneven in the empty state",
        },
      ],
    });

    const normalized = applyHarnessReviewPolicy(issue, report);

    assert.equal(normalized.overallVerdict, "FAIL");
    assert.equal(normalized.blockingVerdict, "PASS");
    assert.equal(normalized.scope, "final");
  });

  it("synthesizes missing advisory checkpoint criteria as SKIP", () => {
    const issue = makeIssue({
      plan: {
        ...makeIssue().plan!,
        acceptanceCriteria: [
          ...makeIssue().plan!.acceptanceCriteria,
          {
            id: "AC-3",
            description: "Polish note",
            category: "design",
            verificationMethod: "ui_walkthrough",
            evidenceExpected: "No obvious polish regressions",
            blocking: false,
            weight: 1,
          },
        ],
      },
    });

    const normalized = applyHarnessReviewPolicy(issue, makeReport({
      criteria: [
        {
          id: "AC-1",
          description: "Critical path works",
          category: "functionality",
          verificationMethod: "ui_walkthrough",
          evidenceExpected: "Flow succeeds in the UI",
          blocking: true,
          weight: 3,
          result: "PASS",
          evidence: "Critical path succeeded",
        },
        {
          id: "AC-2",
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
    }), "checkpoint");

    const advisory = normalized.criteria.find((entry) => entry.id === "AC-3");
    assert.equal(advisory?.result, "SKIP");
    assert.match(advisory?.evidence || "", /checkpoint gate deferred this advisory criterion/i);
    assert.equal(normalized.overallVerdict, "PASS");
    assert.equal(normalized.blockingVerdict, "PASS");
    assert.equal(normalized.scope, "checkpoint");
  });

  it("leaves standard mode reports unchanged apart from overall verdict recomputation", () => {
    const issue = makeIssue({
      plan: {
        ...makeIssue().plan!,
        harnessMode: "standard",
      },
    });
    const report = makeReport({
      overallVerdict: "PASS",
      criteria: [
        {
          id: "AC-X",
          description: "Ad hoc reviewer note",
          category: "design",
          verificationMethod: "code_inspection",
          evidenceExpected: "n/a",
          blocking: false,
          weight: 1,
          result: "FAIL",
          evidence: "Looks broken",
        },
      ],
    });
    const normalized = applyHarnessReviewPolicy(issue, report);

    assert.equal(normalized.criteria.length, 1);
    assert.equal(normalized.criteria[0]?.id, "AC-X");
    assert.equal(normalized.criteria[0]?.category, "design");
    assert.equal(normalized.overallVerdict, "FAIL");
    assert.equal(normalized.blockingVerdict, "PASS");
  });
});
