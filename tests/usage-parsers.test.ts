import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseClaudeUsageFromStatus,
  parseCodexUsageFromStatus,
  parseGeminiUsageFromStatus,
} from "../src/agents/adapters/usage.ts";

// ── Fixtures ────────────────────────────────────────────────────────────────
// Simulated stripped PTY output based on real CLI sessions.
// The strip function removes ANSI/CSI escapes and non-ASCII (box-drawing, progress bars, etc).

const CLAUDE_USAGE_FIXTURE = [
  "Claude Code v2.1.81",
  "Opus 4.6 (1M context) with high effort Claude Max",
  "~/Work/FF/fifony",
  "bypass permissions on (shift+tab to cycle)",
  "high /effort",
  "/usage",
  "Status Config Usage",
  "Loading usage data",
  "Current session",
  "5% used",
  "Resets 4pm (America/Sao_Paulo)",
  "Current week (all models)",
  "9% used",
  "Resets Mar 27, 3am (America/Sao_Paulo)",
  "Current week (Sonnet only)",
  "12% used",
  "Resets Mar 23, 4pm (America/Sao_Paulo)",
  "Esc to cancel",
].join("\n");

const CLAUDE_USAGE_MINIMAL = [
  "Claude Code v2.2.0",
  "Sonnet 4.6 with medium effort Claude Pro",
  "Current session",
  "1% used",
  "Resets 3pm",
  "Current week (all models)",
  "45% used",
  "Resets Monday 00:00",
  "Esc to cancel",
].join("\n");

const CODEX_STATUS_FIXTURE = [
  ">_ OpenAI Codex (v0.116.0)",
  "model: gpt-5.3-codex-spark high /model to change",
  "directory: ~/Work/FF/fifony",
  "Model: gpt-5.3-codex-spark (reasoning high, summaries auto)",
  "Directory: ~/Work/FF/fifony",
  "Permissions: Full Access",
  "Account: filipeforattini1@gmail.com (Pro)",
  "Collaboration mode: Default",
  "Session: 019d166c-9673-7bf1-ab2d-440735b26709",
  "5h limit: [] 100% left (resets 18:41)",
  "Weekly limit: [] 84% left (resets 15:50 on 25 Mar)",
  "GPT-5.3-Codex-Spark limit:",
  "5h limit: [] 46% left (resets 14:17)",
  "Weekly limit: [] 29% left (resets 22:58 on 25 Mar)",
].join("\n");

const CODEX_STATUS_BAR_ONLY = [
  ">_ OpenAI Codex (v0.116.0)",
  "model: gpt-5.4 high /model to change",
  "directory: ~/Work/FF/fifony",
  "Tip: Use /skills to list available skills. 5h 100% /status gpt-5.4 high 75% left ~/Work/FF/fifony gpt-5.4 2% used 5h 85%",
].join("\n");

const GEMINI_STATS_FIXTURE = [
  "Gemini CLI v0.34.0",
  "Signed in with Google: filipeforattini1@gmail.com /auth",
  "Plan: Gemini Code Assist in Google One AI Pro /upgrade",
  "Session Stats",
  "Interaction Summary",
  "Session ID: 6646e700-8de0-4a27-aa73-82a5ba3b3f26",
  "Auth Method: Signed in with Google (filipeforattini1@gmail.com)",
  "Tier: Gemini Code Assist in Google One AI Pro",
  "Tool Calls: 0 ( 0 x 0 )",
  "Performance",
  "Wall Time: 50.8s",
  "Model Reqs Model usage Usage resets",
  "gemini-2.5-flash - 13% 11:51 AM (22h 8m)",
  "gemini-2.5-flash-lite - 9% 11:51 AM (22h 8m)",
  "gemini-2.5-pro - 2% 12:01 PM (22h 18m)",
  "gemini-3-flash-preview - 13% 11:51 AM (22h 8m)",
  "gemini-3.1-pro-preview - 2% 12:01 PM (22h 18m)",
].join("\n");

const GEMINI_STATS_MINIMAL = [
  "Gemini CLI v0.35.0",
  "Plan: Gemini Code Assist Free /upgrade",
  "Session Stats",
  "gemini-2.5-flash - 50% 3:00 PM",
].join("\n");

// ── Claude ────────────────────────────────────────────────────────────────

describe("parseClaudeUsageFromStatus", () => {
  it("extracts version from banner", () => {
    const s = parseClaudeUsageFromStatus(CLAUDE_USAGE_FIXTURE);
    assert.equal(s.version, "2.1.81");
  });

  it("extracts plan from banner", () => {
    const s = parseClaudeUsageFromStatus(CLAUDE_USAGE_FIXTURE);
    assert.equal(s.plan, "Claude Max");
  });

  it("extracts effort from banner", () => {
    const s = parseClaudeUsageFromStatus(CLAUDE_USAGE_FIXTURE);
    assert.equal(s.effort, "high");
  });

  it("extracts currentModel from banner", () => {
    const s = parseClaudeUsageFromStatus(CLAUDE_USAGE_FIXTURE);
    assert.equal(s.currentModel, "claude-opus-4-6");
  });

  it("extracts session percent used", () => {
    const s = parseClaudeUsageFromStatus(CLAUDE_USAGE_FIXTURE);
    assert.equal(s.sessionPercentUsed, 5);
  });

  it("extracts weekly percent used (all models)", () => {
    const s = parseClaudeUsageFromStatus(CLAUDE_USAGE_FIXTURE);
    assert.equal(s.weeklyPercentUsed, 9);
  });

  it("builds rate limit entries for session, global-weekly, and per-model-weekly", () => {
    const s = parseClaudeUsageFromStatus(CLAUDE_USAGE_FIXTURE);
    assert.equal(s.rateLimits.length, 3);

    const session = s.rateLimits.find((r) => r.scope === "session");
    assert.ok(session, "should have a session rate limit");
    assert.equal(session.percentUsed, 5);
    assert.equal(session.period, "session");

    const globalWeekly = s.rateLimits.find((r) => r.scope === "global" && r.period === "weekly");
    assert.ok(globalWeekly, "should have a global weekly rate limit");
    assert.equal(globalWeekly.percentUsed, 9);

    const sonnetWeekly = s.rateLimits.find((r) => r.scope === "sonnet");
    assert.ok(sonnetWeekly, "should have a sonnet weekly rate limit");
    assert.equal(sonnetWeekly.percentUsed, 12);
  });

  it("extracts reset info for weekly (all models)", () => {
    const s = parseClaudeUsageFromStatus(CLAUDE_USAGE_FIXTURE);
    assert.ok(s.resetInfo?.includes("Mar 27"));
    assert.ok(s.nextResetAt, "should have a nextResetAt ISO string");
  });

  it("handles minimal output with Sonnet model", () => {
    const s = parseClaudeUsageFromStatus(CLAUDE_USAGE_MINIMAL);
    assert.equal(s.version, "2.2.0");
    assert.equal(s.plan, "Claude Pro");
    assert.equal(s.effort, "medium");
    assert.equal(s.currentModel, "claude-sonnet-4-6");
    assert.equal(s.sessionPercentUsed, 1);
    assert.equal(s.weeklyPercentUsed, 45);
  });

  it("returns a valid snapshot for empty input", () => {
    const s = parseClaudeUsageFromStatus("");
    assert.equal(s.version, null);
    assert.equal(s.weeklyPercentUsed, null);
    assert.equal(s.rateLimits.length, 0);
  });
});

// ── Codex ─────────────────────────────────────────────────────────────────

describe("parseCodexUsageFromStatus", () => {
  it("extracts version from banner", () => {
    const s = parseCodexUsageFromStatus(CODEX_STATUS_FIXTURE);
    assert.equal(s.version, "0.116.0");
  });

  it("extracts model from Model: line with reasoning info", () => {
    const s = parseCodexUsageFromStatus(CODEX_STATUS_FIXTURE);
    assert.equal(s.currentModel, "gpt-5.3-codex-spark");
  });

  it("extracts effort from (reasoning high, ...)", () => {
    const s = parseCodexUsageFromStatus(CODEX_STATUS_FIXTURE);
    assert.equal(s.effort, "high");
  });

  it("extracts account and plan from Account: line", () => {
    const s = parseCodexUsageFromStatus(CODEX_STATUS_FIXTURE);
    assert.equal(s.account, "filipeforattini1@gmail.com");
    assert.equal(s.plan, "Pro");
  });

  it("extracts global weekly percent used from Weekly limit", () => {
    const s = parseCodexUsageFromStatus(CODEX_STATUS_FIXTURE);
    // 84% left → 16% used
    assert.equal(s.weeklyPercentUsed, 16);
  });

  it("builds rate limit entries for global and per-model limits", () => {
    const s = parseCodexUsageFromStatus(CODEX_STATUS_FIXTURE);
    // Should have: global 5h, global weekly, model 5h, model weekly = 4 entries
    assert.ok(s.rateLimits.length >= 4, `expected >= 4, got ${s.rateLimits.length}`);

    const global5h = s.rateLimits.find((r) => r.scope === "global" && r.period === "5h");
    assert.ok(global5h, "should have global 5h entry");
    assert.equal(global5h.percentUsed, 0); // 100% left → 0% used

    const globalWeekly = s.rateLimits.find((r) => r.scope === "global" && r.period === "weekly");
    assert.ok(globalWeekly, "should have global weekly entry");
    assert.equal(globalWeekly.percentUsed, 16); // 84% left → 16% used

    const model5h = s.rateLimits.find((r) => r.scope !== "global" && r.period === "5h");
    assert.ok(model5h, "should have model-specific 5h entry");
    assert.equal(model5h.percentUsed, 54); // 46% left → 54% used

    const modelWeekly = s.rateLimits.find((r) => r.scope !== "global" && r.period === "weekly");
    assert.ok(modelWeekly, "should have model-specific weekly entry");
    assert.equal(modelWeekly.percentUsed, 71); // 29% left → 71% used
  });

  it("extracts weekly reset info", () => {
    const s = parseCodexUsageFromStatus(CODEX_STATUS_FIXTURE);
    assert.ok(s.resetInfo?.includes("15:50"));
  });

  it("handles status-bar-only output with percent fallback", () => {
    const s = parseCodexUsageFromStatus(CODEX_STATUS_BAR_ONLY);
    assert.equal(s.version, "0.116.0");
    assert.equal(s.currentModel, "gpt-5.4");
    assert.equal(s.effort, "high");
    // "75% left" → 25% used
    assert.equal(s.weeklyPercentUsed, 25);
  });

  it("returns a valid snapshot for empty input", () => {
    const s = parseCodexUsageFromStatus("");
    assert.equal(s.version, null);
    assert.equal(s.weeklyPercentUsed, null);
    assert.equal(s.rateLimits.length, 0);
  });
});

// ── Gemini ────────────────────────────────────────────────────────────────

describe("parseGeminiUsageFromStatus", () => {
  it("extracts version from banner", () => {
    const s = parseGeminiUsageFromStatus(GEMINI_STATS_FIXTURE);
    assert.equal(s.version, "0.34.0");
  });

  it("extracts account from Signed in line", () => {
    const s = parseGeminiUsageFromStatus(GEMINI_STATS_FIXTURE);
    assert.equal(s.account, "filipeforattini1@gmail.com");
  });

  it("extracts plan from Plan: line", () => {
    const s = parseGeminiUsageFromStatus(GEMINI_STATS_FIXTURE);
    assert.equal(s.plan, "Gemini Code Assist in Google One AI Pro");
  });

  it("extracts the highest per-model percent as weeklyPercentUsed", () => {
    const s = parseGeminiUsageFromStatus(GEMINI_STATS_FIXTURE);
    assert.equal(s.weeklyPercentUsed, 13);
  });

  it("builds per-model rate limit entries", () => {
    const s = parseGeminiUsageFromStatus(GEMINI_STATS_FIXTURE);
    assert.equal(s.rateLimits.length, 5);

    const flash = s.rateLimits.find((r) => r.scope === "gemini-2.5-flash");
    assert.ok(flash, "should have gemini-2.5-flash entry");
    assert.equal(flash.percentUsed, 13);
    assert.equal(flash.period, "daily");
    assert.ok(flash.resetInfo?.includes("11:51"));

    const pro = s.rateLimits.find((r) => r.scope === "gemini-2.5-pro");
    assert.ok(pro, "should have gemini-2.5-pro entry");
    assert.equal(pro.percentUsed, 2);
  });

  it("extracts first model as currentModel", () => {
    const s = parseGeminiUsageFromStatus(GEMINI_STATS_FIXTURE);
    assert.equal(s.currentModel, "gemini-2.5-flash");
  });

  it("handles minimal output", () => {
    const s = parseGeminiUsageFromStatus(GEMINI_STATS_MINIMAL);
    assert.equal(s.version, "0.35.0");
    assert.equal(s.plan, "Gemini Code Assist Free");
    assert.equal(s.weeklyPercentUsed, 50);
    assert.equal(s.rateLimits.length, 1);
  });

  it("returns a valid snapshot for empty input", () => {
    const s = parseGeminiUsageFromStatus("");
    assert.equal(s.version, null);
    assert.equal(s.weeklyPercentUsed, null);
    assert.equal(s.rateLimits.length, 0);
  });
});
