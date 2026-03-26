import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
  IssueEntry,
  WorkspaceMemoryEntry,
  MemoryFlushReport,
} from "../types.ts";
import { now } from "../concerns/helpers.ts";
import { markIssueDirty } from "../persistence/dirty-tracker.ts";
import { collectRecurringFailurePatterns } from "./review-failure-history.ts";

const MEMORY_DIRNAME = "memory";
const WORKFLOW_FILE = "WORKFLOW.md";
const MEMORY_FILE = "MEMORY.md";
const HEARTBEAT_FILE = "HEARTBEAT.md";

type WorkspaceMemoryPaths = {
  root: string;
  memoryDir: string;
  workflowFile: string;
  memoryFile: string;
  heartbeatFile: string;
  dailyFile: string;
};

export type WorkspaceContextDocument = {
  layer: "bootstrap" | "workspace-memory";
  kind: "doc" | "issue-memory";
  path: string;
  sourceId: string;
  text: string;
};

export interface MemoryEngine {
  ensureWorkspaceArtifacts(issue: IssueEntry, workspacePath: string): WorkspaceMemoryPaths;
  flushIssueMemory(issue: IssueEntry, workspacePath: string, reason: string): MemoryFlushReport | null;
  recordIssueEvent(issue: IssueEntry, workspacePath: string, entry: WorkspaceMemoryEntry): boolean;
  listContextDocuments(workspacePath: string): WorkspaceContextDocument[];
}

function resolveTodayDate(value = now()): string {
  return value.slice(0, 10);
}

function resolvePaths(workspacePath: string, date = resolveTodayDate()): WorkspaceMemoryPaths {
  const memoryDir = join(workspacePath, MEMORY_DIRNAME);
  return {
    root: workspacePath,
    memoryDir,
    workflowFile: join(workspacePath, WORKFLOW_FILE),
    memoryFile: join(workspacePath, MEMORY_FILE),
    heartbeatFile: join(workspacePath, HEARTBEAT_FILE),
    dailyFile: join(memoryDir, `${date}.md`),
  };
}

function readText(filePath: string): string {
  try {
    return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  } catch {
    return "";
  }
}

function writeIfChanged(filePath: string, next: string): boolean {
  const current = readText(filePath);
  if (current === next) return false;
  writeFileSync(filePath, next, "utf8");
  return true;
}

function ensureFile(filePath: string, initial: string): boolean {
  if (existsSync(filePath)) return false;
  writeFileSync(filePath, initial, "utf8");
  return true;
}

function renderWorkflowDocument(issue: IssueEntry): string {
  const plan = issue.plan;
  const lines = [
    "# Fifony Workflow Context",
    "",
    `Updated: ${now()}`,
    `Issue: ${issue.identifier} - ${issue.title}`,
    `State: ${issue.state}`,
    `Plan version: ${issue.planVersion ?? 0}`,
    `Execute attempt: ${issue.executeAttempt ?? 0}`,
    `Review attempt: ${issue.reviewAttempt ?? 0}`,
    `Harness mode: ${plan?.harnessMode ?? "unknown"}`,
    "",
  ];

  if (plan?.summary) {
    lines.push("## Current Plan", "", plan.summary, "");
  }

  if (plan?.executionContract) {
    lines.push("## Execution Contract", "");
    lines.push(`Summary: ${plan.executionContract.summary}`);
    lines.push(`Checkpoint policy: ${plan.executionContract.checkpointPolicy}`);
    if (plan.executionContract.focusAreas.length > 0) {
      lines.push("", "Focus areas:");
      for (const focusArea of plan.executionContract.focusAreas) lines.push(`- ${focusArea}`);
    }
    if (plan.executionContract.requiredChecks.length > 0) {
      lines.push("", "Required checks:");
      for (const check of plan.executionContract.requiredChecks) lines.push(`- ${check}`);
    }
    lines.push("");
  }

  if (plan?.acceptanceCriteria?.length) {
    lines.push("## Acceptance Criteria", "");
    for (const criterion of plan.acceptanceCriteria) {
      lines.push(`- ${criterion.id} [${criterion.category}] ${criterion.blocking ? "blocking" : "advisory"}: ${criterion.description}`);
    }
    lines.push("");
  }

  const recurringFailures = collectRecurringFailurePatterns(issue, {
    currentPlanVersionOnly: true,
    minOccurrences: 2,
    limit: 5,
  });
  if (recurringFailures.length > 0) {
    lines.push("## Recurring Failure Patterns", "");
    for (const failure of recurringFailures) {
      lines.push(`- ${failure.criterionId} failed ${failure.count}x: ${failure.description}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function renderHeartbeatDocument(issue: IssueEntry): string {
  const lines = [
    "# Fifony Heartbeat",
    "",
    "Use this file as the short operational checklist for the current issue workspace.",
    "",
    "## Current Checks",
    "",
    `- Current state: ${issue.state}`,
    `- Review attempts: ${issue.reviewAttempt ?? 0}`,
    `- Checkpoint status: ${issue.checkpointStatus ?? "n/a"}`,
    `- Last error: ${issue.lastError ?? "none"}`,
  ];

  if (issue.plan?.executionContract.focusAreas?.length) {
    lines.push("", "## Focus Next", "");
    for (const focusArea of issue.plan.executionContract.focusAreas) {
      lines.push(`- Inspect ${focusArea}`);
    }
  }

  const recentPolicyDecisions = (issue.policyDecisions ?? []).slice(0, 3);
  if (recentPolicyDecisions.length > 0) {
    lines.push("", "## Recent Policy Decisions", "");
    for (const decision of recentPolicyDecisions) {
      lines.push(`- ${decision.kind}: ${decision.rationale}`);
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

function renderMemoryHeader(issue: IssueEntry): string {
  return [
    "# Durable Workspace Memory",
    "",
    "This file keeps high-value lessons for the current issue workspace.",
    "",
    `Issue: ${issue.identifier} - ${issue.title}`,
    "",
    "## Durable Learnings",
    "",
  ].join("\n");
}

function buildDurableEntries(issue: IssueEntry): WorkspaceMemoryEntry[] {
  const entries: WorkspaceMemoryEntry[] = [];
  for (const failure of collectRecurringFailurePatterns(issue, {
    currentPlanVersionOnly: true,
    minOccurrences: 2,
    limit: 10,
  })) {
    entries.push({
      id: `failure-${failure.criterionId}`,
      kind: "review-failure",
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      title: `Recurring blocking failure: ${failure.criterionId}`,
      summary: `${failure.description} Failed ${failure.count} times.`,
      details: failure.latestEvidence ? [failure.latestEvidence] : undefined,
      source: "review",
      createdAt: failure.latestRecordedAt,
      planVersion: issue.planVersion,
      reviewAttempt: issue.reviewAttempt,
      persistLongTerm: true,
      tags: [failure.category, "recurring-failure"],
    });
  }

  for (const decision of issue.policyDecisions ?? []) {
    entries.push({
      id: `policy-${decision.id}`,
      kind: "policy-decision",
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      title: `Policy decision: ${decision.kind}`,
      summary: decision.rationale,
      source: "runtime",
      createdAt: decision.recordedAt,
      planVersion: decision.planVersion,
      reviewScope: decision.reviewScope,
      persistLongTerm: true,
      tags: [decision.kind, decision.basis],
    });
  }

  const latestNegotiation = [...(issue.contractNegotiationRuns ?? [])]
    .filter((entry) => entry.status === "completed" && entry.blockingConcernsCount && entry.blockingConcernsCount > 0)
    .sort((left, right) => Date.parse(right.completedAt ?? right.startedAt) - Date.parse(left.completedAt ?? left.startedAt))[0];
  if (latestNegotiation) {
    entries.push({
      id: `contract-${latestNegotiation.id}`,
      kind: "contract-negotiation",
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      title: "Contract negotiation concern",
      summary: latestNegotiation.summary || "Execution contract required revision before code could be written.",
      details: (latestNegotiation.concerns ?? []).slice(0, 3).map((concern) => `${concern.id}: ${concern.requiredChange}`),
      source: "planning",
      createdAt: latestNegotiation.completedAt ?? latestNegotiation.startedAt,
      planVersion: latestNegotiation.planVersion,
      persistLongTerm: true,
      tags: ["contractual", "planning"],
    });
  }

  return entries;
}

function renderEntry(entry: WorkspaceMemoryEntry): string {
  const lines = [
    `<!-- fifony-memory:${entry.id} -->`,
    `### ${entry.title}`,
    "",
    `- kind: ${entry.kind}`,
    `- source: ${entry.source}`,
    `- createdAt: ${entry.createdAt}`,
    `- planVersion: ${entry.planVersion ?? 0}`,
    entry.reviewAttempt ? `- reviewAttempt: ${entry.reviewAttempt}` : "",
    entry.reviewScope ? `- reviewScope: ${entry.reviewScope}` : "",
    entry.tags?.length ? `- tags: ${entry.tags.join(", ")}` : "",
    "",
    entry.summary,
    "",
  ].filter(Boolean);

  if (entry.details?.length) {
    lines.push("Details:");
    for (const detail of entry.details) lines.push(`- ${detail}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function appendUniqueEntry(filePath: string, entry: WorkspaceMemoryEntry): boolean {
  const marker = `<!-- fifony-memory:${entry.id} -->`;
  const current = readText(filePath);
  if (current.includes(marker)) return false;
  const prefix = current && !current.endsWith("\n") ? "\n\n" : current ? "\n" : "";
  writeFileSync(filePath, `${current}${prefix}${renderEntry(entry)}`, "utf8");
  return true;
}

function listRecentDailyFiles(memoryDir: string): string[] {
  if (!existsSync(memoryDir)) return [];
  return readdirSync(memoryDir)
    .filter((entry) => entry.endsWith(".md"))
    .sort((left, right) => right.localeCompare(left))
    .slice(0, 3)
    .map((entry) => join(memoryDir, entry));
}

export function ensureWorkspaceMemoryFiles(issue: IssueEntry, workspacePath: string): WorkspaceMemoryPaths {
  const paths = resolvePaths(workspacePath);
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(paths.memoryDir, { recursive: true });
  ensureFile(paths.workflowFile, renderWorkflowDocument(issue));
  ensureFile(paths.memoryFile, renderMemoryHeader(issue));
  ensureFile(paths.heartbeatFile, renderHeartbeatDocument(issue));
  ensureFile(paths.dailyFile, `# Daily Memory - ${resolveTodayDate()}\n\n`);
  return paths;
}

export function flushWorkspaceMemory(issue: IssueEntry, workspacePath: string, reason: string): MemoryFlushReport | null {
  if (!workspacePath) return null;
  const paths = ensureWorkspaceMemoryFiles(issue, workspacePath);
  const changedFiles: string[] = [];
  let promotedEntries = 0;

  if (writeIfChanged(paths.workflowFile, renderWorkflowDocument(issue))) changedFiles.push(paths.workflowFile);
  if (writeIfChanged(paths.heartbeatFile, renderHeartbeatDocument(issue))) changedFiles.push(paths.heartbeatFile);
  if (!existsSync(paths.memoryFile)) {
    writeFileSync(paths.memoryFile, renderMemoryHeader(issue), "utf8");
    changedFiles.push(paths.memoryFile);
  }

  for (const entry of buildDurableEntries(issue)) {
    if (appendUniqueEntry(paths.memoryFile, entry)) promotedEntries += 1;
  }
  if (promotedEntries > 0 && !changedFiles.includes(paths.memoryFile)) changedFiles.push(paths.memoryFile);

  if (changedFiles.length === 0 && issue.memoryFlushAt) return null;

  issue.memoryFlushAt = now();
  issue.memoryFlushCount = (issue.memoryFlushCount ?? 0) + 1;
  markIssueDirty(issue.id);

  return {
    flushedAt: issue.memoryFlushAt,
    reason,
    changedFiles,
    entriesWritten: changedFiles.length,
    promotedEntries,
  };
}

export function recordWorkspaceMemoryEvent(issue: IssueEntry, workspacePath: string, entry: WorkspaceMemoryEntry): boolean {
  if (!workspacePath) return false;
  const paths = ensureWorkspaceMemoryFiles(issue, workspacePath);
  const wroteDaily = appendUniqueEntry(paths.dailyFile, entry);
  const wroteLongTerm = entry.persistLongTerm ? appendUniqueEntry(paths.memoryFile, entry) : false;
  if (!wroteDaily && !wroteLongTerm) return false;
  issue.memoryFlushAt = now();
  issue.memoryFlushCount = (issue.memoryFlushCount ?? 0) + 1;
  markIssueDirty(issue.id);
  return true;
}

export function listWorkspaceMemoryContextDocuments(workspacePath: string): WorkspaceContextDocument[] {
  const paths = resolvePaths(workspacePath);
  const docs: WorkspaceContextDocument[] = [];
  const bootstrapFiles: Array<{ path: string; layer: "bootstrap" | "workspace-memory"; kind: "doc" | "issue-memory" }> = [
    { path: paths.workflowFile, layer: "bootstrap", kind: "doc" },
    { path: paths.heartbeatFile, layer: "bootstrap", kind: "doc" },
    { path: paths.memoryFile, layer: "workspace-memory", kind: "issue-memory" },
  ];

  for (const file of bootstrapFiles) {
    const text = readText(file.path);
    if (!text.trim()) continue;
    docs.push({
      layer: file.layer,
      kind: file.kind,
      path: file.path.slice(workspacePath.length + 1).replace(/\\/g, "/"),
      sourceId: `workspace:${file.path}`,
      text,
    });
  }

  for (const dailyFile of listRecentDailyFiles(paths.memoryDir)) {
    const text = readText(dailyFile);
    if (!text.trim()) continue;
    docs.push({
      layer: "workspace-memory",
      kind: "issue-memory",
      path: dailyFile.slice(workspacePath.length + 1).replace(/\\/g, "/"),
      sourceId: `workspace:${dailyFile}`,
      text,
    });
  }

  return docs;
}

export const DEFAULT_MEMORY_ENGINE: MemoryEngine = {
  ensureWorkspaceArtifacts: ensureWorkspaceMemoryFiles,
  flushIssueMemory: flushWorkspaceMemory,
  recordIssueEvent: recordWorkspaceMemoryEvent,
  listContextDocuments: listWorkspaceMemoryContextDocuments,
};

export function getMemoryEngine(): MemoryEngine {
  return DEFAULT_MEMORY_ENGINE;
}
