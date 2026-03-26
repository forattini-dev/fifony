import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildContextPack } from "../src/agents/context-engine.ts";
import type { GradingReport, IssueEntry } from "../src/types.ts";

const tempDirs: string[] = [];
const previousEmbeddingStrategy = process.env.FIFONY_EMBEDDINGS_STRATEGY;

process.env.FIFONY_EMBEDDINGS_STRATEGY = "disabled";

after(() => {
  if (previousEmbeddingStrategy == null) {
    delete process.env.FIFONY_EMBEDDINGS_STRATEGY;
  } else {
    process.env.FIFONY_EMBEDDINGS_STRATEGY = previousEmbeddingStrategy;
  }
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createWorkspace(): { workspacePath: string; worktreePath: string } {
  const workspacePath = mkdtempSync(join(tmpdir(), "fifony-context-"));
  const worktreePath = join(workspacePath, "worktree");
  mkdirSync(worktreePath, { recursive: true });
  tempDirs.push(workspacePath);
  return { workspacePath, worktreePath };
}

function writeFile(root: string, relativePath: string, contents: string): void {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, "utf8");
}

function makeIssue(overrides: Partial<IssueEntry> = {}): IssueEntry {
  return {
    id: "issue-1",
    identifier: "FF-1",
    title: "Improve feature context retrieval",
    description: "Make feature retrieval use the correct implementation and tests.",
    state: "Running",
    labels: [],
    blockedBy: [],
    assignedToWorker: false,
    createdAt: "2026-03-26T00:00:00.000Z",
    updatedAt: "2026-03-26T00:00:00.000Z",
    history: [],
    attempts: 1,
    maxAttempts: 3,
    planVersion: 1,
    executeAttempt: 1,
    reviewAttempt: 0,
    ...overrides,
  };
}

describe("buildContextPack", () => {
  it("prioritizes explicit paths and expands to sibling tests", async () => {
    const { workspacePath, worktreePath } = createWorkspace();
    writeFile(worktreePath, "README.md", "# Context");
    writeFile(worktreePath, "src/feature.ts", "export function featureWidget() { return 'feature'; }");
    writeFile(worktreePath, "src/feature.test.ts", "test('featureWidget', () => { /* feature */ });");
    writeFile(worktreePath, "src/other.ts", "export const note = 'feature fallback mention';");

    const issue = makeIssue({
      paths: ["src/feature.ts"],
      worktreePath,
      workspacePath,
    });

    const pack = await buildContextPack({
      role: "executor",
      title: issue.title,
      description: issue.description,
      issue,
      workspacePath,
    });

    assert.equal(pack.hits[0]?.path, "src/feature.ts");
    assert.equal(pack.hits[0]?.source, "explicit");
    assert.ok(
      pack.hits.some((hit) => hit.path === "src/feature.test.ts" && hit.kind === "test"),
      "expected sibling test coverage to appear in the context pack",
    );
  });

  it("includes failure and review memory from the current issue", async () => {
    const { workspacePath, worktreePath } = createWorkspace();
    writeFile(worktreePath, "README.md", "# Context");

    const gradingReport = {
      scope: "final",
      overallVerdict: "FAIL",
      blockingVerdict: "FAIL",
      criteria: [
        {
          id: "criterion-1",
          category: "correctness",
          description: "Preserve retry learning",
          verificationMethod: "review memory",
          evidenceExpected: "retry context references prior failure evidence",
          blocking: true,
          weight: 1,
          result: "FAIL",
          evidence: "Review found that retry memory was not used.",
        },
      ],
      reviewAttempt: 1,
    } as unknown as GradingReport;

    const issue = makeIssue({
      state: "Reviewing",
      worktreePath,
      workspacePath,
      previousAttemptSummaries: [
        {
          planVersion: 1,
          executeAttempt: 1,
          phase: "execute",
          error: "Vector context did not include previous failure context.",
          timestamp: "2026-03-26T00:00:00.000Z",
          insight: {
            errorType: "logic",
            rootCause: "Current issue memory was ignored.",
            filesInvolved: ["src/agents/context-engine.ts"],
            suggestion: "Inject failure memory for the current issue into retry context.",
          },
        },
      ],
      gradingReport,
    });

    const pack = await buildContextPack({
      role: "reviewer",
      title: issue.title,
      description: issue.description,
      issue,
      workspacePath,
    });

    assert.ok(
      pack.hits.some((hit) => hit.sourceId === "failure:issue-1:0" && hit.source === "memory"),
      "expected failure memory from the current issue",
    );
    assert.ok(
      pack.hits.some((hit) => hit.sourceId === "review:issue-1:criterion-1" && hit.source === "memory"),
      "expected review memory from the current issue",
    );
    assert.ok(pack.memoryHitCount >= 2);
  });

  it("caps planner packs at six hits", async () => {
    const { workspacePath, worktreePath } = createWorkspace();
    writeFile(worktreePath, "README.md", "# Feature planning");

    for (let index = 0; index < 10; index += 1) {
      writeFile(
        worktreePath,
        `src/feature-${index}.ts`,
        `export const feature${index} = 'planner feature context ${index}';`,
      );
    }

    const issue = makeIssue({
      worktreePath,
      workspacePath,
    });

    const pack = await buildContextPack({
      role: "planner",
      title: issue.title,
      description: issue.description,
      issue,
      workspacePath,
    });

    assert.equal(pack.hits.length, 6);
  });

  it("records layer-aware context assembly reports and seeds workspace memory files", async () => {
    const { workspacePath, worktreePath } = createWorkspace();
    writeFile(worktreePath, "README.md", "# Workspace memory");
    writeFile(worktreePath, "src/context.ts", "export const summary = 'workspace memory context';");

    const issue = makeIssue({
      worktreePath,
      workspacePath,
    });

    const pack = await buildContextPack({
      role: "executor",
      title: issue.title,
      description: issue.description,
      issue,
      workspacePath,
    });

    assert.ok(pack.report);
    assert.ok(pack.report?.memoryFlush);
    assert.deepEqual(
      pack.report?.layers.map((layer) => layer.name),
      ["bootstrap", "workspace-memory", "issue-memory", "retrieval"],
    );
    assert.ok((pack.report?.layers.find((layer) => layer.name === "bootstrap")?.hitCount ?? 0) >= 2);
    assert.ok((pack.report?.layers.find((layer) => layer.name === "workspace-memory")?.hitCount ?? 0) >= 1);
    assert.equal(existsSync(join(workspacePath, "WORKFLOW.md")), true);
    assert.equal(existsSync(join(workspacePath, "MEMORY.md")), true);
    assert.equal(existsSync(join(workspacePath, "HEARTBEAT.md")), true);
  });
});
