import type { IssueEntry, RuntimeState } from "../types.ts";
import {
  agentLogPath,
  canDispatchAgent,
  getAgentStatus,
  initAgentWatcher,
  reconcileAgentStates,
  runExecutePhase,
  runPlanPhase,
  runReviewPhase,
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
  return initAgentWatcher(getIssues, fifonyDir, (t) => {
    // Broadcast agent state to frontend via WS
    import("../routes/websocket.ts").then(({ broadcastToWebSocketClients }) => {
      broadcastToWebSocketClients({
        type: "agent-fsm",
        issueId: t.issueId,
        identifier: t.identifier,
        operation: t.operation,
        state: t.to,
        running: t.to === "running" || t.to === "preparing",
        pid: t.pid ?? null,
      });
    }).catch(() => {});
    onTransition(t);
  });
}

export function canDispatchManagedAgent(
  issue: IssueEntry,
  phase: "plan" | "execute" | "review",
  running: ReadonlySet<string>,
  issues: IssueEntry[],
): boolean {
  return canDispatchAgent(issue, phase, running, issues);
}

export async function runPlanningJob(
  state: RuntimeState,
  issue: IssueEntry,
  fifonyDir: string,
): Promise<void> {
  await runPlanPhase(state, issue, fifonyDir);
}

export async function runManagedExecuteJob(
  state: RuntimeState,
  issue: IssueEntry,
  running: Set<string>,
  isActive: () => boolean,
  getCurrentIssue: (id: string) => IssueEntry | undefined,
  fifonyDir: string,
): Promise<void> {
  await runExecutePhase(state, issue, running, isActive, getCurrentIssue, fifonyDir);
}

export async function runManagedReviewJob(
  state: RuntimeState,
  issue: IssueEntry,
  running: Set<string>,
  fifonyDir: string,
): Promise<void> {
  await runReviewPhase(state, issue, running, fifonyDir);
}
