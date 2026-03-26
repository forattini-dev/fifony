import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { isProcessAlive } from "../../agents/pid-manager.ts";
import { logger } from "../../concerns/logger.ts";
import { now } from "../../concerns/helpers.ts";
import type { DevServerEntry, DevServerState, DevServerStatus } from "../../types.ts";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Milliseconds the process must stay alive before "starting" → "running" */
const STARTING_GRACE_MS = 3_000;
/** Milliseconds after SIGTERM before we force SIGKILL */
const STOPPING_KILL_MS = 5_000;
/** Watcher tick interval */
export const DEV_SERVER_WATCHER_INTERVAL_MS = 5_000;

// ── Persisted PID file type ───────────────────────────────────────────────────

export type DevServerPidInfo = {
  pid: number;
  command: string;
  startedAt: string;
  /** FSM state — absent in legacy pid files (migrated on first read) */
  state: DevServerState;
  /** How many times this server has crashed since last manual start */
  crashCount: number;
  lastCrashAt?: string;
  /** ISO timestamp when SIGTERM was sent — for STOPPING_KILL_MS enforcement */
  stoppingAt?: string;
  /** ISO timestamp when auto-restart may fire next */
  nextRetryAt?: string;
};

// ── FSM transition record ─────────────────────────────────────────────────────

export type DevServerTransition = {
  id: string;
  from: DevServerState | "none";
  to: DevServerState;
  pid: number | null;
  reason: string;
};

// ── File helpers ──────────────────────────────────────────────────────────────

function pidPath(fifonyDir: string, id: string): string {
  return join(fifonyDir, `devserver-${id}.pid`);
}

export function devServerLogPath(fifonyDir: string, id: string): string {
  return join(fifonyDir, `devserver-${id}.log`);
}

function readPidInfo(fifonyDir: string, id: string): DevServerPidInfo | null {
  const path = pidPath(fifonyDir, id);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as DevServerPidInfo;
    if (!data?.pid || typeof data.pid !== "number") return null;
    // Migrate legacy pid files that pre-date the FSM (no `state` field)
    if (!data.state) {
      data.state = isProcessAlive(data.pid) ? "running" : "crashed";
      data.crashCount ??= 0;
    }
    return data;
  } catch {
    return null;
  }
}

function writePidInfo(fifonyDir: string, id: string, info: DevServerPidInfo): void {
  writeFileSync(pidPath(fifonyDir, id), JSON.stringify(info));
}

function removePidInfo(fifonyDir: string, id: string): void {
  try { rmSync(pidPath(fifonyDir, id), { force: true }); } catch {}
}

// ── Process spawn ─────────────────────────────────────────────────────────────

function spawnProcess(entry: DevServerEntry, targetRoot: string, fifonyDir: string): number {
  const cwd = entry.cwd ? resolve(targetRoot, entry.cwd) : targetRoot;
  const log = devServerLogPath(fifonyDir, entry.id);
  // Truncate log on each start so the viewer shows a clean session
  try { writeFileSync(log, ""); } catch {}
  // Use fd inheritance — OS redirects child stdout/stderr to file.
  // This works after child.unref() because the OS, not Node.js, handles the I/O.
  const logFd = openSync(log, "a");
  const child = spawn(entry.command, [], {
    shell: true,
    cwd,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  try { closeSync(logFd); } catch {}
  child.unref();
  return child.pid!;
}

// ── Status derivation ─────────────────────────────────────────────────────────

export function getDevServerStatus(entry: DevServerEntry, fifonyDir: string): DevServerStatus {
  const info = readPidInfo(fifonyDir, entry.id);
  const alive = info !== null && isProcessAlive(info.pid);

  // Reconcile stored state with live process reality
  let state: DevServerState;
  if (!info) {
    state = "stopped";
  } else if (info.state === "stopping") {
    state = alive ? "stopping" : "stopped";
  } else if (info.state === "starting" || info.state === "running") {
    state = alive ? info.state : "crashed";
  } else {
    state = info.state; // "crashed" or "stopped"
  }

  const logFile = devServerLogPath(fifonyDir, entry.id);
  let logSize = 0;
  if (existsSync(logFile)) {
    try { logSize = statSync(logFile).size; } catch {}
  }

  const startedAt = info?.startedAt ?? null;
  const running = state === "starting" || state === "running";
  const uptime = startedAt && running ? Date.now() - Date.parse(startedAt) : 0;

  return {
    id: entry.id,
    name: entry.name,
    command: entry.command,
    cwd: entry.cwd,
    state,
    running,
    pid: alive ? (info?.pid ?? null) : null,
    startedAt,
    uptime: Number.isFinite(uptime) ? uptime : 0,
    logSize,
    crashCount: info?.crashCount ?? 0,
    nextRetryAt: info?.nextRetryAt,
  };
}

export function getAllDevServerStatuses(
  entries: DevServerEntry[],
  fifonyDir: string,
): DevServerStatus[] {
  return entries.map((e) => getDevServerStatus(e, fifonyDir));
}

// ── FSM Commands (user-initiated) ─────────────────────────────────────────────

/**
 * START — idempotent.
 *
 * From any state: kills existing process if alive, spawns new process,
 * resets crash count (manual start always gets a fresh slate).
 */
export function cmdStart(
  entry: DevServerEntry,
  targetRoot: string,
  fifonyDir: string,
): DevServerTransition {
  const existing = readPidInfo(fifonyDir, entry.id);
  const fromState: DevServerState | "none" = existing?.state ?? "none";

  // Kill existing process if still alive
  if (existing && isProcessAlive(existing.pid)) {
    try { process.kill(existing.pid, "SIGTERM"); } catch {}
  }

  const pid = spawnProcess(entry, targetRoot, fifonyDir);
  writePidInfo(fifonyDir, entry.id, {
    pid,
    command: entry.command,
    startedAt: now(),
    state: "starting",
    crashCount: 0, // manual start always resets crash count
  });

  logger.info({ id: entry.id, pid, from: fromState }, "[DevServer] FSM: → starting (manual start)");
  return { id: entry.id, from: fromState, to: "starting", pid, reason: "manual start" };
}

/**
 * STOP — idempotent.
 *
 * Sends SIGTERM, transitions to "stopping".
 * The watcher handles SIGKILL after STOPPING_KILL_MS and cleans up the pid file.
 */
export function cmdStop(id: string, fifonyDir: string): DevServerTransition | null {
  const existing = readPidInfo(fifonyDir, id);
  if (!existing || existing.state === "stopped") return null;

  const fromState = existing.state;

  if (isProcessAlive(existing.pid)) {
    try { process.kill(existing.pid, "SIGTERM"); } catch {}
  }

  writePidInfo(fifonyDir, id, {
    ...existing,
    state: "stopping",
    stoppingAt: now(),
  });

  logger.info({ id, pid: existing.pid, from: fromState }, "[DevServer] FSM: → stopping (manual stop)");
  return { id, from: fromState, to: "stopping", pid: existing.pid, reason: "manual stop" };
}

// ── Auto-restart helpers ──────────────────────────────────────────────────────

function autoRestartBackoffMs(crashCount: number): number {
  // Exponential: 1s, 2s, 4s, 8s, 16s, 32s … capped at 60s
  return Math.min(Math.pow(2, crashCount) * 1_000, 60_000);
}

// ── FSM Watcher Tick ──────────────────────────────────────────────────────────

function tickOne(
  entry: DevServerEntry,
  fifonyDir: string,
  targetRoot: string,
): DevServerTransition | null {
  const info = readPidInfo(fifonyDir, entry.id);
  if (!info) return null; // "stopped" — no pid file, nothing to do

  const alive = isProcessAlive(info.pid);
  const nowMs = Date.now();

  switch (info.state) {
    case "starting": {
      if (!alive) {
        // Died during startup → crashed
        const crashCount = (info.crashCount ?? 0) + 1;
        const maxCrashes = entry.maxCrashes ?? 5;
        const autoRestart = entry.autoRestart ?? false;
        const nextRetryAt =
          autoRestart && crashCount < maxCrashes
            ? new Date(nowMs + autoRestartBackoffMs(crashCount)).toISOString()
            : undefined;

        writePidInfo(fifonyDir, entry.id, {
          ...info,
          state: "crashed",
          crashCount,
          lastCrashAt: now(),
          nextRetryAt,
        });
        logger.warn({ id: entry.id, crashCount, nextRetryAt }, "[DevServer] FSM: starting → crashed");
        return {
          id: entry.id, from: "starting", to: "crashed",
          pid: null, reason: `died during startup (crash #${crashCount})`,
        };
      }

      const ageMs = nowMs - Date.parse(info.startedAt);
      if (ageMs >= STARTING_GRACE_MS) {
        writePidInfo(fifonyDir, entry.id, { ...info, state: "running" });
        logger.info({ id: entry.id, pid: info.pid }, "[DevServer] FSM: starting → running");
        return {
          id: entry.id, from: "starting", to: "running",
          pid: info.pid, reason: "startup grace period elapsed",
        };
      }
      return null; // still in grace period
    }

    case "running": {
      if (!alive) {
        const crashCount = (info.crashCount ?? 0) + 1;
        const maxCrashes = entry.maxCrashes ?? 5;
        const autoRestart = entry.autoRestart ?? false;
        const nextRetryAt =
          autoRestart && crashCount < maxCrashes
            ? new Date(nowMs + autoRestartBackoffMs(crashCount)).toISOString()
            : undefined;

        writePidInfo(fifonyDir, entry.id, {
          ...info,
          state: "crashed",
          crashCount,
          lastCrashAt: now(),
          nextRetryAt,
        });
        logger.warn({ id: entry.id, crashCount, nextRetryAt }, "[DevServer] FSM: running → crashed");
        return {
          id: entry.id, from: "running", to: "crashed",
          pid: null, reason: `process died unexpectedly (crash #${crashCount})`,
        };
      }
      return null; // healthy
    }

    case "stopping": {
      if (!alive) {
        removePidInfo(fifonyDir, entry.id);
        logger.info({ id: entry.id }, "[DevServer] FSM: stopping → stopped (process exited)");
        return {
          id: entry.id, from: "stopping", to: "stopped",
          pid: null, reason: "process exited gracefully",
        };
      }

      const stoppingAgeMs = info.stoppingAt
        ? nowMs - Date.parse(info.stoppingAt)
        : STOPPING_KILL_MS + 1;

      if (stoppingAgeMs >= STOPPING_KILL_MS) {
        try { process.kill(info.pid, "SIGKILL"); } catch {}
        removePidInfo(fifonyDir, entry.id);
        logger.info({ id: entry.id, pid: info.pid }, "[DevServer] FSM: stopping → stopped (SIGKILL)");
        return {
          id: entry.id, from: "stopping", to: "stopped",
          pid: null, reason: "SIGKILL after stop timeout",
        };
      }
      return null; // waiting for graceful exit
    }

    case "crashed": {
      const maxCrashes = entry.maxCrashes ?? 5;
      if (!(entry.autoRestart ?? false) || (info.crashCount ?? 0) >= maxCrashes) return null;

      const nextRetryMs = info.nextRetryAt ? Date.parse(info.nextRetryAt) : 0;
      if (nowMs < nextRetryMs) return null; // backoff not elapsed

      // Auto-restart
      const pid = spawnProcess(entry, targetRoot, fifonyDir);
      writePidInfo(fifonyDir, entry.id, {
        pid,
        command: entry.command,
        startedAt: now(),
        state: "starting",
        crashCount: info.crashCount, // preserve crash count on auto-restart
      });
      logger.info(
        { id: entry.id, pid, crashCount: info.crashCount },
        "[DevServer] FSM: crashed → starting (auto-restart)",
      );
      return {
        id: entry.id, from: "crashed", to: "starting",
        pid, reason: `auto-restart after backoff (crash #${info.crashCount})`,
      };
    }

    case "stopped":
      return null;

    default:
      return null;
  }
}

export function tickDevServerWatcher(
  entries: DevServerEntry[],
  fifonyDir: string,
  targetRoot: string,
): DevServerTransition[] {
  const transitions: DevServerTransition[] = [];
  for (const entry of entries) {
    try {
      const t = tickOne(entry, fifonyDir, targetRoot);
      if (t) transitions.push(t);
    } catch (err) {
      logger.warn({ err, id: entry.id }, "[DevServer] Watcher tick error");
    }
  }
  return transitions;
}

// ── Watcher lifecycle ─────────────────────────────────────────────────────────

export function initDevServerWatcher(
  getEntries: () => DevServerEntry[],
  fifonyDir: string,
  targetRoot: string,
  onTransition: (t: DevServerTransition) => void,
): { stop: () => void } {
  const intervalId = setInterval(() => {
    const entries = getEntries();
    if (entries.length === 0) return;
    const transitions = tickDevServerWatcher(entries, fifonyDir, targetRoot);
    for (const t of transitions) onTransition(t);
  }, DEV_SERVER_WATCHER_INTERVAL_MS);

  return { stop: () => clearInterval(intervalId) };
}

// ── Log reader ────────────────────────────────────────────────────────────────

export function readDevServerLogTail(id: string, fifonyDir: string, bytes = 8192): string {
  const log = devServerLogPath(fifonyDir, id);
  if (!existsSync(log)) return "";
  try {
    const size = statSync(log).size;
    const readSize = Math.min(size, bytes);
    const fd = openSync(log, "r");
    const buf = Buffer.alloc(readSize);
    readSync(fd, buf, 0, readSize, Math.max(0, size - readSize));
    closeSync(fd);
    return buf.toString("utf8");
  } catch {
    return "";
  }
}

// ── Boot helpers ──────────────────────────────────────────────────────────────

/**
 * Called at boot: reconcile live process state with persisted pid files.
 * Dead processes are marked as "crashed" so the UI can show them correctly.
 */
export function reconcileDevServerStates(entries: DevServerEntry[], fifonyDir: string): void {
  for (const entry of entries) {
    const info = readPidInfo(fifonyDir, entry.id);
    if (!info) continue;
    if (info.state === "stopped") continue;
    if (!isProcessAlive(info.pid)) {
      const crashCount = (info.crashCount ?? 0) + 1;
      writePidInfo(fifonyDir, entry.id, {
        ...info,
        state: "crashed",
        crashCount,
        lastCrashAt: now(),
      });
      logger.info({ id: entry.id, crashCount }, "[DevServer] Boot: process dead → crashed");
    }
  }
}

