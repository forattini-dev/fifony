import type { IssuePlan } from "./types.ts";
import { PLAN_JSON_SCHEMA, PLAN_SCHEMA_OBJECT } from "./planning-schema.ts";
import { buildClaudeCommand, buildCodexCommand } from "./adapters/commands.ts";
import { callOpenAI } from "./openai-adapter.ts";
import { renderPrompt } from "../prompting.ts";
import type { PlanningSessionUsage } from "./planning-session.ts";

// ── Prompt builders ───────────────────────────────────────────────────────────

export async function buildPlanPrompt(title: string, description: string, fast = false, images?: string[]): Promise<string> {
  return renderPrompt("issue-planner", {
    title,
    description: description || "(none provided)",
    fast,
    images: images?.length ? images : undefined,
  });
}

export async function buildRefinePrompt(
  title: string,
  description: string,
  currentPlan: IssuePlan,
  feedback: string,
): Promise<string> {
  return renderPrompt("issue-planner-refine", {
    title,
    description: description || "(none provided)",
    currentPlan: JSON.stringify(currentPlan, null, 2),
    feedback,
  });
}

// ── Provider command ──────────────────────────────────────────────────────────

export function getPlanCommand(provider: string, model?: string, imagePaths?: string[]): string {
  if (provider === "claude") return buildClaudeCommand({ model, jsonSchema: PLAN_JSON_SCHEMA, noToolAccess: true });
  if (provider === "codex") return buildCodexCommand({ model, imagePaths });
  return "";
}

// ── OpenAI API path (for Codex provider reasoning-only operations) ────────────

export async function generatePlanViaOpenAI(
  prompt: string,
  model?: string,
  effort?: string,
): Promise<{ content: string; usage: PlanningSessionUsage; model: string }> {
  const result = await callOpenAI({
    prompt,
    model,
    jsonSchema: { name: "issue_plan", schema: PLAN_SCHEMA_OBJECT },
    reasoningEffort: effort,
    timeoutMs: 1_800_000, // 30 minutes
  });

  return {
    content: result.content,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
      model: result.model,
      promptChars: prompt.length,
      outputChars: result.content.length,
      durationMs: 0, // Will be set by caller
    },
    model: result.model,
  };
}
