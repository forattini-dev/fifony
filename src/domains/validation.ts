import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { IssueEntry, RuntimeConfig, ValidationResult } from "../types.ts";
import { logger } from "../concerns/logger.ts";
import { TARGET_ROOT } from "../concerns/constants.ts";

// ── Monorepo detection ────────────────────────────────────────────────────────

type MonorepoInfo = {
  isMonorepo: boolean;
  /** Package manager command (pnpm/npm/yarn) */
  pm: string;
  /** Map of package directory (relative to root) → package name */
  packages: Map<string, string>;
};

let cachedMonorepoInfo: MonorepoInfo | null = null;

function detectMonorepo(root: string): MonorepoInfo {
  if (cachedMonorepoInfo) return cachedMonorepoInfo;

  const pm = existsSync(join(root, "pnpm-lock.yaml")) ? "pnpm"
    : existsSync(join(root, "yarn.lock")) ? "yarn"
    : "npm";

  const packages = new Map<string, string>();

  // Detect workspace packages via pnpm-workspace.yaml or package.json#workspaces
  const parentDirs: string[] = [];

  const pnpmWs = join(root, "pnpm-workspace.yaml");
  if (existsSync(pnpmWs)) {
    try {
      const content = readFileSync(pnpmWs, "utf8");
      for (const match of content.matchAll(/^\s+-\s+["']?([^"'\n]+)["']?/gm)) {
        const glob = match[1].trim().replace(/\/\*.*$/, "");
        if (glob) parentDirs.push(glob);
      }
    } catch {}
  }

  if (parentDirs.length === 0) {
    try {
      const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      if (Array.isArray(rootPkg.workspaces)) {
        for (const glob of rootPkg.workspaces as string[]) {
          const parent = String(glob).replace(/\/\*.*$/, "");
          if (parent) parentDirs.push(parent);
        }
      }
    } catch {}
  }

  if (parentDirs.length === 0) {
    cachedMonorepoInfo = { isMonorepo: false, pm, packages };
    return cachedMonorepoInfo;
  }

  // Scan each workspace parent for packages
  for (const parent of parentDirs) {
    const absParent = join(root, parent);
    if (!existsSync(absParent)) continue;
    try {
      for (const child of readdirSync(absParent, { withFileTypes: true })) {
        if (!child.isDirectory()) continue;
        const pkgJsonPath = join(absParent, child.name, "package.json");
        if (!existsSync(pkgJsonPath)) continue;
        try {
          const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
          const name = typeof pkg.name === "string" ? pkg.name : child.name;
          packages.set(`${parent}/${child.name}`, name);
        } catch {}
      }
    } catch {}
  }

  cachedMonorepoInfo = { isMonorepo: true, pm, packages };
  return cachedMonorepoInfo;
}

/** Invalidate cached monorepo detection (for tests). */
export function invalidateMonorepoCache(): void {
  cachedMonorepoInfo = null;
}

// ── Scoped test command resolution ────────────────────────────────────────────

function getChangedFiles(issue: IssueEntry): string[] {
  const cwd = issue.worktreePath;
  if (!cwd || !issue.baseBranch) return [];
  try {
    const out = execFileSync("git", ["diff", "--name-only", `${issue.baseBranch}...HEAD`], {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
    });
    return out.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function affectedPackages(changedFiles: string[], packages: Map<string, string>): string[] {
  const affected = new Set<string>();
  for (const file of changedFiles) {
    for (const [dir, name] of packages) {
      if (file.startsWith(dir + "/")) {
        affected.add(name);
        break;
      }
    }
  }
  return [...affected];
}

/**
 * Build a scoped test command for monorepos.
 * Returns null if no scoping is possible (not a monorepo, no changed files, etc.)
 */
function buildScopedTestCommand(issue: IssueEntry, baseCommand: string): string | null {
  const root = TARGET_ROOT;
  const mono = detectMonorepo(root);
  if (!mono.isMonorepo || mono.packages.size === 0) return null;

  const changedFiles = getChangedFiles(issue);
  if (changedFiles.length === 0) return null;

  const affected = affectedPackages(changedFiles, mono.packages);
  if (affected.length === 0) {
    // Changed files are all in root (config, README, etc.) — skip tests
    logger.info({ issueId: issue.id, changedFiles: changedFiles.length }, "[Validation] Changed files don't belong to any workspace package — skipping gate");
    return "true"; // no-op command that always passes
  }

  // Build scoped command: pnpm --filter <pkg1> --filter <pkg2> test
  if (mono.pm === "pnpm") {
    const filters = affected.map((pkg) => `--filter "${pkg}"`).join(" ");
    return `pnpm ${filters} test`;
  }

  if (mono.pm === "yarn") {
    // yarn workspaces foreach --include <pkg> run test
    const includes = affected.map((pkg) => `--include "${pkg}"`).join(" ");
    return `yarn workspaces foreach ${includes} run test`;
  }

  // npm: run each separately
  return affected.map((pkg) => `npm -w "${pkg}" test`).join(" && ");
}

// ── Main gate ─────────────────────────────────────────────────────────────────

/**
 * Run the configured test command as a validation gate (async — does not block event loop).
 * Returns null if no testCommand is configured (no-op).
 *
 * For monorepos: automatically scopes the test command to affected packages
 * based on git diff, bypassing turbo/full-suite issues in worktrees.
 */
export async function runValidationGate(issue: IssueEntry, config: RuntimeConfig): Promise<ValidationResult | null> {
  if (!config.testCommand) return null;

  const cwd = issue.worktreePath ?? issue.workspacePath;
  if (!cwd) {
    logger.warn({ issueId: issue.id }, "[Validation] No workspace path — skipping gate");
    return null;
  }

  // Try to scope the test command for monorepos
  const scopedCommand = buildScopedTestCommand(issue, config.testCommand);
  const command = scopedCommand ?? config.testCommand;

  logger.info({ issueId: issue.id, command, scoped: !!scopedCommand, cwd }, "[Validation] Running validation gate");

  return new Promise((resolve) => {
    execFile("sh", ["-c", command], {
      cwd,
      encoding: "utf8",
      timeout: 1_800_000,
      maxBuffer: 2 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      const combined = (stdout || "") + (stderr || "");

      if (!err) {
        logger.info({ issueId: issue.id, command }, "[Validation] Gate passed");
        resolve({
          passed: true,
          output: combined.slice(-2048),
          command,
          ranAt: new Date().toISOString(),
        });
        return;
      }

      logger.warn({ issueId: issue.id, exitCode: (err as any).code, command }, "[Validation] Gate failed");
      resolve({
        passed: false,
        output: combined.slice(-2048) || String(err).slice(0, 2048),
        command,
        ranAt: new Date().toISOString(),
      });
    });
  });
}
