import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AttemptSummary } from "../types.ts";
import { now } from "../concerns/helpers.ts";
import { logger } from "../concerns/logger.ts";
import {
  loadAttemptManifest,
  traceDir,
  type AttemptOutcome,
  type CausalHypothesis,
  type CrossAttemptAnalysis,
  type StrategyPivot,
} from "./trace-bundle.ts";

const CROSS_ATTEMPT_FILE = "cross-attempt.json";

type AttemptRecord = {
  planVersion: number;
  executeAttempt: number;
  summary?: AttemptSummary;
  failureType?: string;
  changedFiles: string[];
  diffStatSize: number;
  outcome: AttemptOutcome;
  nextIssueState?: string;
};

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch (error) {
    logger.debug({ err: String(error), filePath }, "[CrossAttempt] Failed to parse JSON file");
    return null;
  }
}

function diffStatSizeFor(traceDirectory: string): number {
  const filePath = join(traceDirectory, "diff.stat");
  if (!existsSync(filePath)) return 0;
  try {
    return readFileSync(filePath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean).length;
  } catch {
    return 0;
  }
}

function changedFilesFor(traceDirectory: string): string[] {
  return readJsonFile<string[]>(join(traceDirectory, "changed-files.json")) ?? [];
}

function buildAttemptRecords(
  worktreePath: string,
  previousAttemptSummaries: AttemptSummary[] | undefined,
): AttemptRecord[] {
  const deduped = new Map<string, AttemptSummary>();
  for (const summary of previousAttemptSummaries ?? []) {
    deduped.set(`${summary.planVersion}:${summary.executeAttempt}`, summary);
  }

  return [...deduped.values()]
    .sort((left, right) =>
      left.planVersion !== right.planVersion
        ? left.planVersion - right.planVersion
        : left.executeAttempt - right.executeAttempt,
    )
    .map((summary) => {
      const directory = traceDir(worktreePath, summary.planVersion, summary.executeAttempt);
      const manifest = loadAttemptManifest(directory);
      return {
        planVersion: summary.planVersion,
        executeAttempt: summary.executeAttempt,
        summary,
        failureType: summary.insight?.errorType,
        changedFiles: changedFilesFor(directory),
        diffStatSize: diffStatSizeFor(directory),
        outcome: manifest?.outcome ?? "failure",
        nextIssueState: manifest?.nextIssueState,
      };
    });
}

export function persistCrossAttemptAnalysis(traceDirectory: string, analysis: CrossAttemptAnalysis): void {
  try {
    writeFileSync(join(traceDirectory, CROSS_ATTEMPT_FILE), JSON.stringify(analysis, null, 2), "utf8");
  } catch (error) {
    logger.warn({ err: String(error), traceDirectory }, "[CrossAttempt] Failed to write cross-attempt analysis");
  }
}

export function loadCrossAttemptAnalysis(traceDirectory: string): CrossAttemptAnalysis | null {
  return readJsonFile<CrossAttemptAnalysis>(join(traceDirectory, CROSS_ATTEMPT_FILE));
}

export function findLastTurnDirectivePath(traceDirectory: string): string | null {
  const turnsDirectory = join(traceDirectory, "turns");
  if (!existsSync(turnsDirectory)) return null;
  try {
    const directives = readdirSync(turnsDirectory)
      .filter((entry) => entry.endsWith(".directive.json"))
      .sort((left, right) => left.localeCompare(right));
    return directives.length > 0 ? join(turnsDirectory, directives[directives.length - 1]!) : null;
  } catch {
    return null;
  }
}

// ── Causal reasoning (Phase 2: Meta-Harness alignment) ──────────────────────

function formHypotheses(records: AttemptRecord[]): CausalHypothesis[] {
  if (records.length < 2) return [];
  const hypotheses: CausalHypothesis[] = [];

  // 1. Same-file regression: file appears in 3+ attempts with same error type
  const fileAppearances = new Map<string, { count: number; errorTypes: Set<string>; attempts: number[] }>();
  for (const r of records) {
    for (const f of r.changedFiles) {
      const entry = fileAppearances.get(f) ?? { count: 0, errorTypes: new Set(), attempts: [] };
      entry.count++;
      if (r.failureType) entry.errorTypes.add(r.failureType);
      entry.attempts.push(r.executeAttempt);
      fileAppearances.set(f, entry);
    }
  }
  for (const [file, data] of fileAppearances) {
    if (data.count >= 3 && data.errorTypes.size === 1) {
      const errorType = [...data.errorTypes][0]!;
      hypotheses.push({
        signal: `\`${file}\` modified in ${data.count} attempts, all with ${errorType} error`,
        hypothesis: `The current approach to \`${file}\` is fundamentally wrong for this error class`,
        evidence: [`Attempts ${data.attempts.join(", ")} all modified this file`, `Same error type (${errorType}) persists`],
        suggestion: `Try a completely different strategy for \`${file}\` — the repeated approach is not converging`,
      });
    }
  }

  // 2. Error type oscillation: alternating types (e.g., typescript → test → typescript)
  if (records.length >= 3) {
    const types = records.map((r) => r.failureType ?? "unknown");
    let oscillating = true;
    for (let i = 2; i < types.length; i++) {
      if (types[i] !== types[i - 2] || types[i] === types[i - 1]) { oscillating = false; break; }
    }
    if (oscillating && types.length >= 3) {
      hypotheses.push({
        signal: `Error types alternate: ${types.slice(-4).join(" → ")}`,
        hypothesis: "Fixing one error class introduces the other — the two are coupled",
        evidence: types.map((t, i) => `Attempt ${records[i]!.executeAttempt}: ${t}`),
        suggestion: "Address both error classes simultaneously in a single coherent change",
      });
    }
  }

  // 3. Diff size regression: growing diffs without outcome improvement
  if (records.length >= 2) {
    const failedRecords = records.filter((r) => r.outcome === "failure");
    if (failedRecords.length >= 3) {
      const growing = failedRecords.every((r, i) => i === 0 || r.diffStatSize >= failedRecords[i - 1]!.diffStatSize);
      const firstSize = failedRecords[0]!.diffStatSize;
      const lastSize = failedRecords[failedRecords.length - 1]!.diffStatSize;
      if (growing && lastSize > firstSize * 1.5 && lastSize > 5) {
        hypotheses.push({
          signal: `Diff size grew from ${firstSize} to ${lastSize} lines across ${failedRecords.length} failed attempts`,
          hypothesis: "The approach is accumulating complexity without solving the root cause",
          evidence: failedRecords.map((r) => `Attempt ${r.executeAttempt}: ${r.diffStatSize} lines, outcome: ${r.outcome}`),
          suggestion: "Start with the minimal possible change — add one thing at a time and verify",
        });
      }
    }
  }

  // 4. Zero-diff attempts: agent produced no changes
  const zeroDiffs = records.filter((r) => r.changedFiles.length === 0 && r.diffStatSize === 0);
  if (zeroDiffs.length > 0) {
    hypotheses.push({
      signal: `${zeroDiffs.length} attempt(s) produced no file changes`,
      hypothesis: "The agent got stuck in analysis without making concrete modifications",
      evidence: zeroDiffs.map((r) => `Attempt ${r.executeAttempt}: 0 files changed`),
      suggestion: "Make the smallest possible edit first, then iterate — avoid analysis-only turns",
    });
  }

  return hypotheses;
}

function detectStrategyPivot(records: AttemptRecord[]): StrategyPivot | null {
  if (records.length < 3) return null;

  // Check for consecutive same-type failures
  const recent = records.slice(-3);
  const types = recent.map((r) => r.failureType).filter(Boolean);
  if (types.length === 3 && types[0] === types[1] && types[1] === types[2]) {
    return {
      reason: `${types.length} consecutive ${types[0]} failures`,
      consecutiveRegressions: types.length,
      suggestedApproach: "The current implementation path is exhausted. Try a fundamentally different approach: different algorithm, different API surface, or different file structure.",
    };
  }

  // Check for repeated suggestions (agent told the same thing repeatedly)
  const suggestions = records.map((r) => r.summary?.insight?.suggestion).filter(Boolean);
  if (suggestions.length >= 2) {
    const last = suggestions[suggestions.length - 1];
    const secondLast = suggestions[suggestions.length - 2];
    if (last && secondLast && last === secondLast) {
      return {
        reason: "Same corrective suggestion repeated without progress",
        consecutiveRegressions: 2,
        suggestedApproach: "The previous suggestion was attempted but did not resolve the issue. Apply a structurally different fix rather than retrying the same correction.",
      };
    }
  }

  return null;
}

function isolateConfounds(records: AttemptRecord[]): string[] {
  if (records.length < 2) return [];
  const confounds: string[] = [];

  // Files that changed in attempt N but not N+1 (or vice versa) while both failed
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1]!;
    const curr = records[i]!;
    if (prev.outcome !== "failure" || curr.outcome !== "failure") continue;

    const prevSet = new Set(prev.changedFiles);
    const currSet = new Set(curr.changedFiles);
    for (const f of prevSet) {
      if (!currSet.has(f)) confounds.push(`\`${f}\` changed in attempt ${prev.executeAttempt} but not ${curr.executeAttempt} — likely irrelevant to the failure`);
    }
  }

  return confounds.slice(0, 5);
}

export function computeCrossAttemptAnalysis(
  worktreePath: string,
  currentPV: number,
  currentEA: number,
  previousAttemptSummaries: AttemptSummary[] | undefined,
): CrossAttemptAnalysis {
  const records = buildAttemptRecords(worktreePath, previousAttemptSummaries)
    .filter((record) => record.planVersion < currentPV || record.executeAttempt < currentEA);

  const failureCounts = new Map<string, number>();
  for (const record of records) {
    if (!record.failureType || record.failureType === "unknown") continue;
    failureCounts.set(record.failureType, (failureCounts.get(record.failureType) ?? 0) + 1);
  }

  const repeatedFailureTypes = [...failureCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([failureType]) => failureType)
    .sort((left, right) => left.localeCompare(right));

  const overlap = new Set<string>();
  for (let index = 1; index < records.length; index += 1) {
    const previous = new Set(records[index - 1]!.changedFiles);
    for (const filePath of records[index]!.changedFiles) {
      if (previous.has(filePath)) overlap.add(filePath);
    }
  }

  const outcomeTransitions = records.map((record) => ({
    attempt: record.executeAttempt,
    outcome: record.outcome,
    nextIssueState: record.nextIssueState,
  }));

  const summary: string[] = [];
  if (records.length === 0) {
    summary.push("No previous attempt artifacts were available; retry should rely on summary-only context.");
  }
  if (repeatedFailureTypes.length > 0) {
    summary.push(`Repeated failure types: ${repeatedFailureTypes.join(", ")}.`);
  }
  if (overlap.size > 0) {
    summary.push(`Repeated file edits across adjacent attempts: ${[...overlap].slice(0, 8).join(", ")}.`);
  }
  if (records.length >= 2) {
    const previous = records[records.length - 2]!;
    const latest = records[records.length - 1]!;
    summary.push(
      `Recent outcome transition: a${previous.executeAttempt} ${previous.outcome}/${previous.nextIssueState ?? "unknown"} -> a${latest.executeAttempt} ${latest.outcome}/${latest.nextIssueState ?? "unknown"}.`,
    );
    summary.push(
      `Diff footprint changed from ${previous.diffStatSize} diff.stat line(s) to ${latest.diffStatSize} diff.stat line(s).`,
    );
  }
  if (summary.length === 0) {
    summary.push("No strong cross-attempt pattern detected.");
  }

  // Phase 2: Causal reasoning — deterministic, no LLM calls
  const hypotheses = formHypotheses(records);
  const strategyPivot = detectStrategyPivot(records);
  const confounds = isolateConfounds(records);

  return {
    generatedAt: now(),
    repeatedFailureTypes,
    changedFileOverlap: [...overlap].sort((left, right) => left.localeCompare(right)),
    outcomeTransitions,
    summary,
    hypotheses,
    strategyPivot,
    confounds,
  };
}
