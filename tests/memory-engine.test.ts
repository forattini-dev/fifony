import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { IssueEntry, WorkspaceMemoryEntry } from "../src/types.ts";
import {
  ensureWorkspaceMemoryFiles,
  flushWorkspaceMemory,
  listWorkspaceMemoryContextDocuments,
  recordWorkspaceMemoryEvent,
} from "../src/agents/memory-engine.ts";

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeIssue(overrides: Partial<IssueEntry> = {}): IssueEntry {
  const createdAt = "2026-03-26T00:00:00.000Z";
  return {
    id: "issue-memory-1",
    identifier: "#MEM-1",
    title: "Persist workspace memory",
    description: "Create durable workspace memory files for an issue workspace.",
    state: "Running",
    labels: [],
    blockedBy: [],
    assignedToWorker: true,
    createdAt,
    updatedAt: createdAt,
    history: [],
    attempts: 1,
    maxAttempts: 3,
    planVersion: 2,
    executeAttempt: 1,
    reviewAttempt: 2,
    reviewFailureHistory: [
      {
        id: "review.final.v2a1:AC-1",
        runId: "review.final.v2a1",
        scope: "final",
        planVersion: 2,
        attempt: 1,
        criterionId: "AC-1",
        description: "Execution contract evidence is preserved",
        category: "correctness",
        verificationMethod: "review memory",
        blocking: true,
        weight: 3,
        evidence: "First attempt lost the blocking reviewer evidence.",
        recordedAt: "2026-03-26T09:00:00.000Z",
        reviewProfile: "workflow-fsm",
        routing: { provider: "codex", overlays: [] },
      },
      {
        id: "review.final.v2a2:AC-1",
        runId: "review.final.v2a2",
        scope: "final",
        planVersion: 2,
        attempt: 2,
        criterionId: "AC-1",
        description: "Execution contract evidence is preserved",
        category: "correctness",
        verificationMethod: "review memory",
        blocking: true,
        weight: 3,
        evidence: "Second attempt still ignored the prior reviewer evidence.",
        recordedAt: "2026-03-26T09:05:00.000Z",
        reviewProfile: "workflow-fsm",
        routing: { provider: "codex", overlays: [] },
      },
    ],
    policyDecisions: [
      {
        id: "policy-1",
        kind: "checkpoint-policy",
        scope: "planning",
        planVersion: 2,
        basis: "historical",
        from: "final_only",
        to: "checkpointed",
        rationale: "Repeated correctness failures justify an intermediate checkpoint gate.",
        recordedAt: "2026-03-26T09:10:00.000Z",
        profile: "workflow-fsm",
      },
    ],
    plan: {
      summary: "Strengthen workspace memory and diagnostics",
      estimatedComplexity: "high",
      harnessMode: "contractual",
      steps: [],
      acceptanceCriteria: [
        {
          id: "AC-1",
          description: "Reviewer evidence survives retries",
          category: "correctness",
          verificationMethod: "review memory",
          evidenceExpected: "Daily memory reflects prior failures",
          blocking: true,
          weight: 3,
        },
      ],
      executionContract: {
        summary: "Persist durable memory and use it in context assembly.",
        deliverables: ["workspace memory files"],
        requiredChecks: ["pnpm typecheck"],
        requiredEvidence: ["WORKFLOW.md and MEMORY.md exist"],
        focusAreas: ["src/agents/memory-engine.ts"],
        checkpointPolicy: "checkpointed",
      },
      suggestedPaths: ["src/agents/memory-engine.ts"],
      suggestedSkills: [],
      suggestedAgents: [],
      suggestedEffort: {},
      provider: "codex",
      createdAt,
    },
    ...overrides,
  };
}

describe("memory engine", () => {
  it("creates workspace artifacts and promotes durable learnings on flush", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "fifony-memory-"));
    tempDirs.push(workspacePath);
    const issue = makeIssue({ workspacePath });

    const paths = ensureWorkspaceMemoryFiles(issue, workspacePath);
    assert.ok(existsSync(paths.workflowFile));
    assert.ok(existsSync(paths.memoryFile));
    assert.ok(existsSync(paths.heartbeatFile));
    assert.ok(existsSync(paths.dailyFile));

    const report = flushWorkspaceMemory(issue, workspacePath, "test");
    assert.ok(report);
    assert.equal(report?.reason, "test");
    assert.ok((issue.memoryFlushCount ?? 0) >= 1);
    assert.ok(issue.memoryFlushAt);

    const durableMemory = readFileSync(paths.memoryFile, "utf8");
    assert.match(durableMemory, /Recurring blocking failure: AC-1/);
    assert.match(durableMemory, /Policy decision: checkpoint-policy/);
    assert.match(durableMemory, /Second attempt still ignored the prior reviewer evidence/);
  });

  it("records daily issue events and exposes memory docs as context sources", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "fifony-memory-"));
    tempDirs.push(workspacePath);
    const issue = makeIssue({ workspacePath });

    const entry: WorkspaceMemoryEntry = {
      id: "review-pass-1",
      kind: "review-pass",
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      title: "Reviewer cleared the blocking gate",
      summary: "The final review passed after memory-aware fixes.",
      source: "review",
      createdAt: "2026-03-26T09:20:00.000Z",
      planVersion: 2,
      reviewAttempt: 2,
      reviewScope: "final",
      persistLongTerm: true,
      tags: ["review", "pass"],
    };

    const wrote = recordWorkspaceMemoryEvent(issue, workspacePath, entry);
    assert.equal(wrote, true);

    const docs = listWorkspaceMemoryContextDocuments(workspacePath);
    assert.ok(docs.some((doc) => doc.path === "WORKFLOW.md" && doc.layer === "bootstrap"));
    assert.ok(docs.some((doc) => doc.path === "HEARTBEAT.md" && doc.layer === "bootstrap"));
    assert.ok(docs.some((doc) => doc.path === "MEMORY.md" && doc.layer === "workspace-memory"));
    assert.ok(docs.some((doc) => doc.path.startsWith("memory/") && doc.layer === "workspace-memory"));
  });
});
