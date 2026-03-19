import type { IssuePlan } from "./types.ts";
import { PLAN_JSON_SCHEMA } from "./planning-schema.ts";
import { buildClaudeCommand, buildCodexCommand } from "./adapters/commands.ts";
import { renderPrompt } from "../prompting.ts";

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


