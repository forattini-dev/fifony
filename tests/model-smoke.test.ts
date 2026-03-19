/**
 * Smoke tests: verify every available Claude and Codex model can respond.
 *
 * Strategy (cheap + fast):
 *  - Minimal prompt: "Reply with the exact text: PONG" (< 10 input tokens)
 *  - Claude: --print --no-session-persistence, no tools, no schema
 *  - Codex: exec --skip-git-repo-check, prompt via stdin pipe
 *  - Success = exit 0 + output contains "PONG" (case-insensitive)
 *  - Timeout: 60s per model
 *
 * Run:
 *   pnpm test tests/model-smoke.test.ts
 *
 * Requires the respective CLIs to be authenticated and available.
 * Models are discovered dynamically — same source as the UI.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const TIMEOUT_MS = 60_000;
const PROMPT = "Reply with the exact text: PONG";

// ── Model discovery ───────────────────────────────────────────────────────────

function getCodexModels(): string[] {
  try {
    const cachePath = join(homedir(), ".codex", "models_cache.json");
    if (!existsSync(cachePath)) return [];
    const cache = JSON.parse(readFileSync(cachePath, "utf8")) as {
      models?: Array<{ slug: string; visibility?: string }>;
    };
    return (cache.models ?? [])
      .filter((m) => m.visibility === "list")
      .map((m) => m.slug);
  } catch {
    return [];
  }
}

function getClaudeModels(): string[] {
  try {
    // Extract model IDs from the Claude CLI binary (same method as providers.ts)
    const binaryPath = execSync("readlink -f $(which claude)", {
      encoding: "utf8", timeout: 5000,
    }).trim();
    if (!binaryPath || !existsSync(binaryPath)) return [];
    const out = execSync(`strings "${binaryPath}" | grep -E '^claude-[a-z]+-[0-9]' | sort -u`, {
      encoding: "utf8", timeout: 15_000, maxBuffer: 50_000_000,
    });
    return out.split("\n")
      .map((l) => l.trim())
      // Valid IDs: only alphanumeric + hyphens, start with claude-<family>-<digit>
      .filter((l) => /^claude-[a-z]+-[0-9][a-z0-9-]*$/.test(l) && l.length < 60)
      // Drop partial (trailing -) or ANSI-contaminated entries
      .filter((l) => !l.endsWith("-") && !l.includes("@") && !l.includes("["))
      // Drop legacy pre-4 models (too old to be useful)
      .filter((l) => !/^claude-(instant|haiku-3|sonnet-3|opus-3|claude-2)/.test(l))
      // Drop internal/inaccessible models
      .filter((l) => !l.startsWith("claude-code-"))
      // Drop short aliases (claude-family-major without minor version) — they fail with "model not found"
      .filter((l) => /^claude-[a-z]+-[0-9]+-[0-9]/.test(l))
      .sort();
  } catch {
    return [];
  }
}

// ── Runners ───────────────────────────────────────────────────────────────────

function runClaude(model: string): { ok: boolean; output: string; error?: string } {
  const result = spawnSync(
    "claude",
    ["--print", "--no-session-persistence", "--output-format", "text", "--model", model],
    {
      input: PROMPT,
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      maxBuffer: 512 * 1024,
    },
  );
  const output = (result.stdout || "") + (result.stderr || "");
  if (result.error) return { ok: false, output, error: result.error.message };
  if (result.status !== 0) return { ok: false, output, error: `exit ${result.status}` };
  return { ok: true, output };
}

function runCodex(model: string): { ok: boolean; output: string; error?: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), "fifony-smoke-"));
  const promptFile = join(tmpDir, "prompt.txt");
  try {
    writeFileSync(promptFile, PROMPT, "utf8");
    const result = spawnSync(
      "bash",
      ["-c", `codex exec --skip-git-repo-check --model "${model}" < "${promptFile}"`],
      {
        encoding: "utf8",
        timeout: TIMEOUT_MS,
        maxBuffer: 512 * 1024,
        cwd: tmpDir,
      },
    );
    const output = (result.stdout || "") + (result.stderr || "");
    if (result.error) return { ok: false, output, error: result.error.message };
    if (result.status !== 0) return { ok: false, output, error: `exit ${result.status}` };
    return { ok: true, output };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const claudeModels = getClaudeModels();
const codexModels = getCodexModels();

describe("claude model smoke tests", { skip: claudeModels.length === 0 ? "no claude models discovered" : false }, () => {
  for (const model of claudeModels) {
    it(`claude / ${model}`, { timeout: TIMEOUT_MS + 5000 }, () => {
      const { ok, output, error } = runClaude(model);
      assert.ok(ok, `model ${model} failed: ${error}\nOutput: ${output.slice(0, 500)}`);
      assert.ok(
        output.toUpperCase().includes("PONG"),
        `model ${model} did not reply with PONG\nOutput: ${output.slice(0, 500)}`,
      );
    });
  }
});

describe("codex model smoke tests", { skip: codexModels.length === 0 ? "no codex models discovered" : false }, () => {
  for (const model of codexModels) {
    it(`codex / ${model}`, { timeout: TIMEOUT_MS + 5000 }, () => {
      const { ok, output, error } = runCodex(model);
      assert.ok(ok, `model ${model} failed: ${error}\nOutput: ${output.slice(0, 500)}`);
      assert.ok(
        output.toUpperCase().includes("PONG"),
        `model ${model} did not reply with PONG\nOutput: ${output.slice(0, 500)}`,
      );
    });
  }
});
