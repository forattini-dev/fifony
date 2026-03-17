import type { IssueEntry, RuntimeMetrics } from "./types.ts";
import { computeMetrics } from "./issues.ts";

let cachedMetrics: RuntimeMetrics | null = null;
let metricsStale = true;

export function invalidateMetrics(): void {
  metricsStale = true;
}

export function getMetrics(issues: IssueEntry[]): RuntimeMetrics {
  if (!metricsStale && cachedMetrics) return cachedMetrics;
  cachedMetrics = computeMetrics(issues);
  metricsStale = false;
  return cachedMetrics;
}
