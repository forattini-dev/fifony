import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveConfig } from "../src/domains/config.ts";
import {
  buildProbeResult,
  collectRuntimeHealthSnapshot,
  runDoctorChecks,
} from "../src/domains/runtime-diagnostics.ts";
import type { IssueEntry, RuntimeState } from "../src/types.ts";

function makeIssue(overrides: Partial<IssueEntry> = {}): IssueEntry {
  const createdAt = "2026-03-26T00:00:00.000Z";
  return {
    id: "issue-runtime-1",
    identifier: "#RT-1",
    title: "Diagnostic sample",
    description: "Exercise runtime diagnostics.",
    state: "Running",
    labels: [],
    blockedBy: [],
    assignedToWorker: true,
    createdAt,
    updatedAt: createdAt,
    history: [],
    attempts: 1,
    maxAttempts: 3,
    planVersion: 1,
    executeAttempt: 1,
    reviewAttempt: 0,
    memoryFlushCount: 0,
    ...overrides,
  };
}

function makeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    startedAt: "2026-03-26T00:00:00.000Z",
    updatedAt: "2026-03-26T00:00:00.000Z",
    trackerKind: "filesystem",
    sourceRepoUrl: "/tmp/project",
    sourceRef: "workspace",
    projectName: "Fifony",
    detectedProjectName: "Fifony",
    projectNameSource: "detected",
    queueTitle: "Fifony",
    config: {
      ...deriveConfig([]),
      agentProvider: "codex",
      agentCommand: "codex",
    },
    milestones: [],
    issues: [makeIssue({ memoryFlushCount: 2 }), makeIssue({ id: "issue-runtime-2", identifier: "#RT-2", state: "Reviewing", memoryFlushCount: 1 })],
    events: [],
    metrics: {
      total: 2,
      planning: 0,
      queued: 0,
      inProgress: 2,
      blocked: 0,
      done: 0,
      merged: 0,
      cancelled: 0,
      activeWorkers: 1,
    },
    notes: [],
    ...overrides,
  };
}

describe("runtime diagnostics", () => {
  it("builds a healthy runtime snapshot from injected runtime dependencies", () => {
    const state = makeState();
    const snapshot = collectRuntimeHealthSnapshot(state, {
      workspaceStatus: {
        isGit: true,
        hasCommits: true,
        branch: "main",
        isClean: false,
        untrackedCount: 2,
      },
      providers: [
        { name: "codex", available: true, path: "/usr/bin/codex" },
      ],
      serviceStatuses: [
        {
          id: "web",
          name: "Web",
          command: "npm run dev",
          state: "running",
          running: true,
          pid: 1234,
          startedAt: "2026-03-26T00:00:00.000Z",
          uptime: 30,
          logSize: 10,
          crashCount: 0,
        },
      ],
      agentStatuses: [
        { issueId: "issue-runtime-1", state: "running", running: true },
        { issueId: "issue-runtime-2", state: "idle", running: false },
      ],
    });

    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.services.running, 1);
    assert.equal(snapshot.agents.active, 1);
    assert.equal(snapshot.memory.totalFlushes, 3);
    assert.equal(snapshot.providers.configuredCapabilities.structuredOutput.mode, "prompt-contract");
    assert.ok(snapshot.providers.capabilityWarnings.some((warning) => warning.includes("JSON schema")));
  });

  it("marks probe degraded and doctor failed when workspace or provider are unhealthy", () => {
    const state = makeState({
      issues: [makeIssue({ state: "Blocked", memoryFlushCount: 0 })],
    });

    const doctor = runDoctorChecks(state, {
      workspaceStatus: {
        isGit: false,
        hasCommits: false,
        branch: null,
      },
      providers: [
        { name: "codex", available: false, path: "" },
      ],
      serviceStatuses: [],
      agentStatuses: [
        { issueId: "issue-runtime-1", state: "failed", running: false },
      ],
    });
    const probe = buildProbeResult(state, {
      workspaceStatus: {
        isGit: false,
        hasCommits: false,
        branch: null,
      },
      providers: [
        { name: "codex", available: false, path: "" },
      ],
      serviceStatuses: [],
      agentStatuses: [
        { issueId: "issue-runtime-1", state: "failed", running: false },
      ],
    });

    assert.equal(probe.ok, false);
    assert.ok(doctor.some((check) => check.id === "workspace-git" && check.status === "fail"));
    assert.ok(doctor.some((check) => check.id === "provider-runtime" && check.status === "fail"));
    assert.ok(doctor.some((check) => check.id === "provider-capabilities" && check.status === "warn"));
    assert.ok(doctor.some((check) => check.id === "memory-pipeline" && check.status === "warn"));
  });
});
