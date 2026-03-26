import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AgentProviderDefinition,
  BlueprintArtifact,
  BlueprintNode,
  BlueprintNodeExecutionMode,
  BlueprintNodeRun,
  BlueprintNodeStatus,
  BlueprintRun,
  BudgetPolicy,
  DelegationPolicy,
  HarnessBlueprint,
  IssueEntry,
  IssuePlan,
  RuntimeConfig,
} from "../types.ts";
import {
  BLUEPRINT_ARTIFACTS_DIRNAME,
  DEFAULT_BLUEPRINT_ID,
  DEFAULT_BLUEPRINT_MAX_FANOUT,
  DEFAULT_BLUEPRINT_MAX_LOCAL_RETRIES,
  DEFAULT_BLUEPRINT_MAX_REMOTE_ROUNDS,
  DEFAULT_BLUEPRINT_MAX_WALL_CLOCK_MINUTES,
  DEFAULT_BLUEPRINT_VERSION,
} from "../concerns/constants.ts";
import { now } from "../concerns/helpers.ts";

const EXECUTION_NODE_IDS = {
  ingestContext: "ingest_context",
  hydrateRules: "hydrate_rules",
  implement: "implement",
  runLocalGates: "run_local_gates",
  checkpointReview: "checkpoint_review",
  runRemoteGate: "run_remote_gate",
  finalReview: "final_review",
  handoff: "handoff",
} as const;

function inferDelegationMode(plan: IssuePlan): DelegationPolicy["mode"] {
  if ((plan.suggestedAgents?.length ?? 0) > 0 || plan.estimatedComplexity === "high") return "governed";
  return "serial";
}

function buildDelegationPolicy(plan: IssuePlan): DelegationPolicy {
  const inherited = plan.executionContract.delegationPolicy;
  if (inherited) return inherited;

  return {
    mode: inferDelegationMode(plan),
    maxFanout: DEFAULT_BLUEPRINT_MAX_FANOUT,
    requireExplicitWriteScope: true,
    allowPlanningDelegation: true,
    allowExecutionDelegation: true,
    allowReviewDelegation: true,
  };
}

function buildBudgetPolicy(plan: IssuePlan, config: RuntimeConfig): BudgetPolicy {
  const inherited = plan.executionContract.budgetPolicy;
  if (inherited) return inherited;

  return {
    maxLocalRetries: DEFAULT_BLUEPRINT_MAX_LOCAL_RETRIES,
    maxRemoteRounds: plan.harnessMode === "contractual"
      ? Math.max(DEFAULT_BLUEPRINT_MAX_REMOTE_ROUNDS, 2)
      : DEFAULT_BLUEPRINT_MAX_REMOTE_ROUNDS,
    maxDelegationFanout: DEFAULT_BLUEPRINT_MAX_FANOUT,
    maxWallClockMinutes: DEFAULT_BLUEPRINT_MAX_WALL_CLOCK_MINUTES,
    maxTokenBudgetUsd: config.maxBudgetUsd,
  };
}

function node(
  id: string,
  label: string,
  type: BlueprintNode["type"],
  dependsOn: string[] = [],
  options: Partial<BlueprintNode> = {},
): BlueprintNode {
  return {
    id,
    label,
    type,
    dependsOn,
    required: true,
    mode: "serial",
    ...options,
  };
}

export function buildHarnessBlueprint(
  plan: IssuePlan,
  config: RuntimeConfig,
): HarnessBlueprint {
  if (plan.blueprint) return plan.blueprint;

  const delegationPolicy = buildDelegationPolicy(plan);
  const checkpointPolicy = plan.executionContract.checkpointPolicy;
  const nodes: BlueprintNode[] = [
    node(EXECUTION_NODE_IDS.ingestContext, "Ingest Context", "deterministic"),
    node(EXECUTION_NODE_IDS.hydrateRules, "Hydrate Rules", "deterministic", [EXECUTION_NODE_IDS.ingestContext]),
    node(EXECUTION_NODE_IDS.implement, "Implement", "agent", [EXECUTION_NODE_IDS.hydrateRules], {
      role: "executor",
      mode: delegationPolicy.mode === "serial" ? "serial" : "parallel",
    }),
    node(EXECUTION_NODE_IDS.runLocalGates, "Run Local Gates", "deterministic", [EXECUTION_NODE_IDS.implement]),
  ];

  if (checkpointPolicy === "checkpointed") {
    nodes.push(
      node(EXECUTION_NODE_IDS.checkpointReview, "Checkpoint Review", "review", [EXECUTION_NODE_IDS.runLocalGates], {
        role: "reviewer",
      }),
    );
  }

  nodes.push(
    node(
      EXECUTION_NODE_IDS.runRemoteGate,
      "Run Remote Gate",
      "deterministic",
      [checkpointPolicy === "checkpointed" ? EXECUTION_NODE_IDS.checkpointReview : EXECUTION_NODE_IDS.runLocalGates],
      { required: false },
    ),
    node(
      EXECUTION_NODE_IDS.finalReview,
      "Final Review",
      "review",
      [EXECUTION_NODE_IDS.runRemoteGate],
      {
        role: "reviewer",
        required: false,
      },
    ),
    node(EXECUTION_NODE_IDS.handoff, "Handoff", "handoff", [EXECUTION_NODE_IDS.finalReview], { role: "executor" }),
  );

  return {
    id: plan.executionContract.blueprintId || DEFAULT_BLUEPRINT_ID,
    version: DEFAULT_BLUEPRINT_VERSION,
    summary: `Blueprint for ${plan.summary}`,
    mode: "unattended",
    checkpointPolicy,
    delegationPolicy,
    budgetPolicy: buildBudgetPolicy(plan, config),
    nodes,
  };
}

export function resolveBlueprintArtifactsRoot(workspacePath: string): string {
  return join(workspacePath, BLUEPRINT_ARTIFACTS_DIRNAME);
}

function ensureNodeDir(workspacePath: string, runId: string, nodeId: string): string {
  const dir = join(resolveBlueprintArtifactsRoot(workspacePath), runId, nodeId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeBlueprintArtifact(
  workspacePath: string,
  runId: string,
  nodeId: string,
  kind: BlueprintArtifact["kind"],
  content: string,
  extension = "md",
): BlueprintArtifact {
  const dir = ensureNodeDir(workspacePath, runId, nodeId);
  const fileName = `${kind}.${extension}`;
  const absolutePath = join(dir, fileName);
  writeFileSync(absolutePath, content, "utf8");
  return {
    id: `${nodeId}:${kind}`,
    nodeId,
    kind,
    path: absolutePath,
    createdAt: now(),
  };
}

export function writeBlueprintJsonArtifact(
  workspacePath: string,
  runId: string,
  nodeId: string,
  kind: BlueprintArtifact["kind"],
  payload: unknown,
): BlueprintArtifact {
  return writeBlueprintArtifact(
    workspacePath,
    runId,
    nodeId,
    kind,
    JSON.stringify(payload, null, 2),
    "json",
  );
}

export function startBlueprintRun(
  issue: IssueEntry,
  blueprint: HarnessBlueprint,
  scope: BlueprintRun["scope"],
): BlueprintRun {
  const run: BlueprintRun = {
    id: `blueprint-${scope}-${randomUUID()}`,
    blueprintId: blueprint.id,
    issueId: issue.id,
    planVersion: issue.planVersion ?? 1,
    executeAttempt: issue.executeAttempt ?? 0,
    status: "running",
    startedAt: now(),
    scope,
    nodes: blueprint.nodes.map((entry) => ({
      nodeId: entry.id,
      label: entry.label,
      type: entry.type,
      status: "pending",
      artifacts: [],
    })),
  };

  issue.blueprintRuns = [...(issue.blueprintRuns ?? []), run];
  return run;
}

export function getBlueprintNodeRun(run: BlueprintRun, nodeId: string): BlueprintNodeRun {
  const nodeRun = run.nodes.find((entry) => entry.nodeId === nodeId);
  if (!nodeRun) throw new Error(`Blueprint node run ${nodeId} not found.`);
  return nodeRun;
}

export function updateBlueprintNodeRun(
  run: BlueprintRun,
  nodeId: string,
  status: BlueprintNodeStatus,
  updates: Partial<Omit<BlueprintNodeRun, "nodeId" | "status">> = {},
): BlueprintNodeRun {
  const nodeRun = getBlueprintNodeRun(run, nodeId);
  nodeRun.status = status;
  if (status === "running" && !nodeRun.startedAt) nodeRun.startedAt = now();
  if ((status === "completed" || status === "failed" || status === "skipped") && !nodeRun.completedAt) nodeRun.completedAt = now();
  Object.assign(nodeRun, updates);
  return nodeRun;
}

export function finalizeBlueprintRun(run: BlueprintRun, status: BlueprintRun["status"]): BlueprintRun {
  run.status = status;
  run.completedAt = now();
  return run;
}

export function attachNodeArtifacts(
  run: BlueprintRun,
  nodeId: string,
  artifacts: BlueprintArtifact[],
): void {
  const nodeRun = getBlueprintNodeRun(run, nodeId);
  nodeRun.artifacts.push(...artifacts);
}

export function buildBlueprintBrief(
  issue: IssueEntry,
  plan: IssuePlan,
  blueprint: HarnessBlueprint,
  node: BlueprintNode,
  provider?: AgentProviderDefinition | null,
): string {
  const lines = [
    `# ${node.label}`,
    "",
    `Issue: ${issue.identifier} - ${issue.title}`,
    `Plan summary: ${plan.summary}`,
    `Harness mode: ${plan.harnessMode}`,
    `Blueprint: ${blueprint.id} v${blueprint.version}`,
    `Node: ${node.id} [${node.type}]`,
  ];

  if (provider) {
    lines.push(`Provider: ${provider.provider}${provider.model ? `/${provider.model}` : ""}`);
  }

  if (node.dependsOn?.length) {
    lines.push(`Depends on: ${node.dependsOn.join(", ")}`);
  }

  if (plan.executionContract.focusAreas.length) {
    lines.push("", "Focus areas:");
    for (const focusArea of plan.executionContract.focusAreas) {
      lines.push(`- ${focusArea}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function summarizeDeterministicNode(
  label: string,
  details: Record<string, unknown>,
): string {
  return `# ${label}\n\n${JSON.stringify(details, null, 2)}\n`;
}

export function resolveBlueprintNodeMode(
  blueprint: HarnessBlueprint,
  nodeId: string,
): BlueprintNodeExecutionMode {
  return blueprint.nodes.find((entry) => entry.id === nodeId)?.mode || "serial";
}

export function shouldRunBlueprintNode(
  _blueprint: HarnessBlueprint,
  nodeId: string,
  scope: BlueprintRun["scope"],
): boolean {
  if (nodeId === EXECUTION_NODE_IDS.checkpointReview || nodeId === EXECUTION_NODE_IDS.finalReview) {
    return scope === "review";
  }
  return scope === "execute";
}

export const BLUEPRINT_EXECUTION_NODE_IDS = EXECUTION_NODE_IDS;
