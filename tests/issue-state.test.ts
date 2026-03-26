import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { now } from "../src/concerns/helpers.ts";
import { clearDirtyIssueIds, snapshotAndClearDirtyIssueIds } from "../src/persistence/dirty-tracker.ts";
import { syncIssueStateInMemory, syncIssueStateFromFsm } from "../src/domains/issue-state.ts";
import {
  getIssueStateMachinePlugin,
  setIssueStateMachinePlugin,
} from "../src/persistence/plugins/fsm-issue.ts";
import type { IssueEntry } from "../src/types.ts";

function createIssue(overrides: Partial<IssueEntry> = {}): IssueEntry {
  return {
    id: "issue-state-test-1",
    identifier: "ISS-1",
    title: "Issue state fixture",
    description: "Issue used by domain state sync tests.",
    state: "Queued",
    labels: [],
    paths: [],
    blockedBy: [],
    assignedToWorker: false,
    createdAt: "2026-03-26T00:00:00.000Z",
    updatedAt: "2026-03-26T00:00:00.000Z",
    history: [],
    attempts: 0,
    maxAttempts: 3,
    planVersion: 1,
    executeAttempt: 0,
    reviewAttempt: 0,
    ...overrides,
  } as IssueEntry;
}

describe("issue state synchronization", () => {
  it("does not modify state when the in-memory state already matches target", () => {
    const issue = createIssue({ state: "Running", updatedAt: "2026-03-26T12:00:00.000Z" });

    clearDirtyIssueIds();

    const result = syncIssueStateInMemory(issue, "Running", { reason: "No-op test" });

    assert.equal(result.changed, false);
    assert.equal(result.previousState, "Running");
    assert.equal(result.currentState, "Running");
    assert.equal(issue.state, "Running");
    assert.equal(issue.updatedAt, "2026-03-26T12:00:00.000Z");
    assert.equal(issue.history.length, 0);
    assert.equal(snapshotAndClearDirtyIssueIds().has(issue.id), false);
  });

  it("updates state, timestamp and history when target state differs", () => {
    const issue = createIssue({
      updatedAt: "2026-03-26T12:00:00.000Z",
      state: "Queued",
      history: ["[legacy] initial"],
    });

    clearDirtyIssueIds();

    const result = syncIssueStateInMemory(issue, "Running", { reason: "Manual reconciliation after crash." });

    assert.equal(result.changed, true);
    assert.equal(result.previousState, "Queued");
    assert.equal(result.currentState, "Running");
    assert.equal(issue.state, "Running");
    assert.ok(Date.parse(issue.updatedAt) > Date.parse("2026-03-26T12:00:00.000Z"));
    assert.equal(issue.history.length, 2);
    assert.ok(issue.history[1]?.includes("Manual reconciliation after crash."));
    assert.equal(snapshotAndClearDirtyIssueIds().has(issue.id), true);
  });

  it("reconciles from FSM source of truth when memory is stale", async () => {
    const issue = createIssue({
      state: "Queued",
      updatedAt: now(),
      history: [],
    });

    const previousPlugin = getIssueStateMachinePlugin();
    setIssueStateMachinePlugin({ getState: async () => "Running" });

    try {
      clearDirtyIssueIds();
      const result = await syncIssueStateFromFsm(issue, { reason: "FSM re-sync for orphan recovery." });

      assert.equal(result.changed, true);
      assert.equal(result.previousState, "Queued");
      assert.equal(result.currentState, "Running");
      assert.equal(issue.state, "Running");
      assert.equal(issue.history.length, 1);
      assert.ok(issue.history[0]?.includes("FSM re-sync for orphan recovery."));
      assert.equal(snapshotAndClearDirtyIssueIds().has(issue.id), true);
    } finally {
      setIssueStateMachinePlugin(previousPlugin);
    }
  });

  it("keeps in-memory state unchanged when FSM plugin does not expose a source state", async () => {
    const issue = createIssue({
      state: "Running",
      updatedAt: "2026-03-26T12:00:00.000Z",
    });

    const previousPlugin = getIssueStateMachinePlugin();
    setIssueStateMachinePlugin(previousPlugin);
    clearDirtyIssueIds();

    const result = await syncIssueStateFromFsm(issue, { reason: "No plugin available." });

    assert.equal(result.changed, false);
    assert.equal(result.previousState, "Running");
    assert.equal(result.currentState, "Running");
    assert.equal(issue.state, "Running");
    assert.equal(issue.updatedAt, "2026-03-26T12:00:00.000Z");
    assert.equal(issue.history.length, 0);
    assert.equal(snapshotAndClearDirtyIssueIds().has(issue.id), false);
  });
});
