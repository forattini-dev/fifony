import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import type { IssueEntry, WorkflowDefinition } from "./types.ts";
import { SOURCE_ROOT, TARGET_ROOT, WORKSPACE_ROOT } from "./constants.ts";
import { now, idToSafePath } from "./helpers.ts";
import { logger } from "./logger.ts";
import { runHook } from "./command-executor.ts";
import { buildPrompt } from "./prompt-builder.ts";
import { ensureSourceReady } from "./workflow.ts";

/** Check if a directory is inside a git repository. */
function isGitRepo(dir: string): boolean {
  try {
    execSync("git rev-parse --git-dir", { cwd: dir, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** Create a git worktree for the issue at the given path. */
export async function createGitWorktree(issue: IssueEntry, worktreePath: string): Promise<void> {
  let baseBranch = "main";
  let headCommitAtStart = "";
  try {
    baseBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: TARGET_ROOT, encoding: "utf8" }).trim();
    headCommitAtStart = execSync("git rev-parse HEAD", { cwd: TARGET_ROOT, encoding: "utf8" }).trim();
  } catch {}

  const branchName = `fifony/${issue.id}`;

  // -B creates or resets the branch (handles retry scenarios)
  execSync(`git worktree add "${worktreePath}" -B "${branchName}"`, {
    cwd: TARGET_ROOT,
    stdio: "pipe",
  });

  // Register fifony runtime files as ignored in the worktree's local excludes
  try {
    const gitFileContent = readFileSync(join(worktreePath, ".git"), "utf8").trim();
    const gitDirRel = gitFileContent.replace("gitdir: ", "").trim();
    const gitDirPath = resolve(worktreePath, gitDirRel);
    mkdirSync(join(gitDirPath, "info"), { recursive: true });
    writeFileSync(join(gitDirPath, "info", "exclude"), "fifony-*\n.fifony-*\nfifony_*\n", "utf8");
  } catch (err) {
    logger.warn({ err: String(err) }, "[Agent] Failed to write worktree excludes");
  }

  issue.branchName = branchName;
  issue.baseBranch = baseBranch;
  issue.headCommitAtStart = headCommitAtStart;
  issue.worktreePath = worktreePath;

  logger.debug({ issueId: issue.id, branchName, baseBranch, worktreePath }, "[Agent] Git worktree created");
}

export async function prepareWorkspace(
  issue: IssueEntry,
  workflowDefinition: WorkflowDefinition | null,
): Promise<{ workspacePath: string; promptText: string; promptFile: string }> {
  const safeId = idToSafePath(issue.id);
  const workspaceRoot = join(WORKSPACE_ROOT, safeId);    // management dir
  const worktreePath = join(workspaceRoot, "worktree");   // code dir (git worktree)
  const createdNow = !existsSync(worktreePath);

  if (createdNow) {
    mkdirSync(workspaceRoot, { recursive: true });
    logger.debug({ issueId: issue.id, identifier: issue.identifier, workspacePath: workspaceRoot }, "[Agent] Creating workspace");

    if (workflowDefinition?.afterCreateHook) {
      mkdirSync(worktreePath, { recursive: true });
      await runHook(workflowDefinition.afterCreateHook, worktreePath, issue, "after_create");
    } else if (isGitRepo(TARGET_ROOT)) {
      await createGitWorktree(issue, worktreePath);
    } else {
      // Fallback: copy SOURCE_ROOT snapshot
      await ensureSourceReady();
      mkdirSync(worktreePath, { recursive: true });
      cpSync(SOURCE_ROOT, worktreePath, {
        recursive: true,
        force: true,
        filter: (sourcePath) => !sourcePath.startsWith(WORKSPACE_ROOT),
      });
    }

    logger.debug({ issueId: issue.id, workspacePath: workspaceRoot, worktreePath }, "[Agent] Workspace created");
  } else {
    logger.debug({ issueId: issue.id, workspacePath: workspaceRoot }, "[Agent] Reusing existing workspace");
  }

  const metaPath = join(workspaceRoot, "issue.json");
  const promptText = await buildPrompt(issue, workflowDefinition);
  const promptFile = join(workspaceRoot, "prompt.md");
  writeFileSync(metaPath, JSON.stringify({ ...issue, runtimeSource: SOURCE_ROOT, bootstrapAt: now() }, null, 2), "utf8");
  writeFileSync(promptFile, `${promptText}\n`, "utf8");

  issue.workspacePath = workspaceRoot;
  issue.worktreePath = worktreePath;
  issue.workspacePreparedAt = now();

  return { workspacePath: workspaceRoot, promptText, promptFile };
}

export async function cleanWorkspace(
  issueId: string,
  issue: IssueEntry | null,
  workflowDefinition: WorkflowDefinition | null,
): Promise<void> {
  const safeId = idToSafePath(issueId);
  const workspacePath = issue?.workspacePath ?? join(WORKSPACE_ROOT, safeId);
  if (!existsSync(workspacePath)) return;

  // Run before_remove hook (failure is logged but ignored)
  if (workflowDefinition?.beforeRemoveHook) {
    try {
      const dummyIssue = issue ?? { id: issueId, identifier: issueId } as IssueEntry;
      await runHook(workflowDefinition.beforeRemoveHook, workspacePath, dummyIssue, "before_remove");
    } catch (error) {
      logger.warn(`before_remove hook failed for ${issueId}: ${String(error)}`);
    }
  }

  // Git worktree cleanup
  if (issue?.branchName && issue.worktreePath) {
    try {
      execSync(`git worktree remove --force "${issue.worktreePath}"`, { cwd: TARGET_ROOT, stdio: "pipe" });
      logger.info(`Removed worktree for ${issueId}: ${issue.worktreePath}`);
    } catch (error) {
      logger.warn(`Failed to remove worktree for ${issueId}: ${String(error)}`);
      try { rmSync(issue.worktreePath, { recursive: true, force: true }); } catch {}
    }
    try {
      execSync(`git branch -D "${issue.branchName}"`, { cwd: TARGET_ROOT, stdio: "pipe" });
    } catch { /* branch may already be gone */ }
    // Also remove the management dir
    try { rmSync(workspacePath, { recursive: true, force: true }); } catch {}
    return;
  }

  // Legacy: remove the whole workspace dir
  try {
    rmSync(workspacePath, { recursive: true, force: true });
    logger.info(`Cleaned workspace for ${issueId}: ${workspacePath}`);
  } catch (error) {
    logger.warn(`Failed to clean workspace for ${issueId}: ${String(error)}`);
  }
}
