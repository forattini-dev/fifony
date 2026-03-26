import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { now } from "../concerns/helpers.ts";
import { logger } from "../concerns/logger.ts";
import { detectDefaultBranch, ensureGitRepoReadyForWorktrees } from "./workspace.ts";

export type DevProfilePaths = {
  profileName: string;
  profileRoot: string;
  workspaceRoot: string;
  persistenceRoot: string;
  trashRoot: string;
  runbooksRoot: string;
  bootstrapRoot: string;
  metadataFile: string;
};

export type DevProfileStatus = {
  profileName: string;
  profileRoot: string;
  workspaceRoot: string;
  persistenceRoot: string;
  trashRoot: string;
  branchName: string;
  dashboardPort: number;
  workspaceExists: boolean;
  persistenceExists: boolean;
  bootstrapped: boolean;
  worktreeAttached: boolean;
  bootstrapFiles: {
    workflowLocal: boolean;
    fifony: boolean;
    runbooks: string[];
  };
  trashEntries: string[];
  launchCommand: string;
  lastBootstrappedAt?: string;
  lastResetAt?: string;
};

export type DevProfileResetResult = {
  ok: boolean;
  removedWorktree: boolean;
  trashedProfile: boolean;
  trashPath?: string;
  branchName: string;
};

const DEV_PROFILE_DEFAULT_PORT = 4100;
const CLI_CONFIG_DIRS = [".claude", ".codex", ".gemini"];
const CLI_CONFIG_FILES = ["CLAUDE.md"];

function resolvePaths(stateRoot: string, profileName = "dev"): DevProfilePaths {
  const profileRoot = join(stateRoot, "profiles", profileName);
  return {
    profileName,
    profileRoot,
    workspaceRoot: join(profileRoot, "workspace"),
    persistenceRoot: join(profileRoot, ".fifony"),
    trashRoot: join(stateRoot, "trash", "dev-profiles"),
    runbooksRoot: join(profileRoot, "runbooks"),
    bootstrapRoot: join(profileRoot, "bootstrap"),
    metadataFile: join(profileRoot, "profile.json"),
  };
}

function branchNameFor(profileName: string): string {
  return `fifony/${profileName}-profile`;
}

function readProfileMetadata(paths: DevProfilePaths): Record<string, unknown> {
  try {
    return existsSync(paths.metadataFile)
      ? JSON.parse(readFileSync(paths.metadataFile, "utf8")) as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function copyCliConfigArtifacts(sourceRoot: string, workspaceRoot: string): void {
  for (const dir of CLI_CONFIG_DIRS) {
    const source = join(sourceRoot, dir);
    const target = join(workspaceRoot, dir);
    if (!existsSync(source) || existsSync(target) || !statSync(source).isDirectory()) continue;
    cpSync(source, target, { recursive: true });
  }

  for (const file of CLI_CONFIG_FILES) {
    const source = join(sourceRoot, file);
    const target = join(workspaceRoot, file);
    if (!existsSync(source) || existsSync(target)) continue;
    writeFileSync(target, readFileSync(source));
  }
}

function ensureWorktreeLocalExcludes(workspaceRoot: string): void {
  try {
    const gitFile = readFileSync(join(workspaceRoot, ".git"), "utf8").trim();
    const gitDirPath = gitFile.replace(/^gitdir:\s*/, "").trim();
    const resolvedGitDir = resolve(workspaceRoot, gitDirPath);
    const excludePath = join(resolvedGitDir, "info", "exclude");
    ensureDir(join(resolvedGitDir, "info"));
    const current = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
    const entries = [
      "WORKFLOW.local.md",
      "FIFONY.md",
      ".fifony-dev/",
      "runbooks/",
      "fifony-*",
      ".fifony-*",
      "fifony_*",
    ];
    const next = `${current}${current.endsWith("\n") || current.length === 0 ? "" : "\n"}${entries.filter((entry) => !current.includes(entry)).join("\n")}\n`;
    writeFileSync(excludePath, next, "utf8");
  } catch (error) {
    logger.warn({ err: String(error), workspaceRoot }, "[DevProfile] Failed to update worktree excludes");
  }
}

function seedProfileFiles(targetRoot: string, paths: DevProfilePaths, branchName: string): void {
  ensureDir(paths.profileRoot);
  ensureDir(paths.runbooksRoot);
  ensureDir(paths.bootstrapRoot);
  ensureDir(join(paths.workspaceRoot, ".fifony-dev"));

  const workflowLocal = [
    "# Dev Workflow",
    "",
    "This sandbox is a dedicated Fifony development profile.",
    "",
    `- Source workspace: ${targetRoot}`,
    `- Dev branch: ${branchName}`,
    `- Persistence root: ${paths.persistenceRoot}`,
    `- Created: ${now()}`,
    "",
    "## Rules",
    "",
    "- Use this worktree for harness experiments and UI/runtime validation.",
    "- Keep the main repository clean; this sandbox can be reset independently.",
    "- Services and state for this profile should live under the profile root, not the main workspace state.",
    "",
  ].join("\n");

  const fifonyMd = [
    "# Fifony Dev Profile",
    "",
    "This profile exists to make local harness iteration safe and repeatable.",
    "",
    "## Quick Start",
    "",
    "- `fifony dev run` launches the runtime against this sandbox worktree.",
    "- `fifony dev reset` safely moves the profile to trash and recreates it on the next bootstrap.",
    "- Use the Workspace page to inspect doctor, services, and runtime health before running issues.",
    "",
  ].join("\n");

  const doctorRunbook = [
    "# Doctor Runbook",
    "",
    "Use `fifony doctor` or `/api/runtime/doctor` first.",
    "",
    "## When checks fail",
    "",
    "- `workspace-git`: bootstrap or reset the dev profile so the worktree is recreated from a committed base.",
    "- `provider-runtime`: install or switch the configured provider CLI.",
    "- `services-health`: inspect the Workspace page and restart the failing service.",
    "- `agent-health`: inspect issue live logs, then retry or replan the affected issue.",
    "- `memory-pipeline`: run at least one issue through planning or execution to seed workspace memory.",
    "",
  ].join("\n");

  const servicesRunbook = [
    "# Services Runbook",
    "",
    "- Global service env lives in runtime settings and applies to every managed service.",
    "- Per-service env overrides global keys on launch.",
    "- The dev profile keeps service state isolated from the main runtime.",
    "",
  ].join("\n");

  const contextRunbook = [
    "# Context Runbook",
    "",
    "- Workspace memory flushes happen before context assembly.",
    "- `WORKFLOW.md`, `MEMORY.md`, and `HEARTBEAT.md` inside issue workspaces are canonical memory artifacts.",
    "- Use analytics to inspect memory/context coverage and layer hit mix.",
    "",
  ].join("\n");

  writeFileSync(join(paths.workspaceRoot, "WORKFLOW.local.md"), `${workflowLocal}\n`, "utf8");
  writeFileSync(join(paths.workspaceRoot, "FIFONY.md"), `${fifonyMd}\n`, "utf8");
  writeFileSync(join(paths.runbooksRoot, "doctor.md"), `${doctorRunbook}\n`, "utf8");
  writeFileSync(join(paths.runbooksRoot, "services.md"), `${servicesRunbook}\n`, "utf8");
  writeFileSync(join(paths.runbooksRoot, "context.md"), `${contextRunbook}\n`, "utf8");

  writeFileSync(paths.metadataFile, JSON.stringify({
    profileName: paths.profileName,
    branchName,
    workspaceRoot: paths.workspaceRoot,
    persistenceRoot: paths.persistenceRoot,
    bootstrappedAt: now(),
  }, null, 2), "utf8");

  ensureWorktreeLocalExcludes(paths.workspaceRoot);
}

function isWorktreeAttached(targetRoot: string, workspaceRoot: string): boolean {
  if (!existsSync(workspaceRoot)) return false;
  try {
    const output = execSync("git worktree list --porcelain", { cwd: targetRoot, encoding: "utf8", stdio: "pipe" });
    return output.includes(`${workspaceRoot}\n`) || output.includes(`${workspaceRoot}\r\n`);
  } catch {
    return false;
  }
}

export function getDevProfileStatus(
  targetRoot: string,
  stateRoot: string,
  profileName = "dev",
): DevProfileStatus {
  const paths = resolvePaths(stateRoot, profileName);
  const metadata = readProfileMetadata(paths);
  const branchName = branchNameFor(profileName);
  const trashEntries = existsSync(paths.trashRoot)
    ? readdirSync(paths.trashRoot).filter((entry) => entry.startsWith(`${profileName}-`)).sort().reverse()
    : [];

  return {
    profileName,
    profileRoot: paths.profileRoot,
    workspaceRoot: paths.workspaceRoot,
    persistenceRoot: paths.persistenceRoot,
    trashRoot: paths.trashRoot,
    branchName,
    dashboardPort: DEV_PROFILE_DEFAULT_PORT,
    workspaceExists: existsSync(paths.workspaceRoot),
    persistenceExists: existsSync(paths.persistenceRoot),
    bootstrapped: existsSync(join(paths.workspaceRoot, "WORKFLOW.local.md")) && existsSync(join(paths.workspaceRoot, "FIFONY.md")),
    worktreeAttached: isWorktreeAttached(targetRoot, paths.workspaceRoot),
    bootstrapFiles: {
      workflowLocal: existsSync(join(paths.workspaceRoot, "WORKFLOW.local.md")),
      fifony: existsSync(join(paths.workspaceRoot, "FIFONY.md")),
      runbooks: existsSync(paths.runbooksRoot) ? readdirSync(paths.runbooksRoot).sort() : [],
    },
    trashEntries,
    launchCommand: `fifony dev run --workspace "${targetRoot}" --port ${DEV_PROFILE_DEFAULT_PORT}`,
    lastBootstrappedAt: typeof metadata.bootstrappedAt === "string" ? metadata.bootstrappedAt : undefined,
    lastResetAt: typeof metadata.lastResetAt === "string" ? metadata.lastResetAt : undefined,
  };
}

export function bootstrapDevProfile(
  targetRoot: string,
  stateRoot: string,
  profileName = "dev",
): DevProfileStatus {
  const paths = resolvePaths(stateRoot, profileName);
  ensureDir(paths.profileRoot);
  ensureGitRepoReadyForWorktrees(targetRoot, "bootstrap the dev profile");
  const branchName = branchNameFor(profileName);
  const baseBranch = detectDefaultBranch(targetRoot);

  if (!isWorktreeAttached(targetRoot, paths.workspaceRoot)) {
    if (existsSync(paths.workspaceRoot)) {
      rmSync(paths.workspaceRoot, { recursive: true, force: true });
    }
    execSync(`git worktree add "${paths.workspaceRoot}" -B "${branchName}" "${baseBranch}"`, {
      cwd: targetRoot,
      stdio: "pipe",
    });
  }

  copyCliConfigArtifacts(targetRoot, paths.workspaceRoot);
  ensureDir(paths.persistenceRoot);
  seedProfileFiles(targetRoot, paths, branchName);

  return getDevProfileStatus(targetRoot, stateRoot, profileName);
}

export function resetDevProfile(
  targetRoot: string,
  stateRoot: string,
  profileName = "dev",
): DevProfileResetResult {
  const paths = resolvePaths(stateRoot, profileName);
  const branchName = branchNameFor(profileName);
  let removedWorktree = false;

  if (isWorktreeAttached(targetRoot, paths.workspaceRoot)) {
    execSync(`git worktree remove --force "${paths.workspaceRoot}"`, {
      cwd: targetRoot,
      stdio: "pipe",
    });
    removedWorktree = true;
  } else if (existsSync(paths.workspaceRoot)) {
    rmSync(paths.workspaceRoot, { recursive: true, force: true });
  }

  try {
    execSync(`git branch -D "${branchName}"`, { cwd: targetRoot, stdio: "pipe" });
  } catch {
    // Branch may already be gone; ignore.
  }

  if (!existsSync(paths.profileRoot)) {
    return {
      ok: true,
      removedWorktree,
      trashedProfile: false,
      branchName,
    };
  }

  ensureDir(paths.trashRoot);
  const trashPath = join(paths.trashRoot, `${profileName}-${Date.now()}`);
  const metadata = readProfileMetadata(paths);
  writeFileSync(paths.metadataFile, JSON.stringify({
    ...metadata,
    lastResetAt: now(),
  }, null, 2), "utf8");
  renameSync(paths.profileRoot, trashPath);

  return {
    ok: true,
    removedWorktree,
    trashedProfile: true,
    trashPath,
    branchName,
  };
}
