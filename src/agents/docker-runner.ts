import { existsSync } from "node:fs";
import { homedir, userInfo } from "node:os";

export const CONTAINER_WORKSPACE = "/workspace";
export const CONTAINER_PLANNING = "/planning";

/** Replace all occurrences of workspacePath with /workspace in a string. */
export function translatePaths(value: string, workspacePath: string): string {
  return value.replaceAll(workspacePath, CONTAINER_WORKSPACE);
}

function authMounts(home: string): string[] {
  const mounts: string[] = [];
  for (const dir of [".claude", ".codex", ".gemini"]) {
    const p = `${home}/${dir}`;
    if (existsSync(p)) mounts.push(`-v "${p}:${home}/${dir}:ro,z"`);
  }
  const gitconfig = `${home}/.gitconfig`;
  if (existsSync(gitconfig)) mounts.push(`-v "${gitconfig}:${home}/.gitconfig:ro"`);
  const sshDir = `${home}/.ssh`;
  if (existsSync(sshDir)) mounts.push(`-v "${sshDir}:${home}/.ssh:ro"`);
  return mounts;
}

/**
 * Wrap an agent command in `docker run` for execution/review phases.
 *
 * Assumptions:
 * - `.env.sh` inside workspacePath already has container-translated paths.
 * - `{targetRoot}/.git` is mounted at the same absolute path so git worktree refs resolve.
 * - worktreePath is always `{workspacePath}/worktree`, so it's covered by the workspace mount.
 */
export function buildDockerRunCommand(
  innerCommand: string,
  workspacePath: string,
  worktreePath: string | undefined,
  targetRoot: string,
  image: string,
): string {
  const home = homedir();
  const ui = userInfo();
  const cwd = worktreePath ? `${CONTAINER_WORKSPACE}/worktree` : CONTAINER_WORKSPACE;

  const mounts = [
    `-v "${workspacePath}:${CONTAINER_WORKSPACE}:z"`,
    `-v "${targetRoot}/.git:${targetRoot}/.git:z"`,
    ...authMounts(home),
  ];

  const escapedInner = innerCommand.replace(/'/g, "'\\''");

  return [
    "docker run --rm --init",
    `--user ${ui.uid}:${ui.gid}`,
    "--network host",
    "--cap-drop ALL",
    "--security-opt no-new-privileges",
    ...mounts,
    `-w "${cwd}"`,
    image,
    "sh", "-c",
    `'. ${CONTAINER_WORKSPACE}/.env.sh && ${escapedInner}'`,
  ].join(" ");
}

/**
 * Wrap a planning command in `docker run`.
 *
 * Planning has no worktree and no git writes, so it only needs the tempDir mounted
 * plus auth dirs. `.env.sh` will be written to tempDir by the caller.
 */
export function buildDockerPlanCommand(
  innerCommand: string,
  tempDir: string,
  image: string,
): string {
  const home = homedir();
  const ui = userInfo();

  // Translate tempDir refs in the command
  const translatedCommand = innerCommand.replaceAll(tempDir, CONTAINER_PLANNING);
  const escapedInner = translatedCommand.replace(/'/g, "'\\''");

  const mounts = [
    `-v "${tempDir}:${CONTAINER_PLANNING}:z"`,
    ...authMounts(home),
  ];

  return [
    "docker run --rm --init",
    `--user ${ui.uid}:${ui.gid}`,
    "--network host",
    "--cap-drop ALL",
    "--security-opt no-new-privileges",
    ...mounts,
    `-w "${CONTAINER_PLANNING}"`,
    image,
    "sh", "-c",
    `'. ${CONTAINER_PLANNING}/.env.sh && ${escapedInner}'`,
  ].join(" ");
}
