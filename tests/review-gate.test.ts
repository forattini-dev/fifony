/**
 * Review gate invariant tests — verifies that Reviewing state
 * cannot approve, merge, or push directly. Only PendingDecision
 * and Approved can proceed to merge or push.
 *
 * Run with: pnpm test tests/review-gate.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getPlanCommand } from "../src/agents/planning/planning-prompts.ts";

// ── FSM state machine definition tests ────────────────────────────────────────

describe("review gate: FSM invariants", () => {
  // Import the state machine config to test transitions
  it("Reviewing state has no MERGE event", async () => {
    const { issueStateMachineConfig, ISSUE_STATE_MACHINE_ID } = await import("../src/persistence/plugins/issue-state-machine.ts");
    const config = issueStateMachineConfig.stateMachines[ISSUE_STATE_MACHINE_ID];
    const reviewingState = config.states.Reviewing;
    assert.ok(reviewingState, "Reviewing state exists");
    const events = Object.keys(reviewingState.on || {});
    assert.ok(!events.includes("MERGE"), "Reviewing cannot fire MERGE");
    assert.ok(!events.includes("APPROVE"), "Reviewing cannot fire APPROVE");
  });

  it("Reviewing can only transition to PendingDecision, Queued, or Blocked", async () => {
    const { issueStateMachineConfig, ISSUE_STATE_MACHINE_ID } = await import("../src/persistence/plugins/issue-state-machine.ts");
    const config = issueStateMachineConfig.stateMachines[ISSUE_STATE_MACHINE_ID];
    const targets = Object.values(config.states.Reviewing.on || {});
    const allowed = new Set(["PendingDecision", "Queued", "Blocked"]);
    for (const target of targets) {
      assert.ok(allowed.has(target as string), `Reviewing -> ${target} must be in allowed set`);
    }
  });

  it("PendingDecision can transition to Approved (APPROVE event)", async () => {
    const { issueStateMachineConfig, ISSUE_STATE_MACHINE_ID } = await import("../src/persistence/plugins/issue-state-machine.ts");
    const config = issueStateMachineConfig.stateMachines[ISSUE_STATE_MACHINE_ID];
    const pd = config.states.PendingDecision;
    assert.ok(pd, "PendingDecision state exists");
    assert.equal(pd.on?.APPROVE, "Approved", "PendingDecision -> Approved via APPROVE");
  });

  it("Approved can transition to Merged (MERGE event)", async () => {
    const { issueStateMachineConfig, ISSUE_STATE_MACHINE_ID } = await import("../src/persistence/plugins/issue-state-machine.ts");
    const config = issueStateMachineConfig.stateMachines[ISSUE_STATE_MACHINE_ID];
    const approved = config.states.Approved;
    assert.ok(approved, "Approved state exists");
    assert.equal(approved.on?.MERGE, "Merged", "Approved -> Merged via MERGE");
  });

  it("terminal states cannot transition (except REOPEN)", async () => {
    const { issueStateMachineConfig, ISSUE_STATE_MACHINE_ID } = await import("../src/persistence/plugins/issue-state-machine.ts");
    const config = issueStateMachineConfig.stateMachines[ISSUE_STATE_MACHINE_ID];
    for (const terminal of ["Merged", "Cancelled"]) {
      const state = config.states[terminal];
      assert.ok(state, `${terminal} state exists`);
      const events = Object.keys(state.on || {});
      // Only REOPEN and ARCHIVE should be allowed from terminal states
      const allowed = new Set(["REOPEN", "ARCHIVE"]);
      for (const event of events) {
        assert.ok(allowed.has(event), `${terminal} should only have REOPEN/ARCHIVE, got ${event}`);
      }
      // Must NOT have MERGE, APPROVE, QUEUE, RUN, or REVIEW
      assert.ok(!events.includes("MERGE"), `${terminal} cannot MERGE`);
      assert.ok(!events.includes("APPROVE"), `${terminal} cannot APPROVE`);
      assert.ok(!events.includes("RUN"), `${terminal} cannot RUN`);
    }
  });
});

// ── Backend guards ────────────────────────────────────────────────────────────

describe("review gate: merge command rejects Reviewing", () => {
  it("mergeWorkspaceCommand rejects Reviewing state", async () => {
    const { mergeWorkspaceCommand } = await import("../src/commands/merge-workspace.command.ts");
    const issue = {
      id: "test-review-gate",
      identifier: "#RG",
      state: "Reviewing",
      title: "Test",
    } as any;
    const deps = {
      issueRepository: { save() {}, findById: () => null, findAll: () => [], markDirty() {} },
      eventStore: { addEvent() {} },
      persistencePort: { persistState: async () => {}, loadState: async () => null },
    };
    await assert.rejects(
      () => mergeWorkspaceCommand({ issue, state: { config: {} } as any }, deps),
      /Reviewing.*must complete first|not allowed/i,
      "merge should reject Reviewing state"
    );
  });

  it("mergeWorkspaceCommand accepts PendingDecision state", async () => {
    // We can't fully test merge (needs git repo), but we can verify
    // the state guard passes for PendingDecision
    const { mergeWorkspaceCommand } = await import("../src/commands/merge-workspace.command.ts");
    const issue = {
      id: "test-review-gate-pd",
      identifier: "#PD",
      state: "PendingDecision",
      title: "Test",
    } as any;
    const deps = {
      issueRepository: { save() {}, findById: () => null, findAll: () => [], markDirty() {} },
      eventStore: { addEvent() {} },
      persistencePort: { persistState: async () => {}, loadState: async () => null },
    };
    // Should pass state check but fail later (no git repo / missing data) — that's fine
    await assert.rejects(
      () => mergeWorkspaceCommand({ issue, state: { config: {} } as any }, deps),
      (err: Error) => !err.message.includes("not allowed") && !err.message.includes("must complete"),
      "PendingDecision should pass state guard (fail later on another reason)"
    );
  });
});

describe("review gate: push command rejects Reviewing", () => {
  it("pushWorkspaceCommand rejects Reviewing state", async () => {
    const { pushWorkspaceCommand } = await import("../src/commands/push-workspace.command.ts");
    const issue = {
      id: "test-review-gate-push",
      identifier: "#RGP",
      state: "Reviewing",
      title: "Test",
    } as any;
    const deps = {
      issueRepository: { save() {}, findById: () => null, findAll: () => [], markDirty() {} },
      eventStore: { addEvent() {} },
      persistencePort: { persistState: async () => {}, loadState: async () => null },
    };
    await assert.rejects(
      () => pushWorkspaceCommand({ issue, state: { config: {} } as any }, deps),
      /Reviewing.*must complete first|PendingDecision or Approved|only allowed/i,
      "push should reject Reviewing state",
    );
  });

  it("pushWorkspaceCommand accepts PendingDecision state", async () => {
    const { pushWorkspaceCommand } = await import("../src/commands/push-workspace.command.ts");
    const issue = {
      id: "test-review-gate-push-pd",
      identifier: "#RGPPD",
      state: "PendingDecision",
      title: "Test",
    } as any;
    const deps = {
      issueRepository: { save() {}, findById: () => null, findAll: () => [], markDirty() {} },
      eventStore: { addEvent() {} },
      persistencePort: { persistState: async () => {}, loadState: async () => null },
    };
    await assert.rejects(
      () => pushWorkspaceCommand({ issue, state: { config: {} } as any }, deps),
      (err: Error) => !err.message.includes("not allowed") && !err.message.includes("must complete"),
      "PendingDecision should pass push state guard (fail later on another reason)",
    );
  });
});
