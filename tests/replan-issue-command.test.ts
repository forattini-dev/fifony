import { after, before } from "node:test";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IssueEntry } from "../src/types.ts";
import { setEnqueueFn } from "../src/persistence/plugins/fsm-issue.ts";

function makeIssue(overrides: Partial<IssueEntry> = {}): IssueEntry {
  const createdAt = "2026-03-26T00:00:00.000Z";
  return {
    id: "issue-replan-1",
    identifier: "#REPLAN-1",
    title: "Replan issue",
    description: "Allow replanning from an active execution state",
    state: "Running",
    labels: [],
    blockedBy: [],
    assignedToWorker: true,
    createdAt,
    updatedAt: createdAt,
    history: [],
    attempts: 1,
    maxAttempts: 3,
    planVersion: 2,
    executeAttempt: 3,
    reviewAttempt: 1,
    plan: {
      summary: "Current plan",
      estimatedComplexity: "high",
      harnessMode: "contractual",
      steps: [{ step: 1, action: "Ship feature" }],
      acceptanceCriteria: [],
      executionContract: {
        summary: "Current contract",
        deliverables: ["feature"],
        requiredChecks: [],
        requiredEvidence: [],
        focusAreas: [],
        checkpointPolicy: "checkpointed",
      },
      suggestedPaths: [],
      suggestedSkills: [],
      suggestedAgents: [],
      suggestedEffort: {},
      provider: "codex",
      createdAt,
    },
    ...overrides,
  };
}

function makeDeps() {
  const events: Array<{ issueId: string | undefined; kind: string; message: string }> = [];
  return {
    deps: {
      issueRepository: {
        save() {},
        findById() { return undefined; },
        findAll() { return []; },
        markDirty() {},
      },
      eventStore: {
        addEvent(issueId: string | undefined, kind: string, message: string) {
          events.push({ issueId, kind, message });
        },
        async listEvents() { return []; },
      },
    },
    events,
  };
}

describe("replanIssueCommand", () => {
  before(() => {
    setEnqueueFn(async () => {});
  });

  after(() => {
    setEnqueueFn(null);
  });

  it("can replan an actively running issue and resets execution counters", async () => {
    const { replanIssueCommand } = await import("../src/commands/replan-issue.command.ts");
    const issue = makeIssue();
    const { deps, events } = makeDeps();

    await replanIssueCommand({ issue }, deps);

    assert.equal(issue.state, "Planning");
    assert.equal(issue.plan, undefined);
    assert.equal(issue.planVersion, 3);
    assert.equal(issue.executeAttempt, 0);
    assert.equal(issue.reviewAttempt, 0);
    assert.equal(issue.planningStatus, "idle");
    assert.equal(events.length, 1);
    assert.match(events[0].message, /Replan requested/i);
  });
});
