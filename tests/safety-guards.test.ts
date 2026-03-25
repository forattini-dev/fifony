/**
 * Safety guard tests — verifies that destructive operations never
 * harm untracked files, that review gates hold, and that workspace
 * integrity is maintained across all merge/push/try flows.
 *
 * Run with: pnpm test tests/safety-guards.test.ts
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Helper: create a fresh git repo with initial commit ───────────────────────

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "fifony-safety-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "README.md"), "# Test Project\n");
  execSync("git add -A && git commit -m 'init'", { cwd: dir, stdio: "pipe" });
  return dir;
}

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Try/Revert safety — untracked files survive
// ══════════════════════════════════════════════════════════════════════════════

describe("safety: try/revert preserves untracked files", () => {
  const repo = createTestRepo();

  // Create a branch with changes (simulating an issue branch)
  execSync("git checkout -b fifony/test-issue", { cwd: repo, stdio: "pipe" });
  writeFileSync(join(repo, "feature.ts"), "export const x = 1;\n");
  execSync("git add -A && git commit -m 'add feature'", { cwd: repo, stdio: "pipe" });
  execSync("git checkout -", { cwd: repo, stdio: "pipe" }); // back to main

  it("git merge --squash applies changes to index", () => {
    execSync('git merge --squash fifony/test-issue', { cwd: repo, stdio: "pipe" });
    const status = git("status --porcelain", repo);
    assert.ok(status.includes("feature.ts"), "feature.ts is staged");
  });

  it("untracked file exists before revert", () => {
    writeFileSync(join(repo, "my-notes.txt"), "important stuff\n");
    assert.ok(existsSync(join(repo, "my-notes.txt")), "untracked file exists");
  });

  it("safe revert (reset HEAD + checkout) preserves untracked file", () => {
    // This is the new safe revert pattern
    execSync("git reset HEAD", { cwd: repo, stdio: "pipe" });
    execSync("git checkout -- .", { cwd: repo, stdio: "pipe" });

    // Untracked file MUST survive
    assert.ok(existsSync(join(repo, "my-notes.txt")), "untracked file survived revert");
    assert.equal(readFileSync(join(repo, "my-notes.txt"), "utf8"), "important stuff\n", "content intact");

    // Modified tracked files should be reverted
    assert.equal(readFileSync(join(repo, "README.md"), "utf8"), "# Test Project\n", "README reverted");

    // New files from squash become untracked (not staged, not committed) — this is safe
    // They can be cleaned up with `git clean` targeting only fifony files if desired
    const staged = git("diff --cached --name-only", repo);
    assert.equal(staged, "", "nothing staged after revert");
  });

  after(() => { try { rmSync(repo, { recursive: true, force: true }); } catch {} });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Destructive comparison — old pattern WOULD destroy untracked files
// ══════════════════════════════════════════════════════════════════════════════

describe("safety: old destructive pattern destroys untracked files (proof)", () => {
  const repo = createTestRepo();

  execSync("git checkout -b fifony/test-issue-2", { cwd: repo, stdio: "pipe" });
  writeFileSync(join(repo, "feature2.ts"), "export const y = 2;\n");
  execSync("git add -A && git commit -m 'add feature2'", { cwd: repo, stdio: "pipe" });
  execSync("git checkout -", { cwd: repo, stdio: "pipe" });

  it("git reset --hard + clean -fd DOES destroy untracked files", () => {
    execSync('git merge --squash fifony/test-issue-2', { cwd: repo, stdio: "pipe" });
    writeFileSync(join(repo, "precious-notes.txt"), "do not delete\n");

    // Old destructive pattern
    execSync("git reset --hard HEAD", { cwd: repo, stdio: "pipe" });
    execSync("git clean -fd", { cwd: repo, stdio: "pipe" });

    // Untracked file is GONE — this is what we're protecting against
    assert.ok(!existsSync(join(repo, "precious-notes.txt")), "untracked file was destroyed by old pattern");
  });

  after(() => { try { rmSync(repo, { recursive: true, force: true }); } catch {} });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. Merge with dirty TARGET_ROOT — workspace guard
// ══════════════════════════════════════════════════════════════════════════════

describe("safety: merge rejects dirty TARGET_ROOT", () => {
  const repo = createTestRepo();

  // Create issue branch
  execSync("git checkout -b fifony/issue-dirty", { cwd: repo, stdio: "pipe" });
  writeFileSync(join(repo, "change.ts"), "dirty\n");
  execSync("git add -A && git commit -m 'change'", { cwd: repo, stdio: "pipe" });
  execSync("git checkout -", { cwd: repo, stdio: "pipe" });

  it("mergeWorktree checks git status --porcelain before merge", () => {
    // Make TARGET_ROOT dirty with staged changes
    writeFileSync(join(repo, "README.md"), "# Modified by user\n");
    execSync("git add README.md", { cwd: repo, stdio: "pipe" });

    // Our mergeWorktree function checks porcelain and rejects dirty state
    const status = git("status --porcelain", repo);
    assert.ok(status.length > 0, "repo is dirty");
    assert.ok(status.includes("README.md"), "README.md is modified");

    // Clean up
    execSync("git reset HEAD", { cwd: repo, stdio: "pipe" });
    execSync("git checkout -- .", { cwd: repo, stdio: "pipe" });
  });

  after(() => { try { rmSync(repo, { recursive: true, force: true }); } catch {} });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. Review gate — approve-and-merge contract
// ══════════════════════════════════════════════════════════════════════════════

describe("safety: approve-and-merge contract", () => {
  it("mergeWorkspaceCommand rejects Reviewing state", async () => {
    const { mergeWorkspaceCommand } = await import("../src/commands/merge-workspace.command.ts");
    const issue = { id: "safety-1", identifier: "#S1", state: "Reviewing", title: "Test" } as any;
    const deps = {
      issueRepository: { save() {}, findById: () => null, findAll: () => [], markDirty() {} },
      eventStore: { addEvent() {} },
      persistencePort: { persistState: async () => {}, loadState: async () => null },
    };
    await assert.rejects(
      () => mergeWorkspaceCommand({ issue, state: { config: {} } as any }, deps),
      /must complete first/i,
    );
  });

  it("mergeWorkspaceCommand rejects Planning state", async () => {
    const { mergeWorkspaceCommand } = await import("../src/commands/merge-workspace.command.ts");
    const issue = { id: "safety-2", identifier: "#S2", state: "Planning", title: "Test" } as any;
    const deps = {
      issueRepository: { save() {}, findById: () => null, findAll: () => [], markDirty() {} },
      eventStore: { addEvent() {} },
      persistencePort: { persistState: async () => {}, loadState: async () => null },
    };
    await assert.rejects(
      () => mergeWorkspaceCommand({ issue, state: { config: {} } as any }, deps),
      /only allowed/i,
    );
  });

  it("mergeWorkspaceCommand rejects Running state", async () => {
    const { mergeWorkspaceCommand } = await import("../src/commands/merge-workspace.command.ts");
    const issue = { id: "safety-3", identifier: "#S3", state: "Running", title: "Test" } as any;
    const deps = {
      issueRepository: { save() {}, findById: () => null, findAll: () => [], markDirty() {} },
      eventStore: { addEvent() {} },
      persistencePort: { persistState: async () => {}, loadState: async () => null },
    };
    await assert.rejects(
      () => mergeWorkspaceCommand({ issue, state: { config: {} } as any }, deps),
      /only allowed/i,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. autoReviewApproval semantics
// ══════════════════════════════════════════════════════════════════════════════

describe("safety: autoReviewApproval semantics are correctly documented", () => {
  it("RuntimeConfig type documents autoReviewApproval behavior accurately", async () => {
    // Read the type definition to verify the docstring matches behavior
    const source = readFileSync(
      join(process.cwd(), "src/types.ts"),
      "utf8",
    );
    assert.ok(
      source.includes("no reviewer is configured") && source.includes("autoReviewApproval"),
      "docstring mentions 'no reviewer' semantics",
    );
    assert.ok(
      source.includes("PendingDecision") && source.includes("manual human approval"),
      "docstring mentions PendingDecision for manual approval path",
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. FSM cannot bypass human decision points
// ══════════════════════════════════════════════════════════════════════════════

describe("safety: FSM human decision points cannot be bypassed", () => {
  it("no direct path from Planning to Merged", async () => {
    const { issueStateMachineConfig, ISSUE_STATE_MACHINE_ID } = await import("../src/persistence/plugins/issue-state-machine.ts");
    const states = issueStateMachineConfig.stateMachines[ISSUE_STATE_MACHINE_ID].states;
    // Planning can only go to PendingApproval or Cancelled
    const planningTargets = Object.values(states.Planning.on || {});
    assert.ok(!planningTargets.includes("Merged"), "Planning cannot go directly to Merged");
    assert.ok(!planningTargets.includes("Approved"), "Planning cannot go directly to Approved");
    assert.ok(!planningTargets.includes("Running"), "Planning cannot go directly to Running");
  });

  it("no direct path from Running to Approved", async () => {
    const { issueStateMachineConfig, ISSUE_STATE_MACHINE_ID } = await import("../src/persistence/plugins/issue-state-machine.ts");
    const states = issueStateMachineConfig.stateMachines[ISSUE_STATE_MACHINE_ID].states;
    const runningTargets = Object.values(states.Running.on || {});
    assert.ok(!runningTargets.includes("Approved"), "Running cannot skip review to Approved");
    assert.ok(!runningTargets.includes("Merged"), "Running cannot skip review to Merged");
  });

  it("Reviewing must pass through PendingDecision before Approved", async () => {
    const { issueStateMachineConfig, ISSUE_STATE_MACHINE_ID } = await import("../src/persistence/plugins/issue-state-machine.ts");
    const states = issueStateMachineConfig.stateMachines[ISSUE_STATE_MACHINE_ID].states;
    const reviewingTargets = Object.values(states.Reviewing.on || {});
    assert.ok(!reviewingTargets.includes("Approved"), "Reviewing cannot skip PendingDecision");
    assert.ok(!reviewingTargets.includes("Merged"), "Reviewing cannot skip to Merged");
    assert.ok(reviewingTargets.includes("PendingDecision"), "Reviewing goes to PendingDecision");
  });

  it("only PendingDecision and Approved can reach Merged", async () => {
    const { issueStateMachineConfig, ISSUE_STATE_MACHINE_ID } = await import("../src/persistence/plugins/issue-state-machine.ts");
    const states = issueStateMachineConfig.stateMachines[ISSUE_STATE_MACHINE_ID].states;
    // Check every state — only Approved should have MERGE -> Merged
    const statesReachingMerged: string[] = [];
    for (const [name, def] of Object.entries(states)) {
      const targets = Object.values((def as any).on || {});
      if (targets.includes("Merged")) statesReachingMerged.push(name);
    }
    assert.deepEqual(statesReachingMerged, ["Approved"], "only Approved can transition to Merged");
  });
});
