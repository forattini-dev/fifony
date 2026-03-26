import type { ServiceEntry, ServiceStatus } from "../types.ts";
import type { ServiceEnvironment } from "./service-env.ts";
import {
  cmdStart,
  cmdStop,
  getAllServiceStatuses,
  getServiceStatus,
  initServiceWatcher,
  readServiceLogTail,
  reconcileServiceStates,
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
 * Start a managed service instance (idempotent through plugin behavior).
 */
export function startManagedService(
  entry: ServiceEntry,
  targetRoot: string,
  fifonyDir: string,
  globalEnv?: ServiceEnvironment,
): ServiceTransition {
  return cmdStart(entry, targetRoot, fifonyDir, globalEnv);
}

/**
 * Stop a managed service instance (idempotent through plugin behavior).
 */
export function stopManagedService(
  id: string,
  fifonyDir: string,
): ServiceTransition | null {
  return cmdStop(id, fifonyDir);
}

/**
 * Bootstrap auto-start configured services at boot time.
 */
export function startAutoConfiguredServices(
  entries: ServiceEntry[],
  targetRoot: string,
  fifonyDir: string,
  globalEnv?: ServiceEnvironment,
): ServiceTransition[] {
  const transitions: ServiceTransition[] = [];
  for (const entry of entries) {
    if (!entry.autoStart) continue;
    transitions.push(startManagedService(entry, targetRoot, fifonyDir, globalEnv));
  }
  return transitions;
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

export function initManagedServiceWatcher(
  getEntries: () => ServiceEntry[],
  getGlobalEnv: () => ServiceEnvironment,
  fifonyDir: string,
  targetRoot: string,
  onTransition: (t: ServiceTransition) => void,
): { stop: () => void } {
  return initServiceWatcher(getEntries, getGlobalEnv, fifonyDir, targetRoot, onTransition);
}
