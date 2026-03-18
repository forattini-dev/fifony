import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { IssueEntry } from "./types.ts";
import { SOURCE_ROOT, TARGET_ROOT } from "./constants.ts";

function shouldSkipRoutingPath(relativePath: string): boolean {
  const parts = relativePath.split("/");
  if (parts.some((segment) => segment === ".git" || segment === "node_modules" || segment === ".fifony")) {
    return true;
  }
  const base = parts.at(-1) ?? "";
  return base === "WORKFLOW.local.md"
    || base === ".fifony-env.sh"
    || base.startsWith("fifony-")
    || base.startsWith("fifony_");
}

export function inferChangedWorkspacePaths(workspacePath: string, limit = 32, issue?: IssueEntry): string[] {
  // Git worktree: use git diff --name-only for accuracy
  if (issue?.baseBranch && issue.branchName) {
    try {
      const output = execSync(
        `git diff --name-only "${issue.baseBranch}"..."${issue.branchName}"`,
        { cwd: TARGET_ROOT, encoding: "utf8", timeout: 10_000 },
      );
      return output.trim().split("\n").filter(Boolean).slice(0, limit);
    } catch {}
  }

  // Fallback: filesystem walk comparing workspace vs SOURCE_ROOT
  const codePath = issue?.worktreePath ?? workspacePath;
  if (!codePath || !existsSync(codePath) || !existsSync(SOURCE_ROOT)) return [];

  const changed = new Set<string>();

  const walk = (currentRoot: string, relativeRoot = ""): void => {
    if (changed.size >= limit) return;
    for (const item of readdirSync(currentRoot, { withFileTypes: true })) {
      if (changed.size >= limit) return;
      const nextRelative = relativeRoot ? `${relativeRoot}/${item.name}` : item.name;
      if (shouldSkipRoutingPath(nextRelative)) continue;
      const currentPath = join(currentRoot, item.name);
      if (item.isDirectory()) { walk(currentPath, nextRelative); continue; }
      if (!item.isFile()) continue;
      const sourcePath = join(SOURCE_ROOT, nextRelative);
      if (!existsSync(sourcePath)) { changed.add(nextRelative); continue; }
      const currentStat = statSync(currentPath);
      const sourceStat = statSync(sourcePath);
      if (currentStat.size !== sourceStat.size) { changed.add(nextRelative); continue; }
      const currentFile = readFileSync(currentPath);
      const sourceFile = readFileSync(sourcePath);
      if (!currentFile.equals(sourceFile)) changed.add(nextRelative);
    }
  };

  walk(codePath);
  return [...changed];
}

/** Compute lines added/removed/files changed from workspace diff. */
export function computeDiffStats(issue: IssueEntry): void {
  // Git worktree: diff the branch vs its base
  if (issue.baseBranch && issue.branchName) {
    try {
      let raw = "";
      try {
        raw = execSync(
          `git diff --stat "${issue.baseBranch}"..."${issue.branchName}"`,
          { cwd: TARGET_ROOT, encoding: "utf8", maxBuffer: 512_000, timeout: 10_000 },
        );
      } catch (err: any) {
        raw = err.stdout || "";
      }
      if (raw) parseDiffStats(issue, raw);
    } catch {}
    return;
  }

  // Legacy: git diff --no-index
  const wp = issue.worktreePath ?? issue.workspacePath;
  if (!wp || !existsSync(wp) || !existsSync(SOURCE_ROOT)) return;
  try {
    let raw = "";
    try {
      raw = execSync(
        `git diff --no-index --stat -- "${SOURCE_ROOT}" "${wp}" 2>/dev/null`,
        { encoding: "utf8", maxBuffer: 512_000, timeout: 10_000 },
      );
    } catch (err: any) {
      raw = err.stdout || "";
    }
    if (raw) parseDiffStats(issue, raw);
  } catch {}
}

export function parseDiffStats(issue: IssueEntry, raw: string): void {
  const lines = raw.trim().split("\n");
  const summary = lines[lines.length - 1] || "";
  const filesMatch = summary.match(/(\d+)\s+files?\s+changed/);
  const addMatch = summary.match(/(\d+)\s+insertions?\(\+\)/);
  const delMatch = summary.match(/(\d+)\s+deletions?\(-\)/);

  const internalRe = /fifony[-_]|\.fifony-|WORKFLOW\.local/;
  const fileLines = lines.slice(0, -1).filter((l) => {
    const name = l.trim().split("|")[0]?.trim().split("/").pop() || "";
    return !internalRe.test(name);
  });

  issue.filesChanged = fileLines.length || (filesMatch ? parseInt(filesMatch[1], 10) : 0);
  issue.linesAdded = addMatch ? parseInt(addMatch[1], 10) : 0;
  issue.linesRemoved = delMatch ? parseInt(delMatch[1], 10) : 0;
}
