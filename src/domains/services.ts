import type { ServiceEntry, ServiceStatus } from "../types.ts";
import type { ServiceEnvironment } from "./service-env.ts";
import {
  getAllServiceStatuses,
  getServiceStatus,
  readServiceLogTail,
  reconcileServiceStates,
  sendServiceEvent,
  serviceLogPath,
  type ServiceTransition,
} from "../persistence/plugins/fsm-service.ts";

export { getAllServiceStatuses, getServiceStatus, readServiceLogTail, serviceLogPath };
export type { ServiceTransition };

/**
 * Read the status for a single managed service entry.
 */
export function getServiceRuntimeStatus(
  entry: ServiceEntry,
  fifonyDir: string,
): ServiceStatus {
  return getServiceStatus(entry, fifonyDir);
}

/**
 * Read the status for all configured service entries.
 */
export function listServiceStatuses(
  entries: ServiceEntry[],
  fifonyDir: string,
): ServiceStatus[] {
  return getAllServiceStatuses(entries, fifonyDir);
}

export function getManagedServiceLogPath(id: string, fifonyDir: string): string {
  return serviceLogPath(fifonyDir, id);
}

/**
 * Start a managed service via the state machine (sends START event).
 * The spawnService entry action handles the actual process spawn.
 */
export async function startManagedService(
  id: string,
): Promise<void> {
  await sendServiceEvent(id, "START");
}

/**
 * Stop a managed service via the state machine (sends STOP event).
 * The sendSigterm entry action handles SIGTERM delivery.
 */
export async function stopManagedService(
  id: string,
): Promise<void> {
  await sendServiceEvent(id, "STOP");
}

/**
 * Bootstrap auto-start configured services at boot time.
 * Sends START events via the state machine for each autoStart entry.
 */
export async function startAutoConfiguredServices(
  entries: ServiceEntry[],
): Promise<string[]> {
  const started: string[] = [];
  for (const entry of entries) {
    if (!entry.autoStart) continue;
    try {
      await sendServiceEvent(entry.id, "START");
      started.push(entry.id);
    } catch (err) {
      // Non-critical — log and continue with other services
      const { logger } = await import("../concerns/logger.ts");
      logger.warn({ err, id: entry.id }, "[Service] Auto-start failed");
    }
  }
  return started;
}

/**
 * Reconcile persisted pid files with live processes on startup.
 */
export function reconcileManagedServiceStates(
  entries: ServiceEntry[],
  fifonyDir: string,
): void {
  reconcileServiceStates(entries, fifonyDir);
}
