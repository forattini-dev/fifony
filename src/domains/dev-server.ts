import type { DevServerEntry, DevServerStatus } from "../types.ts";
import {
  cmdStart,
  cmdStop,
  getAllDevServerStatuses,
  getDevServerStatus,
  initDevServerWatcher,
  readDevServerLogTail,
  reconcileDevServerStates,
  devServerLogPath,
  type DevServerTransition,
} from "../persistence/plugins/fsm-server.ts";

export { getAllDevServerStatuses, getDevServerStatus, readDevServerLogTail, devServerLogPath };
export type { DevServerTransition };

/**
 * Read the status for a single managed dev-server entry.
 */
export function getDevServerRuntimeStatus(
  entry: DevServerEntry,
  fifonyDir: string,
): DevServerStatus {
  return getDevServerStatus(entry, fifonyDir);
}

/**
 * Read the status for all configured dev-server entries.
 */
export function listDevServerStatuses(
  entries: DevServerEntry[],
  fifonyDir: string,
): DevServerStatus[] {
  return getAllDevServerStatuses(entries, fifonyDir);
}

export function getManagedDevServerLogPath(id: string, fifonyDir: string): string {
  return devServerLogPath(fifonyDir, id);
}

/**
 * Start a managed dev server instance (idempotent through plugin behavior).
 */
export function startManagedDevServer(
  entry: DevServerEntry,
  targetRoot: string,
  fifonyDir: string,
): DevServerTransition {
  return cmdStart(entry, targetRoot, fifonyDir);
}

/**
 * Stop a managed dev server instance (idempotent through plugin behavior).
 */
export function stopManagedDevServer(
  id: string,
  fifonyDir: string,
): DevServerTransition | null {
  return cmdStop(id, fifonyDir);
}

/**
 * Bootstrap auto-start configured dev-servers at boot time.
 */
export function startAutoConfiguredDevServers(
  entries: DevServerEntry[],
  targetRoot: string,
  fifonyDir: string,
): DevServerTransition[] {
  const transitions: DevServerTransition[] = [];
  for (const entry of entries) {
    if (!entry.autoStart) continue;
    transitions.push(startManagedDevServer(entry, targetRoot, fifonyDir));
  }
  return transitions;
}

/**
 * Reconcile persisted pid files with live processes on startup.
 */
export function reconcileManagedDevServerStates(
  entries: DevServerEntry[],
  fifonyDir: string,
): void {
  reconcileDevServerStates(entries, fifonyDir);
}

export const initManagedDevServerWatcher = initDevServerWatcher;
