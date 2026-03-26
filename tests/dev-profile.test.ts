import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import {
  bootstrapDevProfile,
  getDevProfileStatus,
  resetDevProfile,
} from "../src/domains/dev-profile.ts";

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createGitRepo(): { repoRoot: string; stateRoot: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "fifony-dev-profile-repo-"));
  const stateRoot = mkdtempSync(join(tmpdir(), "fifony-dev-profile-state-"));
  tempDirs.push(repoRoot, stateRoot);

  execSync("git init -b main", { cwd: repoRoot, stdio: "pipe" });
  execSync('git config user.email "fifony@test.invalid"', { cwd: repoRoot, stdio: "pipe" });
  execSync('git config user.name "Fifony Test"', { cwd: repoRoot, stdio: "pipe" });
  mkdirSync(join(repoRoot, "src"), { recursive: true });
  writeFileSync(join(repoRoot, "src", "index.ts"), "export const ready = true;\n", "utf8");
  writeFileSync(join(repoRoot, "README.md"), "# Test Repo\n", "utf8");
  execSync("git add .", { cwd: repoRoot, stdio: "pipe" });
  execSync('git commit -m "Initial commit"', { cwd: repoRoot, stdio: "pipe" });

  return { repoRoot, stateRoot };
}

describe("dev profile", () => {
  it("bootstraps an isolated dev worktree with bootstrap files", () => {
    const { repoRoot, stateRoot } = createGitRepo();

    const profile = bootstrapDevProfile(repoRoot, stateRoot);
    const status = getDevProfileStatus(repoRoot, stateRoot);

    assert.equal(profile.bootstrapped, true);
    assert.equal(profile.worktreeAttached, true);
    assert.equal(profile.dashboardPort, 4100);
    assert.equal(status.workspaceExists, true);
    assert.equal(existsSync(join(profile.workspaceRoot, "WORKFLOW.local.md")), true);
    assert.equal(existsSync(join(profile.workspaceRoot, "FIFONY.md")), true);
    assert.ok(profile.bootstrapFiles.runbooks.includes("doctor.md"));
    assert.match(profile.launchCommand, /fifony dev run/);

    const worktrees = execSync("git worktree list --porcelain", { cwd: repoRoot, encoding: "utf8", stdio: "pipe" });
    assert.match(worktrees, new RegExp(profile.workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("resets the dev profile by removing the worktree and moving the profile to trash", () => {
    const { repoRoot, stateRoot } = createGitRepo();
    const profile = bootstrapDevProfile(repoRoot, stateRoot);

    const reset = resetDevProfile(repoRoot, stateRoot);
    const status = getDevProfileStatus(repoRoot, stateRoot);

    assert.equal(reset.ok, true);
    assert.equal(reset.removedWorktree, true);
    assert.equal(reset.trashedProfile, true);
    assert.ok(reset.trashPath);
    assert.equal(existsSync(profile.profileRoot), false);
    assert.equal(existsSync(reset.trashPath ?? ""), true);
    assert.equal(status.workspaceExists, false);
    assert.equal(status.worktreeAttached, false);

    const branches = execSync('git branch --list "fifony/dev-profile"', { cwd: repoRoot, encoding: "utf8", stdio: "pipe" }).trim();
    assert.equal(branches, "");
  });
});
