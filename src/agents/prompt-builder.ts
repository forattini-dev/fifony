import type {
  AgentProviderDefinition,
  IssueEntry,
} from "../types.ts";
import { renderPrompt } from "./prompting.ts";

/** Build retry context from previous failed attempts for injection into prompts. */
export function buildRetryContext(issue: IssueEntry): string {
  const summaries = issue.previousAttemptSummaries;
  if (!summaries || summaries.length === 0) return "";

  const lines = ["## Previous Attempts\n"];
  lines.push("The following previous attempts FAILED. Do NOT repeat the same approach. Try a fundamentally different strategy.\n");

  for (let i = 0; i < summaries.length; i++) {
    const s = summaries[i];
    lines.push(`### Attempt ${i + 1} (plan v${s.planVersion}, exec #${s.executeAttempt})`);
    lines.push(`**Error:** ${s.error}`);
    if (s.outputTail) {
      lines.push(`**Output tail:**\n\`\`\`\n${s.outputTail}\n\`\`\``);
    }
    if (s.outputFile) {
      lines.push(`*Full output saved in: outputs/${s.outputFile}*`);
    }
    lines.push("");
  }

  // Hard limit to ~2000 tokens (~8000 chars)
  const full = lines.join("\n");
  return full.length > 8000 ? full.slice(0, 8000) + "\n[...truncated]" : full;
}

export async function buildPrompt(issue: IssueEntry, _workflowDefinition: null): Promise<string> {
  const rendered = await renderPrompt("workflow-default", { issue, attempt: issue.attempts || 0 });

  if (!issue.plan?.steps?.length) {
    return rendered;
  }

  const planSection = await renderPrompt("workflow-plan-section", {
    estimatedComplexity: issue.plan.estimatedComplexity,
    summary: issue.plan.summary,
    steps: issue.plan.steps.map((step) => ({
      step: step.step,
      action: step.action,
      files: step.files ?? [],
      details: step.details ?? "",
    })),
  });

  return `${rendered}\n\n${planSection}`;
}

export async function buildTurnPrompt(
  issue: IssueEntry,
  basePrompt: string,
  previousOutput: string,
  turnIndex: number,
  maxTurns: number,
  nextPrompt: string,
): Promise<string> {
  if (turnIndex === 1) return basePrompt;

  return renderPrompt("agent-turn", {
    issueIdentifier: issue.identifier,
    turnIndex,
    maxTurns,
    basePrompt,
    continuation: nextPrompt.trim() || "Continue the work, inspect the workspace, and move the issue toward completion.",
    outputTail: previousOutput.trim() || "No previous output captured.",
  });
}

export async function buildProviderBasePrompt(
  provider: AgentProviderDefinition,
  issue: IssueEntry,
  basePrompt: string,
  workspacePath: string,
  skillContext: string,
): Promise<string> {
  return renderPrompt("agent-provider-base", {
    isPlanner: provider.role === "planner",
    isReviewer: provider.role === "reviewer",
    hasImpeccableOverlay: provider.overlays?.includes("impeccable") ?? false,
    hasFrontendDesignOverlay: provider.overlays?.includes("frontend-design") ?? false,
    profileInstructions: provider.profileInstructions || "",
    skillContext,
    capabilityCategory: provider.capabilityCategory || "",
    selectionReason: provider.selectionReason ?? "No additional routing reason.",
    overlays: provider.overlays ?? [],
    targetPaths: issue.paths ?? [],
    workspacePath,
    basePrompt,
  });
}
