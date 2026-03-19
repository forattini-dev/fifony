export function listPrompts(): Array<Record<string, unknown>> {
  return [
    { name: "fifony-integrate-client", description: "Generate setup instructions for connecting an MCP-capable client to Fifony.", arguments: [{ name: "client", description: "Client name, e.g. codex or claude.", required: true }, { name: "goal", description: "What the client should do with Fifony.", required: false }] },
    { name: "fifony-plan-issue", description: "Generate a planning prompt for a specific issue in the Fifony store.", arguments: [{ name: "issueId", description: "Issue identifier.", required: true }, { name: "provider", description: "Agent provider name.", required: false }] },
{ name: "fifony-use-integration", description: "Generate a concrete integration prompt for agency-agents or impeccable.", arguments: [{ name: "integration", description: "Integration id: agency-agents or impeccable.", required: true }] },
    { name: "fifony-route-task", description: "Explain which providers, profiles, and overlays Fifony would choose for a task.", arguments: [{ name: "title", description: "Task title.", required: true }, { name: "description", description: "Task description.", required: false }, { name: "labels", description: "Comma-separated labels.", required: false }, { name: "paths", description: "Comma-separated target paths or files.", required: false }] },
    { name: "fifony-diagnose-blocked", description: "Help diagnose why an issue is blocked or failing, analyzing the issue plan, last error, history, and events.", arguments: [{ name: "issueId", description: "Issue identifier to diagnose.", required: true }] },
    { name: "fifony-weekly-summary", description: "Generate a weekly progress summary including issues created, completed, blocked, and token usage.", arguments: [] },
    { name: "fifony-refine-plan", description: "Guided plan refinement prompt that shows the current plan and helps provide specific feedback.", arguments: [{ name: "issueId", description: "Issue identifier whose plan to refine.", required: true }, { name: "concern", description: "Optional specific concern to address in refinement.", required: false }] },
    { name: "fifony-code-review", description: "Review code changes for an issue by analyzing its git diff.", arguments: [{ name: "issueId", description: "Issue identifier to review.", required: true }] },
  ];
}
