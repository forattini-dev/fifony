import { existsSync, chmodSync, mkdirSync } from "node:fs";
import { homedir, platform, arch } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { logger } from "../concerns/logger.ts";

const BIN_DIR = join(homedir(), ".fifony", "bin");
const AI_JAIL_BIN = join(BIN_DIR, "ai-jail");
const BWRAP_BIN = join(BIN_DIR, "bwrap");

// ── Platform detection ───────────────────────────────────────────────────────

function resolveLinuxArch(): "x86_64" | "aarch64" {
  const cpu = arch();
  if (cpu === "x64") return "x86_64";
  if (cpu === "arm64") return "aarch64";
  throw new Error(`Unsupported Linux architecture: ${cpu}`);
}

function resolveAiJailSuffix(): string {
  const os = platform();
  const cpu = arch();
  if (os === "linux" && cpu === "x64") return "linux-x86_64";
  if (os === "darwin" && cpu === "arm64") return "macos-aarch64";
  if (os === "darwin" && cpu === "x64") return "macos-x86_64";
  throw new Error(`Unsupported platform for ai-jail: ${os}-${cpu}`);
}

// ── Generic download helper ──────────────────────────────────────────────────

function downloadBinary(url: string, destDir: string, binaryName: string): void {
  mkdirSync(destDir, { recursive: true });
  execSync(
    `curl -fsSL "${url}" | tar xz -C "${destDir}"`,
    { stdio: "pipe", timeout: 120_000 },
  );
  const binPath = join(destDir, binaryName);
  if (!existsSync(binPath)) {
    throw new Error(`Binary ${binaryName} not found at ${binPath} after extraction`);
  }
  chmodSync(binPath, 0o755);
}

// ── bwrap (bubblewrap) ───────────────────────────────────────────────────────

/** Check if bwrap is available — either system-installed or in ~/.fifony/bin/ */
export function isBwrapAvailable(): boolean {
  if (platform() !== "linux") return true; // macOS uses sandbox-exec
  // Check our managed binary first, then system PATH
  if (existsSync(BWRAP_BIN)) {
    try { execSync(`"${BWRAP_BIN}" --version`, { stdio: "pipe", timeout: 3_000 }); return true; } catch {}
  }
  try { execSync("which bwrap", { stdio: "pipe", timeout: 3_000 }); return true; } catch {}
  return false;
}

/** Download bwrap from forattini-dev/bubblewrap releases. */
function downloadBwrap(): void {
  const linuxArch = resolveLinuxArch();
  const url = `https://github.com/forattini-dev/bubblewrap/releases/latest/download/bwrap-linux-${linuxArch}.tar.gz`;
  logger.info({ url, dest: BWRAP_BIN }, "[Sandbox] Downloading bubblewrap");
  downloadBinary(url, BIN_DIR, "bwrap");
  logger.info("[Sandbox] bubblewrap installed successfully");
}

/** Ensure bwrap is available — download if missing (Linux only). */
function ensureBwrap(): void {
  if (platform() !== "linux") return;
  if (isBwrapAvailable()) return;
  downloadBwrap();
  if (!isBwrapAvailable()) {
    throw new Error("Failed to install bubblewrap. Sandbox requires bwrap on Linux.");
  }
}

/** Return the bwrap path for BWRAP_BIN env var (if using our managed copy). */
function getBwrapEnv(): Record<string, string> {
  if (existsSync(BWRAP_BIN)) return { BWRAP_BIN };
  return {};
}

// ── ai-jail ──────────────────────────────────────────────────────────────────

export function getAiJailPath(): string { return AI_JAIL_BIN; }

export function isAiJailInstalled(): boolean {
  if (!existsSync(AI_JAIL_BIN)) return false;
  try { execSync(`"${AI_JAIL_BIN}" --version`, { stdio: "pipe", timeout: 5_000 }); return true; } catch { return false; }
}

export function getAiJailVersion(): string | null {
  try { return execSync(`"${AI_JAIL_BIN}" --version`, { stdio: "pipe", timeout: 5_000 }).toString().trim() || null; } catch { return null; }
}

function downloadAiJail(): void {
  const suffix = resolveAiJailSuffix();
  const url = `https://github.com/akitaonrails/ai-jail/releases/latest/download/ai-jail-${suffix}.tar.gz`;
  logger.info({ url, dest: AI_JAIL_BIN }, "[Sandbox] Downloading ai-jail");
  downloadBinary(url, BIN_DIR, "ai-jail");
  const version = getAiJailVersion();
  logger.info({ version }, "[Sandbox] ai-jail installed successfully");
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Ensures both ai-jail and bwrap are available — downloads if missing.
 * Returns the absolute path to the ai-jail binary.
 */
export async function ensureAiJail(): Promise<string> {
  ensureBwrap();
  if (!isAiJailInstalled()) downloadAiJail();
  return AI_JAIL_BIN;
}

/**
 * Wraps a shell command to run inside ai-jail.
 * CWD = worktreePath (auto-mounted as project dir RW by ai-jail).
 */
export function buildSandboxCommand(
  command: string,
  worktreePath: string,
  extraRwPaths?: string[],
): string {
  const rwMaps = [...(extraRwPaths ?? [])];
  const rwFlags = rwMaps.map((p) => `--rw-map "${p}"`).join(" ");
  const escapedCommand = command.replace(/'/g, "'\\''");
  const flags = [
    "--exec",
    "--no-docker",
    "--no-display",
    "--no-gpu",
    "--no-status-bar",
    rwFlags,
  ].filter(Boolean).join(" ");
  // Set BWRAP_BIN so ai-jail finds our managed copy if system bwrap is missing
  const bwrapEnv = getBwrapEnv();
  const envPrefix = bwrapEnv.BWRAP_BIN ? `BWRAP_BIN="${bwrapEnv.BWRAP_BIN}" ` : "";
  return `cd "${worktreePath}" && ${envPrefix}"${AI_JAIL_BIN}" ${flags} -- sh -c '${escapedCommand}'`;
}
