import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { IssueEntry } from "../types.ts";

export function writeHandoffArtifact(
  workspacePath: string,
  issue: IssueEntry,
  lastOutput: string,
  nextPrompt: string,
): string {
  const handoffPath = join(workspacePath, "handoff.md");

  let diffStat = "";
  try {
    diffStat = execSync("git diff --stat HEAD", { cwd: workspacePath, timeout: 5000 }).toString().trim();
  } catch {
    diffStat = "(unable to compute diff)";
  }

  const outputTail = lastOutput.length > 3000 ? lastOutput.slice(-3000) : lastOutput;
  const tokenInfo = issue.tokenUsage
    ? `Input: ${issue.tokenUsage.inputTokens?.toLocaleString() ?? 0} | Output: ${issue.tokenUsage.outputTokens?.toLocaleString() ?? 0} | Total: ${issue.tokenUsage.totalTokens?.toLocaleString() ?? 0}`
    : "not available";

  const content = [
    `# Context Reset — Handoff for ${issue.identifier}`,
    "",
    `**Issue:** ${issue.title}`,
    `**Reset #:** ${(issue.contextResetCount ?? 0) + 1}`,
    `**Tokens so far:** ${tokenInfo}`,
    "",
    "## Files Changed",
    "```",
    diffStat || "(no changes yet)",
    "```",
    "",
    "## What Remains",
    nextPrompt.trim() || "(continue the original task)",
    "",
    "## Last Output (tail)",
    "```",
    outputTail || "(no output captured)",
    "```",
  ].join("\n");

  writeFileSync(handoffPath, content, "utf8");
  return handoffPath;
}
