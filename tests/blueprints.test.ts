import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IssueEntry, IssuePlan, RuntimeConfig } from "../src/types.ts";
import {
  attachNodeArtifacts,
  BLUEPRINT_EXECUTION_NODE_IDS,
  buildHarnessBlueprint,
  finalizeBlueprintRun,
  startBlueprintRun,
  updateBlueprintNodeRun,
  writeBlueprintArtifact,
  writeBlueprintJsonArtifact,
} from "../src/agents/blueprints.ts";

function makeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    pollIntervalMs: 1000,
    workerConcurrency: 1,
    maxConcurrentByState: {},
    commandTimeoutMs: 60_000,
    maxAttemptsDefault: 2,
    maxTurns: 8,
    retryDelayMs: 1000,
    staleInProgressTimeoutMs: 60_000,
    logLinesTail: 4000,
    maxPreviousOutputChars: 4000,
    agentProvider: "codex",
    agentCommand: "codex exec",
    defaultEffort: { default: "medium" },
    runMode: "filesystem",
    autoReviewApproval: false,
    dockerExecution: false,
    dockerImage: "fifony-agent:latest",
    afterCreateHook: "",
    beforeRunHook: "",
    afterRunHook: "",
    beforeRemoveHook: "",
    ...overrides,
  };
}

function makePlan(overrides: Partial<IssuePlan> = {}): IssuePlan {
  return {
    summary: "Blueprint fixture plan",
    estimatedComplexity: "medium",
    harnessMode: "standard",
    steps: [{ step: 1, action: "Implement feature" }],
    acceptanceCriteria: [{
      id: "AC-1",
      description: "Feature works",
      category: "functionality",
      verificationMethod: "manual",
      evidenceExpected: "working flow",
      blocking: true,
      weight: 3,
    }],
    executionContract: {
      summary: "Execute and validate",
      deliverables: ["feature"],
      requiredChecks: ["pnpm test"],
      requiredEvidence: ["test output"],
      focusAreas: ["src/index.ts"],
      checkpointPolicy: "final_only",
    },
    suggestedPaths: ["src/index.ts"],
    suggestedSkills: [],
    suggestedAgents: [],
    suggestedEffort: { default: "medium" },
    provider: "codex",
    createdAt: "2026-03-26T00:00:00.000Z",
    ...overrides,
  };
}

function makeIssue(plan: IssuePlan): IssueEntry {
  return {
    id: "issue-1",
    identifier: "#1",
    title: "Blueprint issue",
    description: "Test issue",
    state: "Running",
    labels: [],
    blockedBy: [],
    assignedToWorker: true,
    createdAt: "2026-03-26T00:00:00.000Z",
    updatedAt: "2026-03-26T00:00:00.000Z",
    history: [],
    attempts: 0,
    maxAttempts: 2,
    planVersion: 1,
    executeAttempt: 1,
    reviewAttempt: 0,
    plan,
  };
}

describe("buildHarnessBlueprint", () => {
  it("creates an unattended blueprint with checkpoint review for contractual plans", () => {
    const blueprint = buildHarnessBlueprint(makePlan({
      harnessMode: "contractual",
      estimatedComplexity: "high",
      suggestedAgents: ["code-reviewer"],
      executionContract: {
        summary: "Contractual execution",
        deliverables: ["feature"],
        requiredChecks: [],
        requiredEvidence: [],
        focusAreas: ["src/fsm.ts"],
        checkpointPolicy: "checkpointed",
      },
    }), makeConfig({ maxBudgetUsd: 12 }));

    assert.equal(blueprint.mode, "unattended");
    assert.equal(blueprint.checkpointPolicy, "checkpointed");
    assert.equal(blueprint.delegationPolicy.mode, "governed");
    assert.equal(blueprint.budgetPolicy.maxRemoteRounds, 2);
    assert.ok(blueprint.nodes.some((entry) => entry.id === BLUEPRINT_EXECUTION_NODE_IDS.checkpointReview));
  });

  it("omits checkpoint review for final-only plans", () => {
    const blueprint = buildHarnessBlueprint(makePlan(), makeConfig());

    assert.equal(blueprint.checkpointPolicy, "final_only");
    assert.ok(!blueprint.nodes.some((entry) => entry.id === BLUEPRINT_EXECUTION_NODE_IDS.checkpointReview));
  });
});

describe("blueprint artifact persistence", () => {
  it("writes node artifacts and tracks run state", () => {
    const plan = makePlan();
    const issue = makeIssue(plan);
    const blueprint = buildHarnessBlueprint(plan, makeConfig());
    const run = startBlueprintRun(issue, blueprint, "execute");
    const workspacePath = mkdtempSync(join(tmpdir(), "fifony-blueprint-"));

    updateBlueprintNodeRun(run, BLUEPRINT_EXECUTION_NODE_IDS.implement, "running");
    const summaryArtifact = writeBlueprintArtifact(
      workspacePath,
      run.id,
      BLUEPRINT_EXECUTION_NODE_IDS.implement,
      "summary",
      "# Summary\n\nImplemented work.\n",
    );
    const jsonArtifact = writeBlueprintJsonArtifact(
      workspacePath,
      run.id,
      BLUEPRINT_EXECUTION_NODE_IDS.implement,
      "result",
      { ok: true },
    );
    attachNodeArtifacts(run, BLUEPRINT_EXECUTION_NODE_IDS.implement, [summaryArtifact, jsonArtifact]);
    updateBlueprintNodeRun(run, BLUEPRINT_EXECUTION_NODE_IDS.implement, "completed");
    finalizeBlueprintRun(run, "completed");

    assert.equal(run.status, "completed");
    assert.equal(issue.blueprintRuns?.length, 1);
    assert.equal(run.nodes.find((entry) => entry.nodeId === BLUEPRINT_EXECUTION_NODE_IDS.implement)?.artifacts.length, 2);
    assert.match(readFileSync(summaryArtifact.path, "utf8"), /Implemented work/);
    assert.match(readFileSync(jsonArtifact.path, "utf8"), /"ok": true/);
  });
});
