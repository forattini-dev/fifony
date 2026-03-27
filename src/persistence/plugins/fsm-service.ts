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
import type { ServiceEntry, ServiceState, ServiceStatus } from "../../types.ts";
import { buildServiceCommand } from "../../domains/service-env.ts";
import type { ServiceEnvironment } from "../../domains/service-env.ts";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Milliseconds the process must stay alive before "starting" → "running" */
const STARTING_GRACE_MS = 3_000;
/** Milliseconds after SIGTERM before we force SIGKILL */
const STOPPING_KILL_MS = 5_000;
/** Watcher tick interval */
export const SERVICE_WATCHER_INTERVAL_MS = 5_000;

// ── Persisted PID file type ───────────────────────────────────────────────────

export type ServicePidInfo = {
  pid: number;
  command: string;
  startedAt: string;
  /** FSM state — absent in legacy pid files (migrated on first read) */
  state: ServiceState;
  /** How many times this service has crashed since last manual start */
  crashCount: number;
  lastCrashAt?: string;
  /** ISO timestamp when SIGTERM was sent — for STOPPING_KILL_MS enforcement */
  stoppingAt?: string;
  /** ISO timestamp when auto-restart may fire next */
  nextRetryAt?: string;
};

// ── FSM transition record ─────────────────────────────────────────────────────

export type ServiceTransition = {
  id: string;
  from: ServiceState | "none";
  to: ServiceState;
  pid: number | null;
  reason: string;
};

// ── File helpers ──────────────────────────────────────────────────────────────

function pidPath(fifonyDir: string, id: string): string {
  return join(fifonyDir, `service-${id}.pid`);
}

export function serviceLogPath(fifonyDir: string, id: string): string {
  return join(fifonyDir, `service-${id}.log`);
}

function readPidInfo(fifonyDir: string, id: string): ServicePidInfo | null {
  const path = pidPath(fifonyDir, id);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as ServicePidInfo;
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

function writePidInfo(fifonyDir: string, id: string, info: ServicePidInfo): void {
  writeFileSync(pidPath(fifonyDir, id), JSON.stringify(info));
}

function removePidInfo(fifonyDir: string, id: string): void {
  try { rmSync(pidPath(fifonyDir, id), { force: true }); } catch {}
}

// ── Process spawn ─────────────────────────────────────────────────────────────

function spawnProcess(
  entry: ServiceEntry,
  targetRoot: string,
  fifonyDir: string,
  globalEnv?: ServiceEnvironment,
): { pid: number; command: string } {
  const cwd = entry.cwd ? resolve(targetRoot, entry.cwd) : targetRoot;
  const log = serviceLogPath(fifonyDir, entry.id);
  const command = buildServiceCommand(entry.command, globalEnv, entry.env);
  // Truncate log on each start so the viewer shows a clean session
  try { writeFileSync(log, ""); } catch {}
  // Use fd inheritance — OS redirects child stdout/stderr to file.
  // This works after child.unref() because the OS, not Node.js, handles the I/O.
  const logFd = openSync(log, "a");
  const child = spawn(command, [], {
    shell: true,
    cwd,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  try { closeSync(logFd); } catch {}
  child.unref();
  if (child.pid === undefined) {
    throw new Error(`Failed to spawn service process: ${command}`);
  }
  return { pid: child.pid, command };
}

// ── Status derivation ─────────────────────────────────────────────────────────

export function getServiceStatus(entry: ServiceEntry, fifonyDir: string): ServiceStatus {
  const info = readPidInfo(fifonyDir, entry.id);
  const alive = info !== null && isProcessAlive(info.pid);

  // Reconcile stored state with live process reality
  let state: ServiceState;
  if (!info) {
    state = "stopped";
  } else if (info.state === "stopping") {
    state = alive ? "stopping" : "stopped";
  } else if (info.state === "starting" || info.state === "running") {
    state = alive ? info.state : "crashed";
  } else {
    state = info.state; // "crashed" or "stopped"
  }

  const logFile = serviceLogPath(fifonyDir, entry.id);
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
    env: entry.env,
    autoStart: entry.autoStart,
    autoRestart: entry.autoRestart,
    maxCrashes: entry.maxCrashes,
    port: entry.port,
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

export function getAllServiceStatuses(
  entries: ServiceEntry[],
  fifonyDir: string,
): ServiceStatus[] {
  return entries.map((e) => getServiceStatus(e, fifonyDir));
}

// ── FSM Commands (user-initiated) ─────────────────────────────────────────────

/**
 * START — idempotent.
 *
 * From any state: kills existing process if alive, spawns new process,
 * resets crash count (manual start always gets a fresh slate).
 */
export function cmdStart(
  entry: ServiceEntry,
  targetRoot: string,
  fifonyDir: string,
  globalEnv?: ServiceEnvironment,
): ServiceTransition {
  const existing = readPidInfo(fifonyDir, entry.id);
  const fromState: ServiceState | "none" = existing?.state ?? "none";

  // Kill existing process group + direct PID (detached: true makes the shell a group leader;
  // -pid kills the entire group so child processes like node don't orphan the port.
  // Fallback direct kill covers the case where the shell already died but a child survived.)
  if (existing && isProcessAlive(existing.pid)) {
    try { process.kill(-existing.pid, "SIGKILL"); } catch {}
    try { process.kill(existing.pid, "SIGKILL"); } catch {}
  }

  const spawned = spawnProcess(entry, targetRoot, fifonyDir, globalEnv);
  writePidInfo(fifonyDir, entry.id, {
    pid: spawned.pid,
    command: spawned.command,
    startedAt: now(),
    state: "starting",
    crashCount: 0, // manual start always resets crash count
  });

  logger.info({ id: entry.id, pid: spawned.pid, from: fromState }, "[Service] FSM: → starting (manual start)");
  return { id: entry.id, from: fromState, to: "starting", pid: spawned.pid, reason: "manual start" };
}

/**
 * STOP — idempotent.
 *
 * Sends SIGTERM, transitions to "stopping".
 * The watcher handles SIGKILL after STOPPING_KILL_MS and cleans up the pid file.
 */
export function cmdStop(id: string, fifonyDir: string): ServiceTransition | null {
  const existing = readPidInfo(fifonyDir, id);
  if (!existing || existing.state === "stopped") return null;

  const fromState = existing.state;

  if (isProcessAlive(existing.pid)) {
    try { process.kill(-existing.pid, "SIGTERM"); } catch {}
  }

  writePidInfo(fifonyDir, id, {
    ...existing,
    state: "stopping",
    stoppingAt: now(),
  });

  logger.info({ id, pid: existing.pid, from: fromState }, "[Service] FSM: → stopping (manual stop)");
  return { id, from: fromState, to: "stopping", pid: existing.pid, reason: "manual stop" };
}

// ── Auto-restart helpers ──────────────────────────────────────────────────────

function autoRestartBackoffMs(crashCount: number): number {
  // Exponential: 1s, 2s, 4s, 8s, 16s, 32s … capped at 60s
  return Math.min(Math.pow(2, crashCount) * 1_000, 60_000);
}

// ── FSM Watcher Tick ──────────────────────────────────────────────────────────

function tickOne(
  entry: ServiceEntry,
  globalEnv: ServiceEnvironment,
  fifonyDir: string,
  targetRoot: string,
): ServiceTransition | null {
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
        logger.warn({ id: entry.id, crashCount, nextRetryAt }, "[Service] FSM: starting → crashed");
        return {
          id: entry.id, from: "starting", to: "crashed",
          pid: null, reason: `died during startup (crash #${crashCount})`,
        };
      }

      const ageMs = nowMs - Date.parse(info.startedAt);
      if (ageMs >= STARTING_GRACE_MS) {
        writePidInfo(fifonyDir, entry.id, { ...info, state: "running" });
        logger.info({ id: entry.id, pid: info.pid }, "[Service] FSM: starting → running");
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
        logger.warn({ id: entry.id, crashCount, nextRetryAt }, "[Service] FSM: running → crashed");
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
        logger.info({ id: entry.id }, "[Service] FSM: stopping → stopped (process exited)");
        return {
          id: entry.id, from: "stopping", to: "stopped",
          pid: null, reason: "process exited gracefully",
        };
      }

      const stoppingAgeMs = info.stoppingAt
        ? nowMs - Date.parse(info.stoppingAt)
        : STOPPING_KILL_MS + 1;

      if (stoppingAgeMs >= STOPPING_KILL_MS) {
        try { process.kill(-info.pid, "SIGKILL"); } catch {}
        try { process.kill(info.pid, "SIGKILL"); } catch {}
        removePidInfo(fifonyDir, entry.id);
        logger.info({ id: entry.id, pid: info.pid }, "[Service] FSM: stopping → stopped (SIGKILL)");
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
      const spawned = spawnProcess(entry, targetRoot, fifonyDir, globalEnv);
      writePidInfo(fifonyDir, entry.id, {
        pid: spawned.pid,
        command: spawned.command,
        startedAt: now(),
        state: "starting",
        crashCount: info.crashCount, // preserve crash count on auto-restart
      });
      logger.info(
        { id: entry.id, pid: spawned.pid, crashCount: info.crashCount },
        "[Service] FSM: crashed → starting (auto-restart)",
      );
      return {
        id: entry.id, from: "crashed", to: "starting",
        pid: spawned.pid, reason: `auto-restart after backoff (crash #${info.crashCount})`,
      };
    }

    case "stopped":
      return null;

    default:
      return null;
  }
}

export function tickServiceWatcher(
  entries: ServiceEntry[],
  globalEnv: ServiceEnvironment,
  fifonyDir: string,
  targetRoot: string,
): ServiceTransition[] {
  const transitions: ServiceTransition[] = [];
  for (const entry of entries) {
    try {
      const t = tickOne(entry, globalEnv, fifonyDir, targetRoot);
      if (t) transitions.push(t);
    } catch (err) {
      logger.warn({ err, id: entry.id }, "[Service] Watcher tick error");
    }
  }
  return transitions;
}

// ── Watcher lifecycle ─────────────────────────────────────────────────────────

export function initServiceWatcher(
  getEntries: () => ServiceEntry[],
  getGlobalEnv: () => ServiceEnvironment,
  fifonyDir: string,
  targetRoot: string,
  onTransition: (t: ServiceTransition) => void,
): { stop: () => void } {
  const intervalId = setInterval(() => {
    const entries = getEntries();
    if (entries.length === 0) return;
    const transitions = tickServiceWatcher(entries, getGlobalEnv(), fifonyDir, targetRoot);
    for (const t of transitions) onTransition(t);
  }, SERVICE_WATCHER_INTERVAL_MS);

  return { stop: () => clearInterval(intervalId) };
}

// ── Log reader ────────────────────────────────────────────────────────────────

export function readServiceLogTail(id: string, fifonyDir: string, bytes = 8192): string {
  const log = serviceLogPath(fifonyDir, id);
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
export function reconcileServiceStates(entries: ServiceEntry[], fifonyDir: string): void {
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
      logger.info({ id: entry.id, crashCount }, "[Service] Boot: process dead → crashed");
    }
  }
}
