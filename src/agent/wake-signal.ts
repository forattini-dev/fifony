/**
 * wake-signal.ts — Thin module holding the scheduler wake callback.
 *
 * Extracted to break the circular dependency:
 *   scheduler.ts ← agent.ts ← issue-runner.ts ← scheduler.ts
 *
 * Both scheduler.ts (which installs the resolver) and issue-runner.ts
 * (which calls wakeScheduler after a background planning job completes)
 * can safely import from this module without creating a cycle.
 */

let wakeResolve: (() => void) | null = null;

export function setWakeResolve(fn: (() => void) | null): void {
  wakeResolve = fn;
}

export function wakeScheduler(): void {
  wakeResolve?.();
}
