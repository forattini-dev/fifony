import { appendFileTail, extractJsonObjects } from "../../concerns/helpers.ts";
import { logger } from "../../concerns/logger.ts";
import { detectAvailableProviders, resolveProviderCapabilities } from "../providers.ts";
import type { RuntimeConfig, ServiceHealthcheck } from "../../types.ts";
import { resolvePlanStageConfig } from "./planning-prompts.ts";
import { ADAPTERS } from "../adapters/registry.ts";
import { env } from "node:process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TARGET_ROOT } from "../../concerns/constants.ts";

// ── JSON schemas ───────────────────────────────────────────────────────────────

const HEALTHCHECK_JSON_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    host: { type: "string" },
    port: { type: "number" },
    protocol: { type: "string", enum: ["http", "https", "tcp"] },
  },
  required: ["host", "port", "protocol"],
  additionalProperties: false,
});

const FIX_JSON_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    hasProblem: { type: "boolean" },
    title: { type: "string" },
    description: { type: "string" },
    issueType: { type: "string", enum: ["bug", "chore", "feature"] },
  },
  required: ["hasProblem"],
  additionalProperties: false,
});

// ── Prompts ────────────────────────────────────────────────────────────────────

function buildHealthcheckPrompt(logTail: string, serviceName: string): string {
  return `You are analyzing the startup log of a service called "${serviceName}".

Your task: identify the host (IP address or hostname) and port where this service is listening for incoming connections.

Look for patterns like:
- "Listening on http://localhost:3000"
- "Server started on port 3000"
- "running on 0.0.0.0:8080"
- "started on 127.0.0.1:4000"
- Any URL or address/port combination that indicates where the service is reachable

Return ONLY a JSON object with this exact structure:
{"host": "localhost", "port": 3000, "protocol": "http"}

Use protocol "http" unless you clearly see "https" or it's a raw TCP service (then use "tcp").
If you cannot find a clear host+port in the log, return: {"host": "localhost", "port": 0, "protocol": "tcp"}

SERVICE LOG (last lines):
\`\`\`
${logTail}
\`\`\``;
}

function buildFixPrompt(logTail: string, serviceName: string): string {
  return `You are analyzing the log of a service called "${serviceName}".

Step 1 — decide if there is a real actionable problem:
- Set hasProblem=true if the log contains errors, crashes, unresolved dependencies, misconfigurations, or anything preventing the service from working correctly.
- Set hasProblem=false if the service started and is running normally (no errors, just startup output or healthy traffic logs).

Step 2 — if hasProblem=true, fill in title, description, and issueType to create a clear issue report a developer can act on:
- title: short (max 80 chars), specific to the actual error
- description: root cause, relevant error messages, file paths or commands from the log, and what to investigate
- issueType: "bug" for crashes/errors, "chore" for config/dependency/tooling issues, "feature" for missing functionality

Return ONLY a JSON object:
{ "hasProblem": true, "title": "...", "description": "...", "issueType": "bug" }
or
{ "hasProblem": false }

SERVICE LOG (last lines):
\`\`\`
${logTail}
\`\`\``;
}

// ── One-shot CLI runner (mirrors issue-enhancer pattern) ─────────────────────

function readProviderOutput(resultFile: string, fallback: string): string {
  if (existsSync(resultFile)) {
    try {
      return readFileSync(resultFile, "utf8").trim();
    } catch {
      // ignore, keep fallback
    }
  }
  return fallback;
}

async function runOneShot(
  command: string,
  provider: string,
  prompt: string,
  timeoutMs: number,
): Promise<string> {
  const tempDir = mkdtempSync(join(tmpdir(), "fifony-log-analyze-"));
  const promptFile = join(tempDir, "prompt.md");
  const resultFile = join(tempDir, "result.txt");
  writeFileSync(promptFile, `${prompt}\n`, "utf8");

  const spawnEnv = {
    ...env,
    FIFONY_PROMPT_FILE: promptFile,
    FIFONY_PROMPT: prompt,
    FIFONY_AGENT_PROVIDER: provider,
    FIFONY_RESULT_FILE: resultFile,
  };

  return await new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let output = "";
    let timedOut = false;

    const child = spawn(command, { shell: true, cwd: TARGET_ROOT, env: spawnEnv });
    if (child.stdin) child.stdin.end();

    child.stdout?.on("data", (chunk: Buffer) => {
      output = appendFileTail(output, String(chunk), 12_000);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output = appendFileTail(output, String(chunk), 12_000);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, Math.max(timeoutMs, 1_000));

    child.on("error", () => {
      clearTimeout(timer);
      rmSync(tempDir, { recursive: true, force: true });
      reject(new Error("Could not execute AI command."));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const commandOutput = readProviderOutput(resultFile, output);
      rmSync(tempDir, { recursive: true, force: true });

      if (timedOut) {
        reject(new Error(`Log analysis timed out after ${Date.now() - startedAt}ms.`));
        return;
      }
      if (code !== 0 && !commandOutput.trim()) {
        reject(new Error(`Log analysis command failed (exit ${code ?? "unknown"}) with no output.`));
        return;
      }
      if (code !== 0) {
        logger.warn({ exitCode: code, provider }, "[LogAnalyzer] Provider exited non-zero but produced output — attempting to use it");
      }
      resolve(commandOutput);
    });
  });
}

// ── JSON extraction ────────────────────────────────────────────────────────────

function extractJsonFromOutput<T>(raw: string): T | null {
  const text = raw.trim();
  if (!text) return null;

  // Try code blocks first (last-to-first to skip echoed prompt)
  const codeBlocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)]
    .map((m) => m[1].trim())
    .reverse();

  for (const block of codeBlocks) {
    for (const candidate of extractJsonObjects(block)) {
      try {
        return JSON.parse(candidate) as T;
      } catch {
        // try next
      }
    }
  }

  // Try raw JSON objects from end of output
  const candidates = extractJsonObjects(text).reverse();
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      // Unwrap Claude CLI --output-format json envelope.
      // With --json-schema the payload lands in `structured_output`;
      // without it, `result` holds the text (try parsing it too).
      if (parsed && typeof parsed === "object") {
        const p = parsed as Record<string, unknown>;
        for (const key of ["structured_output", "result", "response", "output"]) {
          const r = p[key];
          if (!r) continue;
          if (typeof r === "object") return r as T;
          if (typeof r === "string") {
            const clean = r.trim().replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
            for (const inner of extractJsonObjects(clean)) {
              try { return JSON.parse(inner) as T; } catch {}
            }
            try { return JSON.parse(r) as T; } catch {}
          }
        }
      }
      return parsed as T;
    } catch {
      // try next
    }
  }

  return null;
}

// ── Provider setup ─────────────────────────────────────────────────────────────

async function resolveProvider(config: RuntimeConfig) {
  const { provider: selectedProvider, model: selectedModel } = await resolvePlanStageConfig(config);

  const providers = detectAvailableProviders();
  const isAvailable = providers.some((p) => p.name === selectedProvider && p.available);
  if (!isAvailable) {
    const known = providers.map((e) => `${e.name}:${e.available ? "ok" : "missing"}`).join(", ");
    throw new Error(`Plan provider "${selectedProvider}" is not available. Detected: ${known}`);
  }

  const adapter = ADAPTERS[selectedProvider];
  if (!adapter) throw new Error(`No adapter for provider "${selectedProvider}".`);

  return { provider: selectedProvider, model: selectedModel, adapter };
}

function truncateLog(log: string, maxLines: number): string {
  const lines = log.split("\n");
  return lines.length > maxLines ? lines.slice(-maxLines).join("\n") : log;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function analyzeLogForHealthcheck(
  logTail: string,
  serviceName: string,
  config: RuntimeConfig,
): Promise<ServiceHealthcheck | null> {
  const { provider, model, adapter } = await resolveProvider(config);
  const caps = resolveProviderCapabilities(provider);
  const command = adapter.buildCommand({
    model,
    readOnly: true,
    jsonSchema: caps.structuredOutput.mode !== "none" ? HEALTHCHECK_JSON_SCHEMA : undefined,
  });

  const prompt = buildHealthcheckPrompt(truncateLog(logTail, 150), serviceName);
  const timeoutMs = config.commandTimeoutMs ?? 60_000;

  logger.debug({ provider, serviceName }, "[LogAnalyzer] Detecting healthcheck config from log");

  const raw = await runOneShot(command, provider, prompt, timeoutMs);
  const result = extractJsonFromOutput<{ host: string; port: number; protocol: string }>(raw);

  if (!result?.port || result.port <= 0) {
    logger.debug({ provider, serviceName }, "[LogAnalyzer] Could not extract host/port from log");
    return null;
  }

  const protocol = result.protocol === "https" ? "https" : result.protocol === "tcp" ? "tcp" : "http";
  const host = result.host || "localhost";
  const port = result.port;

  const healthcheck: ServiceHealthcheck = protocol === "tcp"
    ? { type: "tcp", port }
    : { type: "http", endpoint: `${protocol}://${host}:${port}/health`, port };

  logger.info({ provider, serviceName, healthcheck }, "[LogAnalyzer] Healthcheck config detected");
  return healthcheck;
}

export type FixSuggestion = {
  hasProblem: true;
  title: string;
  description: string;
  issueType: "bug" | "chore" | "feature";
};

export type FixResult =
  | FixSuggestion
  | { hasProblem: false };

export async function analyzeLogForFix(
  logTail: string,
  serviceName: string,
  config: RuntimeConfig,
): Promise<FixResult | null> {
  const { provider, model, adapter } = await resolveProvider(config);
  const caps = resolveProviderCapabilities(provider);
  const command = adapter.buildCommand({
    model,
    readOnly: true,
    jsonSchema: caps.structuredOutput.mode !== "none" ? FIX_JSON_SCHEMA : undefined,
  });

  const prompt = buildFixPrompt(truncateLog(logTail, 100), serviceName);
  const timeoutMs = config.commandTimeoutMs ?? 60_000;

  logger.debug({ provider, serviceName }, "[LogAnalyzer] Analyzing log for fix suggestion");

  const raw = await runOneShot(command, provider, prompt, timeoutMs);
  const result = extractJsonFromOutput<{ hasProblem: boolean; title?: string; description?: string; issueType?: string }>(raw);

  if (result === null) {
    let envelopeKeys: string[] = [];
    try {
      const { extractJsonObjects } = await import("../../concerns/helpers.ts");
      const candidates = extractJsonObjects(raw.trim());
      if (candidates.length > 0) envelopeKeys = Object.keys(JSON.parse(candidates[candidates.length - 1]));
    } catch {}
    logger.warn({ provider, serviceName, rawLength: raw.length, envelopeKeys, rawTail: raw.slice(-400) }, "[LogAnalyzer] Could not extract fix suggestion from log");
    return null;
  }

  if (!result.hasProblem) {
    logger.debug({ provider, serviceName }, "[LogAnalyzer] No problem detected in log");
    return { hasProblem: false };
  }

  if (!result.title) {
    logger.warn({ provider, serviceName }, "[LogAnalyzer] hasProblem=true but no title in result");
    return null;
  }

  const issueType = ["bug", "chore", "feature"].includes(result.issueType ?? "")
    ? (result.issueType as "bug" | "chore" | "feature")
    : "bug";

  return {
    hasProblem: true,
    title: result.title.slice(0, 120),
    description: result.description ?? "",
    issueType,
  };
}
