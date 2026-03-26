/**
 * Tests for src/agent/providers.ts — provider normalization, effort resolution,
 * command resolution and default command building.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAgentProvider,
  normalizeAgentRole,
  resolveEffort,
  resolveAgentCommand,
  resolveProviderCapabilities,
  getProviderCapabilityWarnings,
  getProviderDefaultCommand,
  getExecutionProviders,
  getReviewProvider,
  getSessionProvidersForIssue,
} from "../src/agents/providers.ts";
import type { EffortConfig, IssueEntry, RuntimeState, WorkflowConfig } from "../src/types.ts";

// ── normalizeAgentProvider() ──────────────────────────────────────────────────

describe("normalizeAgentProvider", () => {
  it("returns 'claude' for 'claude'", () => {
    assert.equal(normalizeAgentProvider("claude"), "claude");
  });

  it("returns 'codex' for 'codex'", () => {
    assert.equal(normalizeAgentProvider("codex"), "codex");
  });

  it("normalizes to lowercase", () => {
    assert.equal(normalizeAgentProvider("Claude"), "claude");
    assert.equal(normalizeAgentProvider("CODEX"), "codex");
  });

  it("returns 'codex' for empty string (default)", () => {
    assert.equal(normalizeAgentProvider(""), "codex");
  });

  it("trims whitespace before normalizing", () => {
    assert.equal(normalizeAgentProvider("  claude  "), "claude");
  });

  it("passes through unknown values as-is (lowercased)", () => {
    // Unknown providers are passed through to allow future providers
    assert.equal(normalizeAgentProvider("gemini"), "gemini");
  });
});

// ── normalizeAgentRole() ──────────────────────────────────────────────────────

describe("normalizeAgentRole", () => {
  it("returns 'planner' for 'planner'", () => {
    assert.equal(normalizeAgentRole("planner"), "planner");
  });

  it("returns 'executor' for 'executor'", () => {
    assert.equal(normalizeAgentRole("executor"), "executor");
  });

  it("returns 'reviewer' for 'reviewer'", () => {
    assert.equal(normalizeAgentRole("reviewer"), "reviewer");
  });

  it("normalizes to lowercase", () => {
    assert.equal(normalizeAgentRole("Executor"), "executor");
    assert.equal(normalizeAgentRole("PLANNER"), "planner");
  });

  it("returns 'executor' as default for empty string", () => {
    assert.equal(normalizeAgentRole(""), "executor");
  });

  it("returns 'executor' as default for unknown role", () => {
    assert.equal(normalizeAgentRole("unknown"), "executor");
  });

  it("trims whitespace before normalizing", () => {
    assert.equal(normalizeAgentRole("  reviewer  "), "reviewer");
  });
});

// ── resolveEffort() ───────────────────────────────────────────────────────────

describe("resolveEffort", () => {
  it("returns issue-level role-specific effort (highest priority)", () => {
    const issueEffort: EffortConfig = { executor: "high" };
    const globalEffort: EffortConfig = { executor: "low", default: "medium" };
    assert.equal(resolveEffort("executor", issueEffort, globalEffort), "high");
  });

  it("falls back to issue-level default when role not set", () => {
    const issueEffort: EffortConfig = { default: "medium" };
    const globalEffort: EffortConfig = { executor: "low" };
    assert.equal(resolveEffort("executor", issueEffort, globalEffort), "medium");
  });

  it("uses global role-specific effort when issue effort is not set", () => {
    const globalEffort: EffortConfig = { executor: "high" };
    assert.equal(resolveEffort("executor", undefined, globalEffort), "high");
  });

  it("falls back to global default", () => {
    const globalEffort: EffortConfig = { default: "low" };
    assert.equal(resolveEffort("executor", undefined, globalEffort), "low");
  });

  it("returns undefined when no effort configured anywhere", () => {
    assert.equal(resolveEffort("executor", undefined, undefined), undefined);
  });

  it("issue role takes priority over issue default", () => {
    const issueEffort: EffortConfig = { executor: "high", default: "low" };
    assert.equal(resolveEffort("executor", issueEffort, undefined), "high");
  });

  it("issue default takes priority over global role", () => {
    const issueEffort: EffortConfig = { default: "medium" };
    const globalEffort: EffortConfig = { executor: "high" };
    assert.equal(resolveEffort("executor", issueEffort, globalEffort), "medium");
  });

  it("works for planner role", () => {
    const issueEffort: EffortConfig = { planner: "high" };
    assert.equal(resolveEffort("planner", issueEffort, undefined), "high");
  });

  it("works for reviewer role", () => {
    const globalEffort: EffortConfig = { reviewer: "low" };
    assert.equal(resolveEffort("reviewer", undefined, globalEffort), "low");
  });

  it("returns undefined when empty EffortConfig objects provided", () => {
    assert.equal(resolveEffort("executor", {}, {}), undefined);
  });
});

// ── getProviderDefaultCommand() ───────────────────────────────────────────────
// (More exhaustive tests are in commands.test.ts; these verify integration-level behavior)

describe("getProviderDefaultCommand", () => {
  it("generates a valid codex command", () => {
    const cmd = getProviderDefaultCommand("codex");
    assert.ok(cmd.startsWith("codex exec"), "codex command");
    assert.ok(cmd.includes("--skip-git-repo-check"), "has skip flag");
  });

  it("generates a valid claude command", () => {
    const cmd = getProviderDefaultCommand("claude");
    assert.ok(cmd.startsWith("claude "), "claude command");
    assert.ok(cmd.includes("--print"), "has print flag");
    assert.ok(cmd.includes("--output-format json"), "has json output");
  });

  it("returns empty string for unknown provider", () => {
    assert.equal(getProviderDefaultCommand("gpt"), "");
  });

  it("codex command includes model when provided", () => {
    const cmd = getProviderDefaultCommand("codex", undefined, "o3-mini");
    assert.ok(cmd.includes("--model o3-mini"), "has model");
  });

  it("codex command includes reasoning effort when provided", () => {
    const cmd = getProviderDefaultCommand("codex", "high");
    assert.ok(cmd.includes(`reasoning_effort="high"`), "has effort");
  });

  it("claude command includes model when provided", () => {
    const cmd = getProviderDefaultCommand("claude", undefined, "claude-opus-4-6");
    assert.ok(cmd.includes("--model claude-opus-4-6"), "has model");
  });

  it("claude command does NOT include --reasoning-effort (unsupported)", () => {
    const cmd = getProviderDefaultCommand("claude", "high");
    assert.ok(!cmd.includes("reasoning_effort="), "no effort flag for claude");
  });

  it("claude command includes --json-schema (for result parsing)", () => {
    const cmd = getProviderDefaultCommand("claude");
    assert.ok(cmd.includes("--json-schema"), "has json schema");
  });

  it("codex command with both model and effort", () => {
    const cmd = getProviderDefaultCommand("codex", "medium", "o4-mini");
    assert.ok(cmd.includes("--model o4-mini"), "has model");
    assert.ok(cmd.includes(`reasoning_effort="medium"`), "has effort");
  });
});

describe("provider capability routing", () => {
  it("declares native schema + native subagents for claude", () => {
    const capabilities = resolveProviderCapabilities("claude");
    assert.equal(capabilities.structuredOutput.mode, "json-schema");
    assert.equal(capabilities.readOnlyExecution, "plan");
    assert.equal(capabilities.nativeSubagents, "native");
  });

  it("declares fallback structured output for codex", () => {
    const capabilities = resolveProviderCapabilities("codex");
    assert.equal(capabilities.structuredOutput.mode, "prompt-contract");
    assert.equal(capabilities.imageInput, "cli-flag");
    assert.equal(capabilities.nativeSubagents, "runtime-only");
  });

  it("surfaces capability warnings for providers that rely on harness fallbacks", () => {
    const warnings = getProviderCapabilityWarnings("codex");
    assert.ok(warnings.some((warning) => warning.includes("read-only execution")));
    assert.ok(warnings.some((warning) => warning.includes("JSON schema")));
    assert.ok(warnings.some((warning) => warning.includes("native subagents")));
  });
});

// ── resolveAgentCommand() ─────────────────────────────────────────────────────

describe("resolveAgentCommand", () => {
  const claudeDefault = getProviderDefaultCommand("claude");
  const codexDefault = getProviderDefaultCommand("codex");

  it("explicit command wins over all others", () => {
    const cmd = resolveAgentCommand("codex", "my explicit cmd", codexDefault, claudeDefault);
    assert.equal(cmd, "my explicit cmd");
  });

  it("trims whitespace from explicit command", () => {
    const cmd = resolveAgentCommand("codex", "  explicit  ", codexDefault, claudeDefault);
    assert.equal(cmd, "explicit");
  });

  it("uses claudeCommand for claude provider when explicit is empty", () => {
    const custom = "claude --print --custom";
    const cmd = resolveAgentCommand("claude", "", codexDefault, custom);
    assert.equal(cmd, custom);
  });

  it("uses codexCommand for codex provider when explicit is empty", () => {
    const custom = "codex exec --custom";
    const cmd = resolveAgentCommand("codex", "", custom, claudeDefault);
    assert.equal(cmd, custom);
  });

  it("falls back to provider default for codex when both commands are empty", () => {
    const cmd = resolveAgentCommand("codex", "", "", "");
    assert.ok(cmd.startsWith("codex exec"), "codex default");
  });

  it("falls back to provider default for claude when both commands are empty", () => {
    const cmd = resolveAgentCommand("claude", "", "", "");
    assert.ok(cmd.startsWith("claude "), "claude default");
  });

  it("reasoningEffort propagates through codex fallback", () => {
    const cmd = resolveAgentCommand("codex", "", "", "", "high");
    assert.ok(cmd.includes(`reasoning_effort="high"`), "effort in fallback");
  });

  it("claudeCommand not used for codex provider", () => {
    const custom = "claude --my-custom-flag";
    const cmd = resolveAgentCommand("codex", "", "", custom);
    assert.ok(!cmd.includes("--my-custom-flag"), "claude cmd not used for codex");
  });

  it("codexCommand not used for claude provider", () => {
    const custom = "codex exec --my-custom-flag";
    const cmd = resolveAgentCommand("claude", "", custom, "");
    assert.ok(!cmd.includes("--my-custom-flag"), "codex cmd not used for claude");
  });

  it("all four providers resolve to distinct commands", () => {
    const codexCmd = resolveAgentCommand("codex", "", "", "");
    const claudeCmd = resolveAgentCommand("claude", "", "", "");
    assert.notEqual(codexCmd, claudeCmd, "different providers produce different commands");
  });
});

function makeState(overrides: Partial<RuntimeState["config"]> = {}): RuntimeState {
  return {
    trackerKind: "cli",
    runtimeTag: "test",
    updatedAt: "2026-03-26T00:00:00.000Z",
    issues: [],
    metrics: {
      total: 0,
      planning: 0,
      pendingApproval: 0,
      queued: 0,
      running: 0,
      reviewing: 0,
      pendingDecision: 0,
      blocked: 0,
      done: 0,
      merged: 0,
      cancelled: 0,
      activeWorkers: 0,
      avgCompletionMs: 0,
      medianCompletionMs: 0,
      fastestCompletionMs: 0,
      slowestCompletionMs: 0,
    },
    notes: [],
    config: {
      pollIntervalMs: 1000,
      workerConcurrency: 1,
      maxConcurrentByState: {},
      commandTimeoutMs: 60_000,
      maxAttemptsDefault: 3,
      maxTurns: 8,
      retryDelayMs: 1000,
      staleInProgressTimeoutMs: 300_000,
      logLinesTail: 100,
      maxPreviousOutputChars: 4000,
      agentProvider: "codex",
      agentCommand: "",
      defaultEffort: { default: "medium" },
      runMode: "filesystem",
      autoReviewApproval: true,
      afterCreateHook: "",
      beforeRunHook: "",
      afterRunHook: "",
      beforeRemoveHook: "",
      dockerExecution: false,
      dockerImage: "",
      ...overrides,
    },
  };
}

function makeIssue(overrides: Partial<IssueEntry> = {}): IssueEntry {
  return {
    id: "provider-1",
    identifier: "#P-1",
    title: "Provider fixture",
    description: "Provider fixture",
    state: "Queued",
    labels: [],
    blockedBy: [],
    assignedToWorker: true,
    createdAt: "2026-03-26T00:00:00.000Z",
    updatedAt: "2026-03-26T00:00:00.000Z",
    history: [],
    attempts: 0,
    maxAttempts: 3,
    planVersion: 1,
    executeAttempt: 1,
    reviewAttempt: 0,
    ...overrides,
  };
}

describe("stage-specific providers", () => {
  const workflow: WorkflowConfig = {
    plan: { provider: "claude", model: "claude-opus-4-6", effort: "high" },
    execute: { provider: "codex", model: "gpt-5.4", effort: "medium" },
    review: { provider: "gemini", model: "gemini-2.5-pro", effort: "low" },
  };

  it("returns executor-only providers for the execution pipeline", () => {
    const providers = getExecutionProviders(makeState(), makeIssue(), workflow);
    assert.equal(providers.length, 1);
    assert.equal(providers[0]?.role, "executor");
    assert.equal(providers[0]?.provider, "codex");
    assert.equal(providers[0]?.model, "gpt-5.4");
    assert.equal(providers[0]?.reasoningEffort, "medium");
    assert.equal(providers[0]?.capabilities?.structuredOutput.mode, "prompt-contract");
  });

  it("returns a real reviewer provider from the review workflow stage", () => {
    const reviewer = getReviewProvider(
      makeState({ adaptiveReviewRouting: false }),
      makeIssue({ state: "Reviewing" }),
      workflow,
    );
    assert.equal(reviewer.role, "reviewer");
    assert.equal(reviewer.provider, "gemini");
    assert.equal(reviewer.model, "gemini-2.5-pro");
  });

  it("can override the static review route when adaptive routing has stronger history", () => {
    const historicalIssue = makeIssue({
      id: "provider-history-1",
      identifier: "#P-H1",
      state: "Merged",
      title: "Fix queue lifecycle",
      labels: ["workflow", "fsm"],
      plan: {
        summary: "Workflow fixture",
        estimatedComplexity: "high",
        harnessMode: "contractual",
        steps: [{ step: 1, action: "Fix lifecycle" }],
        acceptanceCriteria: [
          {
            id: "AC-1",
            description: "Lifecycle remains coherent",
            category: "integration",
            verificationMethod: "code_inspection",
            evidenceExpected: "Transitions are safe",
            blocking: true,
            weight: 3,
          },
        ],
        executionContract: {
          summary: "Workflow fixture",
          deliverables: [],
          requiredChecks: [],
          requiredEvidence: [],
          focusAreas: ["src/persistence/plugins/fsm-agent.ts"],
          checkpointPolicy: "checkpointed",
        },
        suggestedPaths: ["src/persistence/plugins/fsm-agent.ts"],
        suggestedSkills: [],
        suggestedAgents: [],
        suggestedEffort: { reviewer: "high" },
        provider: "claude",
        createdAt: "2026-03-26T00:00:00.000Z",
      },
      reviewRuns: [
        {
          id: "review.final.v1a1",
          scope: "final",
          planVersion: 1,
          attempt: 1,
          cycle: 1,
          status: "completed",
          reviewProfile: {
            primary: "workflow-fsm",
            secondary: [],
            rationale: [],
            focusAreas: [],
            failureModes: [],
            evidencePriorities: [],
            severityBias: "",
          },
          routing: {
            provider: "codex",
            model: "gpt-5.4",
            reasoningEffort: "high",
            overlays: ["workflow-audit"],
          },
          promptFile: "/tmp/review-prompt.md",
          startedAt: "2026-03-26T00:00:00.000Z",
          completedAt: "2026-03-26T00:01:00.000Z",
          sessionSuccess: true,
          continueRequested: false,
          blocked: false,
          exitCode: 0,
          turns: 2,
          overallVerdict: "PASS",
          blockingVerdict: "PASS",
          criteriaCount: 1,
          failedCriteriaCount: 0,
          blockingFailedCriteriaCount: 0,
          advisoryFailedCriteriaCount: 0,
        },
      ],
    });

    const state = makeState({ adaptiveReviewRouting: true, adaptivePolicyMinSamples: 1, agentProvider: "claude" });
    state.issues = [historicalIssue];

    const reviewer = getReviewProvider(
      state,
      makeIssue({
        state: "Reviewing",
        title: "Fix queue lifecycle",
        labels: ["workflow", "fsm"],
        plan: historicalIssue.plan,
      }),
      workflow,
    );

    assert.equal(reviewer.role, "reviewer");
    assert.match(reviewer.selectionReason || "", /adaptive reviewer route/i);
  });

  it("specializes ui-heavy reviewers with overlays and elevated effort", () => {
    const reviewer = getReviewProvider(
      makeState(),
      makeIssue({
        state: "Reviewing",
        labels: ["frontend", "ux"],
        title: "Polish onboarding drawer",
        plan: {
          summary: "UI fixture",
          estimatedComplexity: "medium",
          harnessMode: "standard",
          steps: [{ step: 1, action: "Polish drawer" }],
          acceptanceCriteria: [
            {
              id: "AC-1",
              description: "Drawer feels polished",
              category: "design",
              verificationMethod: "ui_walkthrough",
              evidenceExpected: "Responsive and clear interactions",
              blocking: true,
              weight: 3,
            },
          ],
          executionContract: {
            summary: "UI fixture",
            deliverables: [],
            requiredChecks: [],
            requiredEvidence: [],
            focusAreas: ["app/src/components/OnboardingDrawer.tsx"],
            checkpointPolicy: "final_only",
          },
          suggestedPaths: ["app/src/components/OnboardingDrawer.tsx"],
          suggestedSkills: [],
          suggestedAgents: [],
          suggestedEffort: { reviewer: "medium" },
          provider: "claude",
          createdAt: "2026-03-26T00:00:00.000Z",
        },
      }),
      workflow,
    );

    assert.equal(reviewer.reasoningEffort, "high");
    assert.ok(reviewer.overlays?.includes("impeccable"));
    assert.ok(reviewer.overlays?.includes("frontend-design"));
    assert.match(reviewer.selectionReason || "", /ui-polish/i);
  });

  it("specializes security reviewers with extra-high effort", () => {
    const reviewer = getReviewProvider(
      makeState(),
      makeIssue({
        state: "Reviewing",
        labels: ["security"],
        title: "Harden permission checks",
        plan: {
          summary: "Security fixture",
          estimatedComplexity: "high",
          harnessMode: "contractual",
          steps: [{ step: 1, action: "Harden auth" }],
          acceptanceCriteria: [
            {
              id: "AC-1",
              description: "Unauthorized request is rejected",
              category: "security",
              verificationMethod: "api_probe",
              evidenceExpected: "Observed 401",
              blocking: true,
              weight: 3,
            },
          ],
          executionContract: {
            summary: "Security fixture",
            deliverables: [],
            requiredChecks: [],
            requiredEvidence: [],
            focusAreas: ["src/routes/auth.ts"],
            checkpointPolicy: "checkpointed",
          },
          suggestedPaths: ["src/routes/auth.ts"],
          suggestedSkills: [],
          suggestedAgents: [],
          suggestedEffort: { reviewer: "low" },
          provider: "claude",
          createdAt: "2026-03-26T00:00:00.000Z",
        },
      }),
      workflow,
    );

    assert.equal(reviewer.reasoningEffort, "extra-high");
    assert.ok(reviewer.overlays?.includes("security-hardening"));
  });

  it("returns session providers for both execution and review", () => {
    const providers = getSessionProvidersForIssue(makeState({ adaptiveReviewRouting: false }), makeIssue(), workflow);
    assert.deepEqual(
      providers.map((provider) => provider.role),
      ["executor", "reviewer"],
    );
  });
});
