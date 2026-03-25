import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentDirective,
  AgentDirectiveStatus,
  AgentProviderRole,
  AgentTokenUsage,
  IssueEntry,
  JsonRecord,
} from "../types.ts";
import { toStringValue } from "../concerns/helpers.ts";
import { logger } from "../concerns/logger.ts";

export function normalizeAgentDirectiveStatus(value: unknown, fallback: AgentDirectiveStatus): AgentDirectiveStatus {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "done" || normalized === "continue" || normalized === "blocked" || normalized === "failed") {
    return normalized;
  }
  return fallback;
}

export function addTokenUsage(issue: IssueEntry, usage?: AgentTokenUsage, role?: AgentProviderRole): void {
  if (!usage || usage.totalTokens === 0) return;

  // 1. Aggregate overall tokenUsage summary
  const prev = issue.tokenUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  issue.tokenUsage = {
    inputTokens: prev.inputTokens + usage.inputTokens,
    outputTokens: prev.outputTokens + usage.outputTokens,
    totalTokens: prev.totalTokens + usage.totalTokens,
    model: usage.model || prev.model,
  };

  // 2. Per-phase breakdown (planner / executor / reviewer)
  if (role) {
    if (!issue.tokensByPhase) issue.tokensByPhase = {} as Record<AgentProviderRole, AgentTokenUsage>;
    const prevPhase = issue.tokensByPhase[role] ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    issue.tokensByPhase[role] = {
      inputTokens: prevPhase.inputTokens + usage.inputTokens,
      outputTokens: prevPhase.outputTokens + usage.outputTokens,
      totalTokens: prevPhase.totalTokens + usage.totalTokens,
      model: usage.model || prevPhase.model,
    };
  }

  // 3. Per-model breakdown with full input/output detail
  const model = usage.model || issue.tokenUsage?.model || "unknown";
  if (!issue.tokensByModel) issue.tokensByModel = {};
  const prevModel = issue.tokensByModel[model] ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  issue.tokensByModel[model] = {
    inputTokens: prevModel.inputTokens + usage.inputTokens,
    outputTokens: prevModel.outputTokens + usage.outputTokens,
    totalTokens: prevModel.totalTokens + usage.totalTokens,
    model,
  };

  // 4. Per-model totals for EventualConsistency daily cohort analytics
  if (!issue.usage) issue.usage = { tokens: {} };
  issue.usage.tokens[model] = (issue.usage.tokens[model] || 0) + usage.totalTokens;
}

export function extractOutputMarker(output: string, name: string): string {
  const match = output.match(new RegExp(`^${name}=(.+)$`, "im"));
  return match?.[1]?.trim() ?? "";
}

export function extractTokenUsage(output: string, jsonObj?: JsonRecord | null): AgentTokenUsage | undefined {
  if (jsonObj) {
    // 1a. Claude --output-format json: modelUsage field (richer — includes cache tokens, per-model breakdown)
    const modelUsage = jsonObj.modelUsage as Record<string, Record<string, unknown>> | undefined;
    if (modelUsage && typeof modelUsage === "object") {
      let totalInput = 0, totalOutput = 0, primaryModel = "", maxTokens = 0;
      for (const [model, data] of Object.entries(modelUsage)) {
        const inp = Number(data?.inputTokens || 0) + Number(data?.cacheReadInputTokens || 0) + Number(data?.cacheCreationInputTokens || 0);
        const out = Number(data?.outputTokens || 0);
        totalInput += inp;
        totalOutput += out;
        if (inp + out > maxTokens) { maxTokens = inp + out; primaryModel = model; }
      }
      if (totalInput > 0 || totalOutput > 0) {
        return {
          inputTokens: totalInput,
          outputTokens: totalOutput,
          totalTokens: totalInput + totalOutput,
          costUsd: typeof jsonObj.cost_usd === "number" ? jsonObj.cost_usd : typeof jsonObj.total_cost_usd === "number" ? jsonObj.total_cost_usd : undefined,
          model: primaryModel || (typeof jsonObj.model === "string" ? jsonObj.model : undefined),
        };
      }
    }

    // 1b. Gemini --output-format json: stats.models per-model breakdown
    //     { stats: { models: { "gemini-2.5-flash": { tokens: { input, candidates, total, cached, thoughts } } } } }
    const stats = jsonObj.stats as Record<string, unknown> | undefined;
    const geminiModels = (stats?.models ?? null) as Record<string, Record<string, unknown>> | null;
    if (geminiModels && typeof geminiModels === "object") {
      let totalInput = 0, totalOutput = 0, primaryModel = "", maxTokens = 0;
      for (const [model, data] of Object.entries(geminiModels)) {
        const tokens = data?.tokens as Record<string, unknown> | undefined;
        if (!tokens) continue;
        const inp = Number(tokens.input || 0) + Number(tokens.cached || 0);
        const out = Number(tokens.candidates || 0);
        totalInput += inp;
        totalOutput += out;
        if (inp + out > maxTokens) { maxTokens = inp + out; primaryModel = model; }
      }
      if (totalInput > 0 || totalOutput > 0) {
        return {
          inputTokens: totalInput,
          outputTokens: totalOutput,
          totalTokens: totalInput + totalOutput,
          model: primaryModel || undefined,
        };
      }
    }

    // 1c. Claude --output-format json: usage field (aggregate totals)
    const usage = jsonObj.usage as Record<string, unknown> | undefined;
    if (usage && typeof usage === "object") {
      const inp = Number(usage.input_tokens) || 0;
      const out = Number(usage.output_tokens) || 0;
      if (inp > 0 || out > 0) {
        return {
          inputTokens: inp,
          outputTokens: out,
          totalTokens: inp + out,
          costUsd: typeof jsonObj.cost_usd === "number" ? jsonObj.cost_usd : typeof jsonObj.total_cost_usd === "number" ? jsonObj.total_cost_usd : undefined,
          model: typeof jsonObj.model === "string" ? jsonObj.model : undefined,
        };
      }
    }
  }

  // 2. Codex: "tokens used\n1,681\n" and "model: gpt-5.3" in stdout
  const codexMatch = output.match(/tokens?\s+used\s*\n\s*([\d,]+)/i);
  if (codexMatch) {
    const total = parseInt(codexMatch[1].replace(/,/g, ""), 10);
    if (total > 0) {
      const modelMatch = output.match(/^model:\s*(.+)$/im);
      return {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: total,
        model: modelMatch?.[1]?.trim() || undefined,
      };
    }
  }

  return undefined;
}

export function tryParseJsonOutput(output: string): JsonRecord | null {
  const trimmed = output.trim();
  // --output-format json wraps the result in a JSON object with a "result" field
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as JsonRecord;

      // --json-schema puts structured output in .structured_output (not .result)
      if (obj.structured_output && typeof obj.structured_output === "object" && !Array.isArray(obj.structured_output)) {
        return obj.structured_output as JsonRecord;
      }

      // Claude --output-format json returns { result: "..." } — the result may itself be JSON
      if (typeof obj.result === "string") {
        try {
          const inner = JSON.parse(obj.result) as unknown;
          if (inner && typeof inner === "object" && !Array.isArray(inner)) {
            return inner as JsonRecord;
          }
        } catch {
          // result is plain text, not JSON
        }
      }
      // Direct JSON with status field (from --json-schema)
      if (obj.status) return obj;

      // Gemini --output-format json: { response: "...", stats: { ... } }
      if (typeof obj.response === "string") {
        try {
          const inner = JSON.parse(obj.response) as unknown;
          if (inner && typeof inner === "object" && !Array.isArray(inner)) {
            return inner as JsonRecord;
          }
        } catch {
          // response is plain text — not structured JSON
        }
      }
    }
  } catch {
    // Not JSON output — fall through to legacy parsing
  }
  return null;
}

/** Extract usage arrays (tools, skills, agents, commands) from parsed JSON output. */
function extractUsageArrays(obj: JsonRecord | null): Pick<AgentDirective, "toolsUsed" | "skillsUsed" | "agentsUsed" | "commandsRun"> {
  if (!obj) return {};
  const toArr = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v) || v.length === 0) return undefined;
    return v.filter((s): s is string => typeof s === "string" && s.length > 0);
  };
  return {
    toolsUsed: toArr(obj.tools_used ?? obj.toolsUsed),
    skillsUsed: toArr(obj.skills_used ?? obj.skillsUsed),
    agentsUsed: toArr(obj.agents_used ?? obj.agentsUsed),
    commandsRun: toArr(obj.commands_run ?? obj.commandsRun),
  };
}

export function readAgentDirective(workspacePath: string, output: string, success: boolean): AgentDirective {
  const fallbackStatus: AgentDirectiveStatus = success ? "done" : "failed";
  const resultFile = join(workspacePath, "result.json");
  let resultPayload: JsonRecord = {};

  // 1. Try structured JSON from stdout (claude --output-format json --json-schema)
  // Claude without --bare may output the JSON result twice (stdout capture artifact).
  // Try parsing as-is first, then fall back to extracting the first JSON object.
  const fullJson = (() => {
    const trimmed = output.trim();
    try { return JSON.parse(trimmed) as JsonRecord; } catch {}
    // Try extracting the first { ... } object if the full output isn't valid JSON
    const firstBrace = trimmed.indexOf("{");
    if (firstBrace >= 0) {
      // Find matching closing brace by counting depth
      let depth = 0;
      for (let i = firstBrace; i < trimmed.length; i++) {
        if (trimmed[i] === "{") depth++;
        else if (trimmed[i] === "}") { depth--; if (depth === 0) { try { return JSON.parse(trimmed.slice(firstBrace, i + 1)) as JsonRecord; } catch { break; } } }
      }
    }
    return null;
  })();
  // If we extracted fullJson from duplicated output, also try parsing from it
  const jsonOutput = tryParseJsonOutput(output) ?? (fullJson ? tryParseJsonOutput(JSON.stringify(fullJson)) : null);
  const tokenUsage = extractTokenUsage(fullJson ? JSON.stringify(fullJson) : output, fullJson);

  if (jsonOutput?.status) {
    return {
      status: normalizeAgentDirectiveStatus(jsonOutput.status, fallbackStatus),
      summary: toStringValue(jsonOutput.summary) || toStringValue(jsonOutput.message) || "",
      nextPrompt: toStringValue(jsonOutput.nextPrompt) || toStringValue(jsonOutput.next_prompt) || "",
      tokenUsage,
      ...extractUsageArrays(jsonOutput),
    };
  }

  // 1b. Try JSON code blocks in text output (codex/gemini echo prompt then emit ```json ... ```)
  const codeBlocks = [...output.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)].map((m) => m[1].trim()).reverse();
  for (const block of codeBlocks) {
    try {
      const parsed = JSON.parse(block) as JsonRecord;
      if (parsed?.status) {
        return {
          status: normalizeAgentDirectiveStatus(parsed.status, fallbackStatus),
          summary: toStringValue(parsed.summary) || toStringValue(parsed.message) || "",
          nextPrompt: toStringValue(parsed.nextPrompt) || toStringValue(parsed.next_prompt) || "",
          tokenUsage,
          ...extractUsageArrays(parsed),
        };
      }
    } catch { /* not valid JSON */ }
  }

  // 2. Try result.json file
  if (existsSync(resultFile)) {
    try {
      const parsed = JSON.parse(readFileSync(resultFile, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        resultPayload = parsed as JsonRecord;
      }
    } catch (error) {
      logger.warn(`Invalid result.json in ${workspacePath}: ${String(error)}`);
    }
  }

  // 3. Fall back to file + output marker parsing
  const status = normalizeAgentDirectiveStatus(
    resultPayload.status ?? extractOutputMarker(output, "FIFONY_STATUS"),
    fallbackStatus,
  );
  const summary =
    toStringValue(resultPayload.summary)
    || toStringValue(resultPayload.message)
    || extractOutputMarker(output, "FIFONY_SUMMARY");
  const nextPrompt =
    toStringValue(resultPayload.nextPrompt)
    || toStringValue(resultPayload.next_prompt)
    || "";

  return { status, summary, nextPrompt, tokenUsage, ...extractUsageArrays(resultPayload) };
}
