import type { IssueEntry } from "../types.ts";
import {
  agentLogPath,
  getAgentStatus,
  initAgentWatcher,
  reconcileAgentStates,
  type AgentTransition,
} from "../persistence/plugins/fsm-agent.ts";

export type { AgentTransition };
export { agentLogPath, getAgentStatus };

export function reconcileAgentStateTransitions(
  issues: IssueEntry[],
  fifonyDir: string,
): AgentTransition[] {
  return reconcileAgentStates(issues, fifonyDir);
}

export function startManagedAgentWatcher(
  getIssues: () => IssueEntry[],
  fifonyDir: string,
  onTransition: (t: AgentTransition) => void,
): { stop: () => void } {
  return initAgentWatcher(getIssues, fifonyDir, onTransition);
}
