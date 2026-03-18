import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { execSync } from "node:child_process";
import type { IssueEntry } from "./types.ts";
import { SOURCE_ROOT, TARGET_ROOT } from "./constants.ts";
import { logger } from "./logger.ts";
import { inferChangedWorkspacePaths } from "./workspace-diff.ts";
import { inferCapabilityPaths } from "../routing/capability-resolver.ts";

export interface MergeResult {
  copied: string[];
  deleted: string[];
  skipped: string[];
  conflicts: string[];
}

function ensureWorktreeCommitted(issue: IssueEntry): void {
  const worktreePath = issue.worktreePath;
  if (!worktreePath || !issue.branchName) return;

  execSync("git add -A", { cwd: worktreePath, stdio: "pipe" });
  const statusBeforeCommit = execSync("git status --porcelain", { cwd: worktreePath, encoding: "utf8" }).trim();
  if (!statusBeforeCommit) return;

  try {
    execSync(`git commit -m "fifony: agent changes for ${issue.identifier}"`, { cwd: worktreePath, stdio: "pipe" });
  } catch (error) {
    const remaining = execSync("git status --porcelain", { cwd: worktreePath, encoding: "utf8" }).trim();
    if (remaining) {
      throw new Error(`Failed to commit agent changes for ${issue.identifier}: ${String(error)}`);
    }
  }

  const statusAfterCommit = execSync("git status --porcelain", { cwd: worktreePath, encoding: "utf8" }).trim();
  if (statusAfterCommit) {
    throw new Error(`Worktree for ${issue.identifier} still has uncommitted changes after commit.`);
  }
}

export { ensureWorktreeCommitted };

/** Merge a worktree branch into TARGET_ROOT using git merge --no-ff. */
function mergeWorktree(issue: IssueEntry, worktreePath: string): MergeResult {
  const result: MergeResult = { copied: [], deleted: [], skipped: [], conflicts: [] };
  ensureWorktreeCommitted(issue);

  const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: TARGET_ROOT, encoding: "utf8" }).trim();
  if (currentBranch !== issue.baseBranch) {
    throw new Error(`Cannot merge ${issue.identifier}: current branch is ${currentBranch}, expected ${issue.baseBranch}.`);
  }

  const targetStatus = execSync("git status --porcelain", { cwd: TARGET_ROOT, encoding: "utf8" }).trim();
  if (targetStatus) {
    throw new Error(`Cannot merge ${issue.identifier}: target repository has uncommitted changes.`);
  }

  // Collect changed files before merging (for the result summary)
  try {
    const diffOut = execSync(
      `git diff --name-status "${issue.baseBranch}"..."${issue.branchName}"`,
      { cwd: TARGET_ROOT, encoding: "utf8" },
    );
    for (const line of diffOut.trim().split("\n").filter(Boolean)) {
      const [statusChar, ...parts] = line.split("\t");
      const filePath = parts.join("\t");
      if (statusChar === "D") result.deleted.push(filePath);
      else result.copied.push(filePath);
    }
  } catch { /* best-effort */ }

  try {
    execSync(
      `git merge --no-ff "${issue.branchName}" -m "fifony: merge ${issue.identifier}"`,
      { cwd: TARGET_ROOT, stdio: "pipe" },
    );
  } catch (err: any) {
    // Merge failed — collect conflict files and abort
    try {
      const conflictOut = execSync(
        "git diff --name-only --diff-filter=U",
        { cwd: TARGET_ROOT, encoding: "utf8" },
      );
      result.conflicts.push(...conflictOut.trim().split("\n").filter(Boolean));
    } catch {}
    try { execSync("git merge --abort", { cwd: TARGET_ROOT, stdio: "pipe" }); } catch {}
    logger.warn({ issueId: issue.id, err: String(err) }, "[Agent] Git merge failed, aborted");
  }

  return result;
}

/** Check if a file in TARGET_ROOT has been modified by another worker (differs from SOURCE_ROOT). */
function isConflict(relativePath: string): boolean {
  const targetPath = join(TARGET_ROOT, relativePath);
  const sourcePath = join(SOURCE_ROOT, relativePath);

  // File exists in target but not in source → another worker created it
  if (!existsSync(sourcePath)) return existsSync(targetPath);

  // File doesn't exist in target → someone deleted it, not a conflict for us
  if (!existsSync(targetPath)) return false;

  // Both exist → compare target vs source. If different, another worker already changed it.
  const targetStat = statSync(targetPath);
  const sourceStat = statSync(sourcePath);
  if (targetStat.size !== sourceStat.size) return true;
  return !readFileSync(targetPath).equals(readFileSync(sourcePath));
}

export function shouldSkipMergePath(relativePath: string): boolean {
  const parts = relativePath.split("/");
  if (parts.some((s) => s === ".git" || s === "node_modules" || s === ".fifony" || s === "dist" || s === ".tanstack")) {
    return true;
  }
  const base = parts.at(-1) ?? "";
  return base === "WORKFLOW.local.md"
    || base === ".fifony-env.sh"
    || base === ".fifony-compiled-env.sh"
    || base === ".fifony-local-source-ready"
    || base.startsWith("fifony-")
    || base.startsWith("fifony_");
}

/**
 * Merge workspace changes back into TARGET_ROOT.
 * If the issue has a git worktree branch, uses git merge --no-ff.
 * Otherwise falls back to the legacy file-copy approach.
 */
export function mergeWorkspace(issue: IssueEntry): MergeResult {
  const worktreePath = issue.worktreePath;
  const workspacePath = issue.workspacePath;
  const effectivePath = worktreePath ?? workspacePath;

  if (!effectivePath || !existsSync(effectivePath)) {
    throw new Error(`Workspace not found for ${issue.identifier}`);
  }

  // Git worktree path: use git merge
  if (issue.branchName && issue.baseBranch && worktreePath) {
    return mergeWorktree(issue, worktreePath);
  }

  // Legacy: manual file copy
  const result: MergeResult = { copied: [], deleted: [], skipped: [], conflicts: [] };
  const legacyPath = effectivePath;

  // 1. Walk workspace and copy new/modified files to TARGET_ROOT
  const walkWorkspace = (dir: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, item.name);
      const relativePath = relative(legacyPath, fullPath);

      if (shouldSkipMergePath(relativePath)) {
        result.skipped.push(relativePath);
        continue;
      }

      if (item.isDirectory()) {
        walkWorkspace(fullPath);
        continue;
      }

      if (!item.isFile()) continue;

      const sourcePath = join(SOURCE_ROOT, relativePath);

      const isNew = !existsSync(sourcePath);
      let isModified = false;
      if (!isNew) {
        const wsStat = statSync(fullPath);
        const srcStat = statSync(sourcePath);
        if (wsStat.size !== srcStat.size) {
          isModified = true;
        } else {
          const wsContent = readFileSync(fullPath);
          const srcContent = readFileSync(sourcePath);
          isModified = !wsContent.equals(srcContent);
        }
      }

      if (isNew || isModified) {
        if (isConflict(relativePath)) {
          result.conflicts.push(relativePath);
          continue;
        }

        const targetDir = join(TARGET_ROOT, relative(legacyPath, dir));
        const targetPath = join(TARGET_ROOT, relativePath);
        mkdirSync(targetDir, { recursive: true });
        cpSync(fullPath, targetPath, { force: true });
        result.copied.push(relativePath);
      }
    }
  };

  // 2. Walk SOURCE_ROOT to find files deleted in workspace
  const walkSource = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, item.name);
      const relativePath = relative(SOURCE_ROOT, fullPath);

      if (shouldSkipMergePath(relativePath)) continue;

      if (item.isDirectory()) {
        walkSource(fullPath);
        continue;
      }

      if (!item.isFile()) continue;

      const wsPath = join(legacyPath, relativePath);
      if (!existsSync(wsPath)) {
        const targetPath = join(TARGET_ROOT, relativePath);
        if (existsSync(targetPath)) {
          if (isConflict(relativePath)) {
            result.conflicts.push(relativePath);
          } else {
            rmSync(targetPath, { force: true });
            result.deleted.push(relativePath);
          }
        }
      }
    }
  };

  walkWorkspace(legacyPath);
  walkSource(SOURCE_ROOT);

  return result;
}

export function hydrateIssuePathsFromWorkspace(issue: IssueEntry): string[] {
  const inferredPaths = inferChangedWorkspacePaths(issue.workspacePath ?? "", 32, issue);
  if (inferredPaths.length === 0) return [];
  issue.paths = [...new Set([...(issue.paths ?? []), ...inferredPaths])];
  issue.inferredPaths = [...new Set([...(issue.inferredPaths ?? []), ...inferredPaths])];
  return inferredPaths;
}

export function describeRoutingSignals(issue: IssueEntry, workspaceDerivedPaths: string[]): string {
  const explicitPaths = issue.paths ?? [];
  const textDerivedPaths = inferCapabilityPaths({
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    labels: issue.labels,
  }).filter((path) => !explicitPaths.includes(path));

  const parts: string[] = [];
  if (explicitPaths.length > 0) parts.push(`payload paths=${explicitPaths.join(", ")}`);
  if (textDerivedPaths.length > 0) parts.push(`text hints=${textDerivedPaths.join(", ")}`);
  if (workspaceDerivedPaths.length > 0) parts.push(`workspace diff=${workspaceDerivedPaths.join(", ")}`);
  return parts.join(" | ");
}

/** Write versioned review artifacts to workspace (also used for execute artifacts). */
export function writeVersionedArtifacts(
  workspacePath: string,
  prefix: string,
  planVersion: number,
  attempt: number,
  sources: Array<{ srcFile: string; destSuffix: string }>,
): void {
  const { writeFileSync: _wfs, readFileSync: _rfs, existsSync: _es } = { writeFileSync, readFileSync, existsSync };
  for (const { srcFile, destSuffix } of sources) {
    const src = join(workspacePath, srcFile);
    if (_es(src)) {
      _wfs(join(workspacePath, `${prefix}.v${planVersion}a${attempt}.${destSuffix}`), _rfs(src, "utf8"), "utf8");
    }
  }
}
