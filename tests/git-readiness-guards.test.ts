import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IssueEntry, IssuePlan } from "../src/types.ts";

const TEST_ROOT = mkdtempSync(join(tmpdir(), "fifony-guard-test-"));
const PERSIST_ROOT = mkdtempSync(join(tmpdir(), "fifony-guard-persist-"));

process.env.FIFONY_WORKSPACE_ROOT = TEST_ROOT;
process.env.FIFONY_PERSISTENCE = PERSIST_ROOT;
process.env.FIFONY_LOG_LEVEL = "silent";

const { approvePlanCommand } = await import("../src/commands/approve-plan.command.ts");
const { executeIssueCommand } = await import("../src/commands/execute-issue.command.ts");

function makePlan(overrides: Partial<IssuePlan> = {}): IssuePlan {
  return {
    summary: "Guard test plan",
    estimatedComplexity: "medium",
    harnessMode: "standard",
    steps: [{ step: 1, action: "Implement guard-safe flow" }],
    acceptanceCriteria: [
      {
        id: "AC-1",
        description: "Flow can execute",
        category: "functionality",
        verificationMethod: "code_inspection",
        evidenceExpected: "Execution path is reachable",
        blocking: true,
        weight: 3,
      },
    ],
    executionContract: {
      summary: "Guard-ready execution contract",
      deliverables: ["working feature"],
      requiredChecks: [],
      requiredEvidence: [],
      focusAreas: ["src/guard.ts"],
      checkpointPolicy: "final_only",
    },
    suggestedPaths: ["src/guard.ts"],
    suggestedSkills: [],
    suggestedAgents: [],
    suggestedEffort: { default: "medium" },
    provider: "codex",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeIssue(state: IssueEntry["state"], overrides: Partial<IssueEntry> = {}): IssueEntry {
  return {
    id: `issue-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    identifier: "#1",
    title: "Guard test",
    description: "Guard test",
    state,
    labels: [],
    blockedBy: [],
    assignedToWorker: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    attempts: 0,
    maxAttempts: 3,
    plan: makePlan(),
    planningStatus: "idle",
    contractNegotiationStatus: "skipped",
    ...overrides,
  } as IssueEntry;
}

const deps = {
  issueRepository: {
    save() {},
    findById() { return null; },
    list() { return []; },
    delete() {},
    markDirty() {},
    markPlanDirty() {},
  },
  eventStore: {
    addEvent() {},
  },
};

after(() => {
  try { rmSync(TEST_ROOT, { recursive: true, force: true }); } catch {}
  try { rmSync(PERSIST_ROOT, { recursive: true, force: true }); } catch {}
});

describe("git readiness guards", () => {
  it("approvePlanCommand rejects contractual plans before touching git when negotiation is not approved", async () => {
    const issue = makeIssue("Planning", {
      plan: makePlan({ harnessMode: "contractual", executionContract: { ...makePlan().executionContract, checkpointPolicy: "checkpointed" } }),
      contractNegotiationStatus: "failed",
    });

    await assert.rejects(
      () => approvePlanCommand({ issue }, deps),
      /requires approved contract negotiation/i,
    );

    assert.equal(issue.state, "Planning");
  });

  it("approvePlanCommand fails fast when the target workspace is not a git repo", async () => {
    const issue = makeIssue("Planning");

    await assert.rejects(
      () => approvePlanCommand({ issue }, deps),
      /requires a git repository with at least one commit/i,
    );

    assert.equal(issue.state, "Planning");
  });

  it("executeIssueCommand rejects contractual plans before touching git when negotiation is not approved", async () => {
    const issue = makeIssue("PendingApproval", {
      plan: makePlan({ harnessMode: "contractual", executionContract: { ...makePlan().executionContract, checkpointPolicy: "checkpointed" } }),
      contractNegotiationStatus: "running",
    });

    await assert.rejects(
      () => executeIssueCommand({ issue }, deps),
      /contract negotiation is still running/i,
    );

    assert.equal(issue.state, "PendingApproval");
  });

  it("executeIssueCommand fails fast when the target workspace is not a git repo", async () => {
    const issue = makeIssue("PendingApproval");

    await assert.rejects(
      () => executeIssueCommand({ issue }, deps),
      /requires a git repository with at least one commit/i,
    );

    assert.equal(issue.state, "PendingApproval");
  });
});
