/**
 * CLI flow tests — verifies that all agent operations correctly
 * parse and track tools, skills, agents, and commands from CLI output.
 *
 * Covers: enhance, planning, replanning, execute, re-execute, review,
 * merge conflict resolution, and usage tracking across providers.
 *
 * Uses fixture-based CLI output (no real subprocess calls).
 *
 * Run with: pnpm test tests/cli-flow-tracking.test.ts
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readAgentDirective, extractTokenUsage, addTokenUsage } from "../src/agents/directive-parser.ts";
import { parsePlanOutput } from "../src/agents/planning/planning-parser.ts";
import { parseEnhancerOutput } from "../src/agents/planning/issue-enhancer.ts";
import { extractFailureInsights } from "../src/agents/failure-analyzer.ts";
import { compileExecution, compileReview } from "../src/agents/adapters/index.ts";
import { getPlanCommand, buildPlanPrompt, buildRefinePrompt } from "../src/agents/planning/planning-prompts.ts";
import { buildImagePromptSection } from "../src/agents/adapters/shared.ts";
import { buildCodexCommand } from "../src/agents/adapters/codex.ts";
import type {
  IssueEntry,
  IssuePlan,
  AgentProviderDefinition,
  RuntimeConfig,
} from "../src/types.ts";

// ── Shared fixtures ────────────────────────────────────────────────────────

const PROVIDERS = ["claude", "codex", "gemini"] as const;

const BASE_CONFIG: RuntimeConfig = {
  pollIntervalMs: 5000,
  workerConcurrency: 1,
  maxConcurrentByState: {},
  commandTimeoutMs: 60_000,
  maxAttemptsDefault: 3,
  maxTurns: 10,
  retryDelayMs: 1000,
  staleInProgressTimeoutMs: 300_000,
  logLinesTail: 100,
  maxPreviousOutputChars: 4000,
  agentProvider: "claude",
  agentCommand: "",
  defaultEffort: { default: "medium" },
  runMode: "filesystem",
  autoReviewApproval: true,
  afterCreateHook: "",
  beforeRunHook: "",
  afterRunHook: "",
  beforeRemoveHook: "",
};

function makeIssue(overrides: Partial<IssueEntry> = {}): IssueEntry {
  return {
    id: "flow-test-001",
    identifier: "#1",
    title: "Add dark mode toggle",
    description: "Implement a dark mode toggle in the settings page",
    state: "Planning",
    labels: ["feature"],
    paths: [],
    blockedBy: [],
    assignedToWorker: true,
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    history: [],
    attempts: 0,
    maxAttempts: 3,
    planVersion: 1,
    executeAttempt: 0,
    reviewAttempt: 0,
    ...overrides,
  } as IssueEntry;
}

function makePlan(overrides: Partial<IssuePlan> = {}): IssuePlan {
  return {
    summary: "Add dark mode toggle to settings",
    estimatedComplexity: "medium",
    steps: [
      { step: 1, action: "Create ThemeToggle component", files: ["src/components/ThemeToggle.tsx"] },
      { step: 2, action: "Add theme context provider", files: ["src/context/ThemeContext.tsx"] },
      { step: 3, action: "Update settings page", files: ["src/pages/Settings.tsx"] },
    ],
    successCriteria: ["Dark mode toggle works", "Theme persists across sessions"],
    validation: ["pnpm typecheck", "pnpm test"],
    suggestedPaths: ["src/components/ThemeToggle.tsx", "src/context/ThemeContext.tsx"],
    suggestedSkills: ["audit", "normalize"],
    suggestedAgents: ["code-reviewer"],
    suggestedEffort: { executor: "medium", reviewer: "low" },
    provider: "claude",
    createdAt: "2026-03-24T00:00:00.000Z",
    ...overrides,
  } as IssuePlan;
}

function makeProvider(provider: string, role: string): AgentProviderDefinition {
  return {
    provider,
    role: role as any,
    command: "",
    model: `${provider}-test-model`,
    profile: "",
    profilePath: "",
    profileInstructions: "",
  } as AgentProviderDefinition;
}

// ── CLI output fixtures with usage tracking ────────────────────────────────

/** Claude --output-format json with structured_output including usage tracking */
function claudeExecutionOutput(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    result: JSON.stringify({
      status: "done",
      summary: "Added dark mode toggle component",
      nextPrompt: "",
      tools_used: ["Read", "Write", "Edit", "Bash", "Grep"],
      skills_used: ["/commit"],
      agents_used: ["code-reviewer"],
      commands_run: ["pnpm typecheck", "pnpm test", "git add -A"],
      ...overrides,
    }),
    modelUsage: {
      "claude-sonnet-4-6": {
        inputTokens: 15000,
        outputTokens: 3200,
        cacheReadInputTokens: 800,
        cacheCreationInputTokens: 200,
      },
    },
    cost_usd: 0.042,
  });
}

/** Codex output with result contract JSON embedded in text */
function codexExecutionOutput(overrides: Record<string, unknown> = {}): string {
  const result = {
    status: "done",
    summary: "Implemented dark mode toggle",
    root_cause: [],
    changes_made: ["src/components/ThemeToggle.tsx", "src/context/ThemeContext.tsx"],
    validation: { commands_run: ["npm test"], result: "pass" },
    open_questions: [],
    followups: [],
    nextPrompt: "",
    tools_used: ["Read", "Write", "Bash"],
    skills_used: [],
    agents_used: [],
    commands_run: ["npm test", "npm run build"],
    ...overrides,
  };
  return `
Reading prompt from stdin...
OpenAI Codex v0.116.0
--------
workdir: /tmp/test
model: gpt-5.4
--------
user
... prompt text ...

codex
\`\`\`json
${JSON.stringify(result, null, 2)}
\`\`\`

tokens used
42,150
`;
}

/** Gemini --output-format json with response field */
function geminiExecutionOutput(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    response: JSON.stringify({
      status: "done",
      summary: "Dark mode toggle implemented",
      root_cause: [],
      changes_made: ["src/ThemeToggle.tsx"],
      validation: { commands_run: ["pnpm test"], result: "pass" },
      open_questions: [],
      followups: [],
      nextPrompt: "",
      tools_used: ["Read", "Edit", "Bash", "Glob"],
      skills_used: ["/normalize"],
      agents_used: ["build-error-resolver"],
      commands_run: ["pnpm test", "pnpm typecheck"],
      ...overrides,
    }),
    stats: {
      models: {
        "gemini-2.5-pro": {
          tokens: { input: 8000, candidates: 2400, cached: 500, thoughts: 100 },
        },
      },
    },
  });
}

/** Claude review output with skills/agents tracking */
function claudeReviewOutput(approved: boolean): string {
  return JSON.stringify({
    type: "result",
    result: JSON.stringify({
      status: "done",
      summary: approved ? "Code looks good, approved" : "Found issues, needs rework",
      nextPrompt: approved ? "" : "Fix the accessibility issues",
      tools_used: ["Read", "Grep", "Glob"],
      skills_used: ["/audit"],
      agents_used: [],
      commands_run: ["pnpm test"],
    }),
    modelUsage: {
      "claude-sonnet-4-6": { inputTokens: 12000, outputTokens: 1800 },
    },
  });
}

/** Claude plan output with suggestion tracking */
function claudePlanOutput(): string {
  return JSON.stringify({
    type: "result",
    structured_output: {
      summary: "Implement dark mode toggle",
      estimatedComplexity: "medium",
      steps: [
        { step: 1, action: "Create ThemeToggle component", files: ["src/ThemeToggle.tsx"], doneWhen: "Component renders" },
        { step: 2, action: "Add theme context", files: ["src/ThemeContext.tsx"], doneWhen: "Context provides theme" },
        { step: 3, action: "Wire settings page", files: ["src/Settings.tsx"], doneWhen: "Toggle works" },
      ],
      suggestedPaths: ["src/ThemeToggle.tsx", "src/ThemeContext.tsx", "src/Settings.tsx"],
      suggestedSkills: ["audit", "normalize", "polish"],
      suggestedAgents: ["code-reviewer", "build-error-resolver"],
      suggestedEffort: { default: "medium", executor: "medium", reviewer: "low" },
      assumptions: ["Tailwind CSS is available"],
      constraints: ["No breaking changes to existing themes"],
      successCriteria: ["Toggle switches between light and dark mode"],
    },
    modelUsage: {
      "claude-sonnet-4-6": { inputTokens: 5000, outputTokens: 1200 },
    },
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. DIRECTIVE PARSER — tools/skills/agents extraction per provider
// ══════════════════════════════════════════════════════════════════════════════

describe("directive parser: usage tracking extraction", () => {
  const ws = mkdtempSync(join(tmpdir(), "fifony-flow-"));

  it("claude: extracts tools_used, skills_used, agents_used, commands_run", () => {
    const directive = readAgentDirective(ws, claudeExecutionOutput(), true);
    assert.equal(directive.status, "done");
    assert.deepEqual(directive.toolsUsed, ["Read", "Write", "Edit", "Bash", "Grep"]);
    assert.deepEqual(directive.skillsUsed, ["/commit"]);
    assert.deepEqual(directive.agentsUsed, ["code-reviewer"]);
    assert.deepEqual(directive.commandsRun, ["pnpm typecheck", "pnpm test", "git add -A"]);
  });

  it("codex: extracts usage from JSON code block in text output", () => {
    const directive = readAgentDirective(ws, codexExecutionOutput(), true);
    assert.equal(directive.status, "done");
    assert.deepEqual(directive.toolsUsed, ["Read", "Write", "Bash"]);
    assert.deepEqual(directive.skillsUsed, undefined); // empty array → undefined
    assert.deepEqual(directive.agentsUsed, undefined);
    assert.deepEqual(directive.commandsRun, ["npm test", "npm run build"]);
  });

  it("gemini: extracts usage from response JSON envelope", () => {
    const directive = readAgentDirective(ws, geminiExecutionOutput(), true);
    assert.equal(directive.status, "done");
    assert.deepEqual(directive.toolsUsed, ["Read", "Edit", "Bash", "Glob"]);
    assert.deepEqual(directive.skillsUsed, ["/normalize"]);
    assert.deepEqual(directive.agentsUsed, ["build-error-resolver"]);
    assert.deepEqual(directive.commandsRun, ["pnpm test", "pnpm typecheck"]);
  });

  it("review: extracts usage from review output", () => {
    const directive = readAgentDirective(ws, claudeReviewOutput(true), true);
    assert.equal(directive.status, "done");
    assert.deepEqual(directive.toolsUsed, ["Read", "Grep", "Glob"]);
    assert.deepEqual(directive.skillsUsed, ["/audit"]);
  });

  it("handles missing usage fields gracefully", () => {
    const output = JSON.stringify({
      type: "result",
      result: JSON.stringify({ status: "done", summary: "No tracking" }),
      modelUsage: { "claude-sonnet-4-6": { inputTokens: 100, outputTokens: 50 } },
    });
    const directive = readAgentDirective(ws, output, true);
    assert.equal(directive.status, "done");
    assert.equal(directive.toolsUsed, undefined);
    assert.equal(directive.skillsUsed, undefined);
    assert.equal(directive.agentsUsed, undefined);
    assert.equal(directive.commandsRun, undefined);
  });

  it("accepts snake_case and camelCase field names", () => {
    const output = JSON.stringify({
      type: "result",
      result: JSON.stringify({
        status: "done",
        summary: "test",
        toolsUsed: ["Bash"],
        skillsUsed: ["/commit"],
        agentsUsed: ["reviewer"],
        commandsRun: ["git status"],
      }),
      modelUsage: { "claude-sonnet-4-6": { inputTokens: 100, outputTokens: 50 } },
    });
    const directive = readAgentDirective(ws, output, true);
    assert.deepEqual(directive.toolsUsed, ["Bash"]);
    assert.deepEqual(directive.skillsUsed, ["/commit"]);
    assert.deepEqual(directive.agentsUsed, ["reviewer"]);
    assert.deepEqual(directive.commandsRun, ["git status"]);
  });

  after(() => { try { rmSync(ws, { recursive: true, force: true }); } catch {} });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. ISSUE ACCUMULATION — usage tracking across multiple turns
// ══════════════════════════════════════════════════════════════════════════════

describe("issue accumulation: tools/skills/agents across turns", () => {
  it("accumulates unique tools across execution + review turns", () => {
    const issue = makeIssue();

    // Simulate turn 1: execution
    const execDirective = readAgentDirective("/tmp", claudeExecutionOutput(), true);
    if (execDirective.toolsUsed?.length) issue.toolsUsed = [...new Set([...(issue.toolsUsed ?? []), ...execDirective.toolsUsed])];
    if (execDirective.skillsUsed?.length) issue.skillsUsed = [...new Set([...(issue.skillsUsed ?? []), ...execDirective.skillsUsed])];
    if (execDirective.agentsUsed?.length) issue.agentsUsed = [...new Set([...(issue.agentsUsed ?? []), ...execDirective.agentsUsed])];
    if (execDirective.commandsRun?.length) issue.commandsRun = [...new Set([...(issue.commandsRun ?? []), ...execDirective.commandsRun])];

    // Simulate turn 2: review
    const reviewDirective = readAgentDirective("/tmp", claudeReviewOutput(true), true);
    if (reviewDirective.toolsUsed?.length) issue.toolsUsed = [...new Set([...(issue.toolsUsed ?? []), ...reviewDirective.toolsUsed])];
    if (reviewDirective.skillsUsed?.length) issue.skillsUsed = [...new Set([...(issue.skillsUsed ?? []), ...reviewDirective.skillsUsed])];
    if (reviewDirective.agentsUsed?.length) issue.agentsUsed = [...new Set([...(issue.agentsUsed ?? []), ...reviewDirective.agentsUsed])];

    // Verify accumulation (deduped)
    assert.deepEqual(issue.toolsUsed, ["Read", "Write", "Edit", "Bash", "Grep", "Glob"]);
    assert.deepEqual(issue.skillsUsed, ["/commit", "/audit"]);
    assert.deepEqual(issue.agentsUsed, ["code-reviewer"]);
    assert.deepEqual(issue.commandsRun, ["pnpm typecheck", "pnpm test", "git add -A"]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. PLAN PARSING — suggestedSkills/suggestedAgents extraction
// ══════════════════════════════════════════════════════════════════════════════

describe("planning: skill/agent suggestions in plan output", () => {
  it("claude: extracts suggestedSkills and suggestedAgents from structured_output", () => {
    const plan = parsePlanOutput(claudePlanOutput());
    assert.ok(plan, "plan should parse");
    assert.deepEqual(plan!.suggestedSkills, ["audit", "normalize", "polish"]);
    assert.deepEqual(plan!.suggestedAgents, ["code-reviewer", "build-error-resolver"]);
  });

  it("codex: extracts suggestions from JSON code block in text", () => {
    const codexPlan = `
Reading prompt from stdin...
codex
\`\`\`json
{
  "summary": "Add dark mode",
  "estimatedComplexity": "low",
  "steps": [{"step": 1, "action": "Create toggle", "files": ["src/Toggle.tsx"]}],
  "suggestedSkills": ["harden", "audit"],
  "suggestedAgents": ["frontend-developer"],
  "suggestedPaths": ["src/Toggle.tsx"]
}
\`\`\`
`;
    const plan = parsePlanOutput(codexPlan);
    assert.ok(plan, "plan should parse");
    assert.deepEqual(plan!.suggestedSkills, ["harden", "audit"]);
    assert.deepEqual(plan!.suggestedAgents, ["frontend-developer"]);
  });

  it("plan with no suggestions has empty arrays", () => {
    const output = JSON.stringify({
      type: "result",
      structured_output: {
        summary: "Simple fix",
        estimatedComplexity: "trivial",
        steps: [{ step: 1, action: "Fix typo", files: ["README.md"] }],
      },
    });
    const plan = parsePlanOutput(output);
    assert.ok(plan, "plan should parse");
    assert.deepEqual(plan!.suggestedSkills, []);
    assert.deepEqual(plan!.suggestedAgents, []);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. ENHANCE — output parsing with codex echo noise
// ══════════════════════════════════════════════════════════════════════════════

describe("enhance: parsing from noisy CLI output", () => {
  it("extracts value from codex output that echoes prompt + responds", () => {
    const output = `
Reading prompt from stdin...
codex
\`\`\`json
{ "field": "description", "value": "<REPLACE_WITH_ACTUAL_DESCRIPTION>" }
\`\`\`

mcp startup: no servers

codex
\`\`\`json
{ "field": "description", "value": "## Current State\\n- Only dogs shown\\n\\n## Desired State\\n- Support cats, hamsters, birds" }
\`\`\`
`;
    const value = parseEnhancerOutput(output, "description");
    assert.ok(value.includes("Current State"), "should extract real description");
    assert.ok(!value.includes("REPLACE_WITH"), "should not extract placeholder");
  });

  it("extracts value from claude JSON envelope", () => {
    const output = JSON.stringify({
      type: "result",
      structured_output: {
        field: "title",
        value: "feat: add multi-species adoption support",
      },
    });
    const value = parseEnhancerOutput(output, "title");
    assert.equal(value, "feat: add multi-species adoption support");
  });

  it("rejects placeholder values and falls back", () => {
    const output = `\`\`\`json
{ "field": "title", "value": "your improved title here" }
\`\`\``;
    // Placeholder is rejected by parseCandidate, fallback kicks in
    const value = parseEnhancerOutput(output, "title");
    // The fallback returns the cleaned raw text — either the JSON string or empty
    assert.ok(value.length > 0, "should return something (fallback)");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. EXECUTION COMPILATION — skills/agents injected into prompt
// ══════════════════════════════════════════════════════════════════════════════

describe("execution compilation: skills and agents in prompt", () => {
  const ws = mkdtempSync(join(tmpdir(), "fifony-compile-"));
  mkdirSync(join(ws, "worktree"), { recursive: true });

  for (const provider of PROVIDERS) {
    it(`${provider}: prompt includes suggestedSkills from plan`, async () => {
      const plan = makePlan({ suggestedSkills: ["audit", "normalize", "polish"] });
      const issue = makeIssue({ state: "Running", plan, workspacePath: ws, worktreePath: join(ws, "worktree") } as any);
      const providerDef = makeProvider(provider, "executor");
      const compiled = await compileExecution(issue, providerDef, BASE_CONFIG, ws, "", "");
      assert.ok(compiled, `${provider}: compilation should succeed`);
      assert.ok(compiled!.prompt.includes("audit"), `${provider}: prompt should mention audit skill`);
      assert.ok(compiled!.prompt.includes("normalize"), `${provider}: prompt should mention normalize skill`);
    });

    it(`${provider}: prompt includes suggestedAgents from plan`, async () => {
      const plan = makePlan({ suggestedAgents: ["code-reviewer", "build-error-resolver"] });
      const issue = makeIssue({ state: "Running", plan, workspacePath: ws, worktreePath: join(ws, "worktree") } as any);
      const providerDef = makeProvider(provider, "executor");
      const compiled = await compileExecution(issue, providerDef, BASE_CONFIG, ws, "", "");
      assert.ok(compiled, `${provider}: compilation should succeed`);
      assert.ok(compiled!.prompt.includes("code-reviewer"), `${provider}: prompt should mention code-reviewer agent`);
    });
  }

  after(() => { try { rmSync(ws, { recursive: true, force: true }); } catch {} });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. REPLAN — learning from previous plan feedback
// ══════════════════════════════════════════════════════════════════════════════

describe("replan: refine prompt includes current plan and feedback", () => {
  it("refine prompt contains original plan steps and feedback", async () => {
    const plan = makePlan();
    const prompt = await buildRefinePrompt(
      "Add dark mode toggle",
      "Implement dark mode in settings",
      plan,
      "The plan missed accessibility requirements. Add ARIA labels.",
    );
    assert.ok(prompt.includes("Create ThemeToggle component"), "includes original steps");
    assert.ok(prompt.includes("accessibility"), "includes feedback");
    assert.ok(prompt.includes("ARIA"), "includes specific feedback");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. RE-EXECUTE — retry context with failure insights
// ══════════════════════════════════════════════════════════════════════════════

describe("re-execute: retry context injects failure learning", () => {
  it("failure insights extracted from TypeScript error output", () => {
    const output = `
src/ThemeToggle.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'boolean'.
src/ThemeContext.tsx(8,10): error TS2307: Cannot find module './useTheme'.
`;
    const insights = extractFailureInsights(output);
    assert.ok(insights, "should extract insights");
    assert.ok(insights!.errorType === "typescript" || insights!.category === "typescript", "should detect TypeScript error");
  });

  it("failure insights extracted from test failure output", () => {
    const output = `
FAIL src/ThemeToggle.test.tsx
  ● ThemeToggle › should toggle dark mode
    expect(received).toBe(expected)
    Expected: true
    Received: false
`;
    const insights = extractFailureInsights(output);
    assert.ok(insights, "should extract test failure insights");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. REVIEW — output parsing and skill detection
// ══════════════════════════════════════════════════════════════════════════════

describe("review: directive parsing with usage tracking", () => {
  it("approved review has correct status and tracked tools", () => {
    const directive = readAgentDirective("/tmp", claudeReviewOutput(true), true);
    assert.equal(directive.status, "done");
    assert.ok(directive.summary?.includes("approved"), "summary indicates approval");
    assert.deepEqual(directive.toolsUsed, ["Read", "Grep", "Glob"]);
    assert.deepEqual(directive.skillsUsed, ["/audit"]);
  });

  it("rework review has failure context and tracked tools", () => {
    const directive = readAgentDirective("/tmp", claudeReviewOutput(false), true);
    assert.equal(directive.status, "done");
    assert.ok(directive.summary?.includes("rework"), "summary indicates rework needed");
    assert.ok(directive.nextPrompt?.includes("accessibility"), "nextPrompt has fix guidance");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. TOKEN TRACKING — per-provider extraction
// ══════════════════════════════════════════════════════════════════════════════

describe("token tracking: extraction per provider", () => {
  it("claude: extracts from modelUsage with cache tokens", () => {
    const output = claudeExecutionOutput();
    const json = JSON.parse(output);
    const usage = extractTokenUsage(output, json);
    assert.ok(usage, "should extract usage");
    assert.equal(usage!.inputTokens, 15000 + 800 + 200); // input + cacheRead + cacheCreation
    assert.equal(usage!.outputTokens, 3200);
    assert.equal(usage!.model, "claude-sonnet-4-6");
  });

  it("codex: extracts from 'tokens used' text pattern", () => {
    const output = codexExecutionOutput();
    const usage = extractTokenUsage(output, null);
    assert.ok(usage, "should extract usage");
    assert.equal(usage!.totalTokens, 42150);
  });

  it("gemini: extracts from stats.models breakdown", () => {
    const output = geminiExecutionOutput();
    const json = JSON.parse(output);
    const usage = extractTokenUsage(output, json);
    assert.ok(usage, "should extract usage");
    assert.equal(usage!.inputTokens, 8000 + 500); // input + cached
    assert.equal(usage!.outputTokens, 2400); // candidates
    assert.equal(usage!.model, "gemini-2.5-pro");
  });

  it("accumulates tokens on issue across multiple turns", () => {
    const issue = makeIssue();

    // Turn 1: execution
    addTokenUsage(issue, { inputTokens: 15000, outputTokens: 3200, totalTokens: 18200, model: "claude-sonnet-4-6" }, "executor");
    assert.equal(issue.tokenUsage?.totalTokens, 18200);

    // Turn 2: review
    addTokenUsage(issue, { inputTokens: 12000, outputTokens: 1800, totalTokens: 13800, model: "claude-sonnet-4-6" }, "reviewer");
    assert.equal(issue.tokenUsage?.totalTokens, 32000);
    assert.equal(issue.tokensByPhase?.executor?.totalTokens, 18200);
    assert.equal(issue.tokensByPhase?.reviewer?.totalTokens, 13800);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. RESULT CONTRACT — all providers include usage fields
// ══════════════════════════════════════════════════════════════════════════════

describe("result contract: usage fields in all provider contracts", () => {
  const ws = mkdtempSync(join(tmpdir(), "fifony-contract-"));
  mkdirSync(join(ws, "worktree"), { recursive: true });

  it("codex result contract includes tools_used, skills_used, agents_used, commands_run", async () => {
    const plan = makePlan();
    const issue = makeIssue({ state: "Running", plan, workspacePath: ws, worktreePath: join(ws, "worktree") } as any);
    const providerDef = makeProvider("codex", "executor");
    const compiled = await compileExecution(issue, providerDef, BASE_CONFIG, ws, "", "");
    assert.ok(compiled, "codex compilation should succeed");
    assert.ok(compiled!.prompt.includes("tools_used"), "codex prompt includes tools_used");
    assert.ok(compiled!.prompt.includes("skills_used"), "codex prompt includes skills_used");
    assert.ok(compiled!.prompt.includes("agents_used"), "codex prompt includes agents_used");
    assert.ok(compiled!.prompt.includes("commands_run"), "codex prompt includes commands_run");
  });

  it("gemini result contract includes usage tracking fields", async () => {
    const plan = makePlan();
    const issue = makeIssue({ state: "Running", plan, workspacePath: ws, worktreePath: join(ws, "worktree") } as any);
    const providerDef = makeProvider("gemini", "executor");
    const compiled = await compileExecution(issue, providerDef, BASE_CONFIG, ws, "", "");
    assert.ok(compiled, "gemini compilation should succeed");
    assert.ok(compiled!.prompt.includes("tools_used"), "gemini prompt includes tools_used");
    assert.ok(compiled!.prompt.includes("skills_used"), "gemini prompt includes skills_used");
    assert.ok(compiled!.prompt.includes("agents_used"), "gemini prompt includes agents_used");
  });

  after(() => { try { rmSync(ws, { recursive: true, force: true }); } catch {} });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. FULL FLOW SIMULATION — plan → execute → review with tracking
// ══════════════════════════════════════════════════════════════════════════════

describe("full flow simulation: plan → execute → review with usage tracking", () => {
  it("issue accumulates all usage data through the full lifecycle", () => {
    const issue = makeIssue();

    // Phase 1: Plan
    const planOutput = claudePlanOutput();
    const plan = parsePlanOutput(planOutput);
    assert.ok(plan, "plan should parse");
    issue.plan = plan!;
    issue.state = "PendingApproval" as any;
    assert.deepEqual(plan!.suggestedSkills, ["audit", "normalize", "polish"]);
    assert.deepEqual(plan!.suggestedAgents, ["code-reviewer", "build-error-resolver"]);

    // Phase 2: Execution
    issue.state = "Running" as any;
    const execDirective = readAgentDirective("/tmp", claudeExecutionOutput(), true);
    addTokenUsage(issue, execDirective.tokenUsage, "executor");
    if (execDirective.toolsUsed?.length) issue.toolsUsed = [...new Set([...(issue.toolsUsed ?? []), ...execDirective.toolsUsed])];
    if (execDirective.skillsUsed?.length) issue.skillsUsed = [...new Set([...(issue.skillsUsed ?? []), ...execDirective.skillsUsed])];
    if (execDirective.agentsUsed?.length) issue.agentsUsed = [...new Set([...(issue.agentsUsed ?? []), ...execDirective.agentsUsed])];
    if (execDirective.commandsRun?.length) issue.commandsRun = [...new Set([...(issue.commandsRun ?? []), ...execDirective.commandsRun])];

    // Phase 3: Review
    issue.state = "Reviewing" as any;
    const reviewDirective = readAgentDirective("/tmp", claudeReviewOutput(true), true);
    addTokenUsage(issue, reviewDirective.tokenUsage, "reviewer");
    if (reviewDirective.toolsUsed?.length) issue.toolsUsed = [...new Set([...(issue.toolsUsed ?? []), ...reviewDirective.toolsUsed])];
    if (reviewDirective.skillsUsed?.length) issue.skillsUsed = [...new Set([...(issue.skillsUsed ?? []), ...reviewDirective.skillsUsed])];

    // Verify full lifecycle tracking
    assert.ok(issue.tokenUsage!.totalTokens > 0, "tokens tracked");
    assert.ok(issue.tokensByPhase?.executor, "executor tokens tracked");
    assert.ok(issue.tokensByPhase?.reviewer, "reviewer tokens tracked");

    // Tools accumulated from both execution and review
    assert.deepEqual(issue.toolsUsed, ["Read", "Write", "Edit", "Bash", "Grep", "Glob"]);
    assert.deepEqual(issue.skillsUsed, ["/commit", "/audit"]);
    assert.deepEqual(issue.agentsUsed, ["code-reviewer"]);
    assert.deepEqual(issue.commandsRun, ["pnpm typecheck", "pnpm test", "git add -A"]);

    // Plan suggestions are separate from actual usage
    assert.deepEqual(plan!.suggestedSkills, ["audit", "normalize", "polish"]);
    assert.deepEqual(plan!.suggestedAgents, ["code-reviewer", "build-error-resolver"]);

    // Cross-reference: "audit" was suggested AND used (/audit skill)
    // "normalize" and "polish" were suggested but NOT used
    // "code-reviewer" was suggested AND used
    // "build-error-resolver" was suggested but NOT used
    const suggestedAndUsedSkills = plan!.suggestedSkills!.filter((s) =>
      issue.skillsUsed?.some((used) => used.includes(s)),
    );
    assert.ok(suggestedAndUsedSkills.includes("audit"), "audit was suggested and used");
    assert.ok(!suggestedAndUsedSkills.includes("polish"), "polish was suggested but not used");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. IMAGE HANDLING — images flow correctly to each provider
// ══════════════════════════════════════════════════════════════════════════════

describe("image handling: images passed correctly to each provider", () => {
  const imgDir = mkdtempSync(join(tmpdir(), "fifony-img-test-"));
  // Create real image files for testing
  const pngData = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64");
  const screenshot1 = join(imgDir, "screenshot1.png");
  const screenshot2 = join(imgDir, "bug-evidence.jpg");
  writeFileSync(screenshot1, pngData);
  writeFileSync(screenshot2, Buffer.from("fake-jpeg"));

  // ── Image embedding (claude/gemini) ─────────────────────────────────────

  it("buildImagePromptSection embeds real images as base64 in markdown", () => {
    const section = buildImagePromptSection([screenshot1, screenshot2]);
    assert.ok(section.includes("## Attached Images"), "has header");
    assert.ok(section.includes("screenshot1.png"), "has first filename");
    assert.ok(section.includes("bug-evidence.jpg"), "has second filename");
    assert.ok(section.includes("data:image/png;base64,"), "PNG as base64");
    assert.ok(section.includes("data:image/jpeg;base64,"), "JPEG as base64");
  });

  it("buildImagePromptSection filters out non-existent files", () => {
    const section = buildImagePromptSection(["/nonexistent/ghost.png", screenshot1]);
    assert.ok(section.includes("screenshot1.png"), "includes existing file");
    assert.ok(!section.includes("ghost.png"), "skips missing file");
  });

  it("buildImagePromptSection returns empty for all missing files", () => {
    const section = buildImagePromptSection(["/nope/a.png", "/nope/b.jpg"]);
    assert.equal(section, "", "returns empty for all missing");
  });

  // ── Codex: uses --image CLI flags ───────────────────────────────────────

  it("codex: --image flag added for each image path", () => {
    const cmd = buildCodexCommand({ imagePaths: [screenshot1, screenshot2] });
    assert.ok(cmd.includes(`--image "${screenshot1}"`), "has first image flag");
    assert.ok(cmd.includes(`--image "${screenshot2}"`), "has second image flag");
  });

  it("codex: --image flags placed before stdin redirect", () => {
    const cmd = buildCodexCommand({ imagePaths: [screenshot1] });
    const imagePos = cmd.indexOf("--image");
    const redirectPos = cmd.indexOf('< "$FIFONY_PROMPT_FILE"');
    assert.ok(imagePos < redirectPos, "--image comes before stdin redirect");
  });

  it("codex: no --image when no images", () => {
    const cmd = buildCodexCommand({});
    assert.ok(!cmd.includes("--image"), "no image flag");
  });

  // ── Planning: images in plan prompt ─────────────────────────────────────

  it("plan prompt includes image paths as visual evidence", async () => {
    const prompt = await buildPlanPrompt("Fix layout bug", "The header overflows", false, [screenshot1]);
    assert.ok(prompt.includes("Visual evidence"), "has visual evidence section");
    assert.ok(prompt.includes(screenshot1), "includes image path");
  });

  it("plan prompt omits image section when no images", async () => {
    const prompt = await buildPlanPrompt("Fix layout bug", "The header overflows", false);
    assert.ok(!prompt.includes("Visual evidence"), "no image section");
  });

  it("plan command: codex passes --image, claude/gemini do not", () => {
    const images = [screenshot1];
    const claudeCmd = getPlanCommand("claude", undefined, images);
    const codexCmd = getPlanCommand("codex", undefined, images);
    const geminiCmd = getPlanCommand("gemini", undefined, images);

    assert.ok(!claudeCmd.includes("--image"), "claude: no --image (prompt embedding)");
    assert.ok(codexCmd.includes("--image"), "codex: has --image flag");
    assert.ok(!geminiCmd.includes("--image"), "gemini: no --image (prompt embedding)");
  });

  // ── Execution: images reach the compiled prompt ─────────────────────────

  it("claude execution: images embedded as base64 in prompt", async () => {
    const ws = mkdtempSync(join(tmpdir(), "fifony-img-exec-"));
    mkdirSync(join(ws, "worktree"), { recursive: true });
    const plan = makePlan();
    const issue = makeIssue({
      state: "Running",
      plan,
      images: [screenshot1],
      workspacePath: ws,
      worktreePath: join(ws, "worktree"),
    } as any);
    const providerDef = makeProvider("claude", "executor");
    const compiled = await compileExecution(issue, providerDef, BASE_CONFIG, ws, "", "");
    assert.ok(compiled, "compilation should succeed");
    assert.ok(compiled!.prompt.includes("data:image/png;base64,"), "prompt has base64 image");
    assert.ok(compiled!.prompt.includes("screenshot1.png"), "prompt has filename");
    rmSync(ws, { recursive: true, force: true });
  });

  it("codex execution: images passed as --image flags in command", async () => {
    const ws = mkdtempSync(join(tmpdir(), "fifony-img-exec-"));
    mkdirSync(join(ws, "worktree"), { recursive: true });
    const plan = makePlan();
    const issue = makeIssue({
      state: "Running",
      plan,
      images: [screenshot1, screenshot2],
      workspacePath: ws,
      worktreePath: join(ws, "worktree"),
    } as any);
    const providerDef = makeProvider("codex", "executor");
    const compiled = await compileExecution(issue, providerDef, BASE_CONFIG, ws, "", "");
    assert.ok(compiled, "compilation should succeed");
    assert.ok(compiled!.command.includes(`--image "${screenshot1}"`), "command has first image");
    assert.ok(compiled!.command.includes(`--image "${screenshot2}"`), "command has second image");
    rmSync(ws, { recursive: true, force: true });
  });

  it("gemini execution: images embedded as base64 in prompt", async () => {
    const ws = mkdtempSync(join(tmpdir(), "fifony-img-exec-"));
    mkdirSync(join(ws, "worktree"), { recursive: true });
    const plan = makePlan();
    const issue = makeIssue({
      state: "Running",
      plan,
      images: [screenshot1],
      workspacePath: ws,
      worktreePath: join(ws, "worktree"),
    } as any);
    const providerDef = makeProvider("gemini", "executor");
    const compiled = await compileExecution(issue, providerDef, BASE_CONFIG, ws, "", "");
    assert.ok(compiled, "compilation should succeed");
    assert.ok(compiled!.prompt.includes("data:image/png;base64,"), "prompt has base64 image");
    rmSync(ws, { recursive: true, force: true });
  });

  it("execution with non-existent images: silently skipped", async () => {
    const ws = mkdtempSync(join(tmpdir(), "fifony-img-exec-"));
    mkdirSync(join(ws, "worktree"), { recursive: true });
    const plan = makePlan();
    const issue = makeIssue({
      state: "Running",
      plan,
      images: ["/nonexistent/ghost.png"],
      workspacePath: ws,
      worktreePath: join(ws, "worktree"),
    } as any);
    const providerDef = makeProvider("claude", "executor");
    const compiled = await compileExecution(issue, providerDef, BASE_CONFIG, ws, "", "");
    assert.ok(compiled, "compilation should succeed even with bad images");
    assert.ok(!compiled!.prompt.includes("ghost.png"), "missing image not in prompt");
    rmSync(ws, { recursive: true, force: true });
  });

  after(() => { try { rmSync(imgDir, { recursive: true, force: true }); } catch {} });
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. CLAUDE DUPLICATED OUTPUT — tokens/cost extraction from duplicated JSON
// ══════════════════════════════════════════════════════════════════════════════

describe("claude output: duplicated JSON result parsing", () => {
  const ws = mkdtempSync(join(tmpdir(), "fifony-dup-"));

  // Real-world scenario: claude without --bare outputs the result JSON twice
  const singleResult = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 196568,
    num_turns: 29,
    result: "",
    total_cost_usd: 0.95,
    structured_output: {
      status: "done",
      summary: "Replaced SVG placeholders with real photos",
      tools_used: ["Read", "Write", "Edit", "Bash"],
      skills_used: [],
      agents_used: [],
      commands_run: ["pnpm test"],
    },
    modelUsage: {
      "claude-opus-4-6": {
        inputTokens: 21,
        outputTokens: 4793,
        cacheReadInputTokens: 1019193,
        cacheCreationInputTokens: 31863,
        costUSD: 0.83,
      },
      "claude-haiku-4-5-20251001": {
        inputTokens: 203,
        outputTokens: 5041,
        cacheReadInputTokens: 370008,
        cacheCreationInputTokens: 47611,
        costUSD: 0.12,
      },
    },
    usage: {
      input_tokens: 21,
      cache_creation_input_tokens: 31863,
      cache_read_input_tokens: 1019193,
      output_tokens: 4793,
    },
  });

  it("parses single JSON output correctly", () => {
    const directive = readAgentDirective(ws, singleResult, true);
    assert.equal(directive.status, "done");
    assert.ok(directive.tokenUsage, "should extract token usage");
    assert.ok(directive.tokenUsage!.totalTokens > 0, "total tokens > 0");
    assert.equal(directive.tokenUsage!.model, "claude-opus-4-6");
    assert.ok(directive.tokenUsage!.costUsd! > 0, "cost > 0");
  });

  it("parses duplicated JSON output (claude without --bare artifact)", () => {
    // Claude sometimes outputs the JSON twice
    const duplicated = singleResult + "\n\n" + singleResult;
    const directive = readAgentDirective(ws, duplicated, true);
    assert.equal(directive.status, "done", "should parse status from first JSON");
    assert.ok(directive.tokenUsage, "should extract token usage from duplicated output");
    assert.ok(directive.tokenUsage!.totalTokens > 0, "total tokens > 0");
    assert.equal(directive.tokenUsage!.model, "claude-opus-4-6");
  });

  it("parses JSON with leading whitespace/newlines", () => {
    const withWhitespace = "\n\n  " + singleResult + "\n";
    const directive = readAgentDirective(ws, withWhitespace, true);
    assert.equal(directive.status, "done");
    assert.ok(directive.tokenUsage, "should handle leading whitespace");
  });

  it("extracts tools_used from structured_output in duplicated JSON", () => {
    const duplicated = singleResult + "\n" + singleResult;
    const directive = readAgentDirective(ws, duplicated, true);
    assert.deepEqual(directive.toolsUsed, ["Read", "Write", "Edit", "Bash"]);
    assert.deepEqual(directive.commandsRun, ["pnpm test"]);
  });

  it("extracts cost_usd from claude envelope", () => {
    const directive = readAgentDirective(ws, singleResult, true);
    assert.ok(directive.tokenUsage?.costUsd, "should extract costUsd");
    assert.equal(directive.tokenUsage!.costUsd, 0.95);
  });

  it("extracts multi-model token breakdown (opus + haiku)", () => {
    const json = JSON.parse(singleResult);
    const usage = extractTokenUsage(singleResult, json);
    assert.ok(usage, "should extract usage");
    // Total = opus(21 + 1019193 + 31863) + haiku(203 + 370008 + 47611) input
    //       + opus(4793) + haiku(5041) output
    const expectedInput = (21 + 1019193 + 31863) + (203 + 370008 + 47611);
    const expectedOutput = 4793 + 5041;
    assert.equal(usage!.inputTokens, expectedInput, "input tokens include cache");
    assert.equal(usage!.outputTokens, expectedOutput, "output tokens from both models");
    assert.equal(usage!.totalTokens, expectedInput + expectedOutput);
  });

  after(() => { try { rmSync(ws, { recursive: true, force: true }); } catch {} });
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. DIFF STATS — parseDiffStats extracts lines/files correctly
// ══════════════════════════════════════════════════════════════════════════════

describe("diff stats: lines added/removed/files changed extraction", () => {
  it("parses standard git diff --stat output", async () => {
    const { parseDiffStats } = await import("../src/domains/workspace.ts");
    const issue = { id: "test-diff", identifier: "#D1" } as any;
    const stat = `
 src/components/Hero.tsx  | 15 +++++++--------
 src/styles.css           |  8 +++++---
 tests/hero.test.ts       | 22 ++++++++++++++++++++++
 3 files changed, 29 insertions(+), 11 deletions(-)
`;
    parseDiffStats(issue, stat);
    assert.equal(issue.filesChanged, 3, "3 files changed");
    assert.equal(issue.linesAdded, 29, "29 lines added");
    assert.equal(issue.linesRemoved, 11, "11 lines removed");
  });

  it("handles single file changes", async () => {
    const { parseDiffStats } = await import("../src/domains/workspace.ts");
    const issue = { id: "test-diff-single", identifier: "#D2" } as any;
    const stat = `
 README.md | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
`;
    parseDiffStats(issue, stat);
    assert.equal(issue.filesChanged, 1);
    assert.equal(issue.linesAdded, 1);
    assert.equal(issue.linesRemoved, 1);
  });

  it("handles additions only", async () => {
    const { parseDiffStats } = await import("../src/domains/workspace.ts");
    const issue = { id: "test-diff-add", identifier: "#D3" } as any;
    const stat = `
 src/new-file.ts | 50 ++++++++++++++++++++++++++++++++++++++++++++++++++
 1 file changed, 50 insertions(+)
`;
    parseDiffStats(issue, stat);
    assert.equal(issue.linesAdded, 50);
    assert.equal(issue.linesRemoved, 0);
  });

  it("handles deletions only", async () => {
    const { parseDiffStats } = await import("../src/domains/workspace.ts");
    const issue = { id: "test-diff-del", identifier: "#D4" } as any;
    const stat = `
 src/dead-code.ts | 100 ---...
 1 file changed, 100 deletions(-)
`;
    parseDiffStats(issue, stat);
    assert.equal(issue.linesAdded, 0);
    assert.equal(issue.linesRemoved, 100);
  });
});
