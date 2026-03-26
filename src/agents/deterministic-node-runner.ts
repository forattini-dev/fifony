import type { BlueprintNode, IssueEntry } from "../types.ts";
import { runHook } from "./command-executor.ts";
import { logger } from "../concerns/logger.ts";

export type DeterministicNodeResult = {
  passed: boolean;
  output: string;
  durationMs: number;
};

export async function runDeterministicNode(
  node: BlueprintNode,
  workspacePath: string,
  issue: IssueEntry,
): Promise<DeterministicNodeResult> {
  if (!node.command) {
    return { passed: true, output: "", durationMs: 0 };
  }
  const start = Date.now();
  logger.info({ issueId: issue.id, nodeId: node.id, command: node.command }, "[Blueprint] Running deterministic node");
  let passed = false;
  let output = "";
  try {
    await runHook(node.command, workspacePath, issue, "deterministic_node");
    passed = true;
  } catch (err) {
    passed = false;
    output = err instanceof Error ? err.message : String(err);
  }
  const durationMs = Date.now() - start;
  logger.info({ issueId: issue.id, nodeId: node.id, passed, durationMs }, "[Blueprint] Deterministic node complete");
  return { passed, output, durationMs };
}
