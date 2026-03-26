import { existsSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import type {
  AcceptanceCriterion,
  ExecutionContract,
  IssuePlan,
  IssueEntry,
  AgentProviderDefinition,
  EffortConfig,
  AgentProviderRole,
} from "../../types.ts";

/** Render plan context (summary, assumptions, constraints, unknowns) */
export function buildPlanContextSection(plan: IssuePlan): string {
  const parts: string[] = ["## Plan Context", "", `**Summary:** ${plan.summary}`, `**Harness mode:** ${plan.harnessMode}`];

  if (plan.assumptions?.length) {
    parts.push("", "**Assumptions:**");
    plan.assumptions.forEach((a) => parts.push(`- ${a}`));
  }
  if (plan.constraints?.length) {
    parts.push("", "**Constraints:**");
    plan.constraints.forEach((c) => parts.push(`- ${c}`));
  }
  if (plan.unknowns?.length) {
    parts.push("", "**Unknowns to investigate:**");
    plan.unknowns.forEach((u) => {
      parts.push(`- **${u.question}**`);
      if (u.whyItMatters) parts.push(`  Why it matters: ${u.whyItMatters}`);
      if (u.howToResolve) parts.push(`  How to resolve: ${u.howToResolve}`);
    });
  }

  return parts.join("\n");
}

/** Render execution steps or phases */
export function buildStepsSection(plan: IssuePlan): string {
  const parts: string[] = ["## Execution Steps"];

  if (plan.phases?.length) {
    for (const phase of plan.phases) {
      parts.push("", `### Phase: ${phase.phaseName}`, `Goal: ${phase.goal}`);
      if (phase.dependencies?.length) parts.push(`Dependencies: ${phase.dependencies.join(", ")}`);
      for (const task of phase.tasks) {
        parts.push(`${task.step}. **${task.action}**${task.ownerType ? ` [${task.ownerType}]` : ""}`);
        if (task.details) parts.push(`   ${task.details}`);
        if (task.doneWhen) parts.push(`   Done when: ${task.doneWhen}`);
        if (task.files?.length) parts.push(`   Files: ${task.files.join(", ")}`);
      }
      if (phase.outputs?.length) parts.push(`Outputs: ${phase.outputs.join(", ")}`);
    }
  } else {
    parts.push("");
    for (const step of plan.steps) {
      parts.push(`${step.step}. **${step.action}**${step.ownerType ? ` [${step.ownerType}]` : ""}`);
      if (step.details) parts.push(`   ${step.details}`);
      if (step.doneWhen) parts.push(`   Done when: ${step.doneWhen}`);
      if (step.files?.length) parts.push(`   Files: ${step.files.join(", ")}`);
    }
  }

  parts.push("", "Follow this plan. Complete each step in order.");
  return parts.join("\n");
}

/** Render risks section */
export function buildRiskSection(plan: IssuePlan): string {
  if (!plan.risks?.length) return "";
  const parts = ["## Risks"];
  for (const r of plan.risks) {
    parts.push(`- **${r.risk}** — Impact: ${r.impact}. Mitigation: ${r.mitigation}`);
  }
  return parts.join("\n");
}

export function normalizeAcceptanceCriteria(plan: IssuePlan): AcceptanceCriterion[] {
  return plan.acceptanceCriteria.map((criterion, index) => ({
    id: criterion.id || `AC-${index + 1}`,
    description: criterion.description,
    category: criterion.category,
    verificationMethod: criterion.verificationMethod,
    evidenceExpected: criterion.evidenceExpected,
    blocking: criterion.blocking,
    weight: criterion.weight,
  }));
}

export function deriveExecutionContract(plan: IssuePlan): ExecutionContract {
  const ec = plan.executionContract;
  return {
    summary: ec.summary,
    deliverables: Array.isArray(ec.deliverables) ? ec.deliverables.slice() : [],
    requiredChecks: Array.isArray(ec.requiredChecks) ? ec.requiredChecks.slice() : [],
    requiredEvidence: Array.isArray(ec.requiredEvidence) ? ec.requiredEvidence.slice() : [],
    focusAreas: Array.isArray(ec.focusAreas) ? ec.focusAreas.slice() : [],
    checkpointPolicy: ec.checkpointPolicy === "checkpointed" ? "checkpointed" : "final_only",
    blueprintId: ec.blueprintId,
    delegationPolicy: ec.delegationPolicy,
    budgetPolicy: ec.budgetPolicy,
  };
}

/** Render validation requirements */
export function buildValidationSection(plan: IssuePlan): string {
  const parts: string[] = [];
  const acceptanceCriteria = normalizeAcceptanceCriteria(plan);
  const executionContract = deriveExecutionContract(plan);

  if (acceptanceCriteria.length) {
    parts.push("## Acceptance Criteria");
    acceptanceCriteria.forEach((criterion) => {
      parts.push(`- **${criterion.id}** [${criterion.category}]${criterion.blocking ? " blocking" : " advisory"} — ${criterion.description}`);
      parts.push(`  Verify via: ${criterion.verificationMethod}`);
      parts.push(`  Evidence expected: ${criterion.evidenceExpected}`);
      parts.push(`  Weight: ${criterion.weight}`);
    });
  }
  if (plan.validation?.length) {
    parts.push("", "## Validation Checks");
    parts.push("Run these before marking as done:");
    plan.validation.forEach((v) => parts.push(`- ${v}`));
  }
  if (plan.deliverables?.length) {
    parts.push("", "## Deliverables");
    plan.deliverables.forEach((d) => parts.push(`- ${d}`));
  }
  parts.push("", "## Execution Contract");
  parts.push(`Summary: ${executionContract.summary}`);
  parts.push(`Checkpoint policy: ${executionContract.checkpointPolicy}`);
  if (executionContract.blueprintId) parts.push(`Blueprint: ${executionContract.blueprintId}`);
  if (executionContract.focusAreas.length) parts.push(`Focus areas: ${executionContract.focusAreas.join(", ")}`);
  if (executionContract.delegationPolicy) {
    parts.push(`Delegation policy: ${executionContract.delegationPolicy.mode} (max fanout ${executionContract.delegationPolicy.maxFanout})`);
  }
  if (executionContract.budgetPolicy) {
    parts.push(`Budget policy: local retries=${executionContract.budgetPolicy.maxLocalRetries}, remote rounds=${executionContract.budgetPolicy.maxRemoteRounds}, wall clock=${executionContract.budgetPolicy.maxWallClockMinutes}m`);
  }
  if (executionContract.requiredChecks.length) {
    parts.push("Required checks:");
    executionContract.requiredChecks.forEach((check) => parts.push(`- ${check}`));
  }
  if (executionContract.requiredEvidence.length) {
    parts.push("Required evidence:");
    executionContract.requiredEvidence.forEach((evidence) => parts.push(`- ${evidence}`));
  }

  return parts.join("\n");
}

/** Render suggested skills and agents */
export function buildToolingSection(plan: IssuePlan): string {
  const skills = plan.suggestedSkills ?? [];
  const agents = plan.suggestedAgents ?? [];
  if (skills.length === 0 && agents.length === 0) return "";

  const parts = ["## Recommended Skills & Agents"];

  if (skills.length > 0) {
    parts.push("", "**Skills to activate:**");
    skills.forEach((s) => parts.push(`- ${s}`));
  }

  if (agents.length > 0) {
    parts.push("", "**Agents to use:**");
    agents.forEach((a) => parts.push(`- ${a}`));
  }

  return parts.join("\n");
}

/** Render execution strategy */
export function buildStrategySection(plan: IssuePlan): string {
  const es = plan.executionStrategy;
  if (!es) return "";

  const parts = [
    "## Execution Strategy",
    "",
    `**Approach:** ${es.approach}`,
    `**Rationale:** ${es.whyThisApproach}`,
  ];

  if (es.alternativesConsidered?.length) {
    parts.push("", "Alternatives considered:");
    es.alternativesConsidered.forEach((a) => parts.push(`- ${a}`));
  }

  return parts.join("\n");
}

/** Resolve effort for a given role */
export function resolveEffortForProvider(
  plan: IssuePlan | undefined,
  role: AgentProviderRole,
  globalEffort?: EffortConfig,
): string | undefined {
  const planEffort = plan?.suggestedEffort;
  const roleKey = role as keyof EffortConfig;
  return planEffort?.[roleKey] as string
    || planEffort?.default as string
    || globalEffort?.[roleKey] as string
    || globalEffort?.default as string
    || undefined;
}

/** Build the complete plan section for any provider */
export function buildFullPlanPrompt(plan: IssuePlan): string {
  return [
    buildPlanContextSection(plan),
    buildStrategySection(plan),
    buildToolingSection(plan),
    buildStepsSection(plan),
    buildRiskSection(plan),
    buildValidationSection(plan),
  ].filter(Boolean).join("\n\n");
}

/** Extract validation commands from plan for hooks */
export function extractValidationCommands(plan: IssuePlan): { pre: string[]; post: string[] } {
  const pre: string[] = [];
  const post: string[] = [];

  for (const v of plan.validation || []) {
    const lower = v.toLowerCase();
    if (lower.includes("lint")) post.push("pnpm lint --quiet 2>/dev/null || true");
    if (lower.includes("typecheck") || lower.includes("tsc")) post.push("pnpm tsc --noEmit 2>/dev/null || true");
    if (lower.includes("test")) post.push("pnpm test 2>/dev/null || true");
  }

  // Deduplicate
  return { pre: [...new Set(pre)], post: [...new Set(post)] };
}

// ── Execution Payload ─────────────────────────────────────────────────────────

/**
 * Canonical structured input for CLI execution.
 * This is the single source of truth that the prompt references.
 * The prompt provides the markdown frame (instructions, role, strategy);
 * the payload carries the structured data (plan, constraints, criteria).
 */
export type ExecutionPayload = {
  /** Schema version for forward compat */
  version: 1;

  /** Issue identity */
  issue: {
    id: string;
    identifier: string;
    title: string;
    description: string;
    labels: string[];
    paths: string[];
  };

  /** Provider context */
  provider: {
    name: string;
    role: AgentProviderRole;
    model: string;
    effort: string;
    overlays: string[];
  };

  /** Execution intent — what to do and how */
  executionIntent: {
    complexity: string;
    harnessMode: string;
    approach: string;
    rationale: string;
    workPattern: "sequential" | "phased" | "parallel_subtasks";
  };

  /** Structured plan data */
  plan: {
    summary: string;
    steps: Array<{
      step: number;
      action: string;
      files: string[];
      ownerType: string;
      doneWhen: string;
    }>;
    phases: Array<{
      name: string;
      goal: string;
      tasks: number[];
      dependencies: string[];
      outputs: string[];
    }>;
  };

  /** Constraints the agent must respect */
  constraints: string[];

  /** Structured acceptance criteria — each must be graded with evidence */
  acceptanceCriteria: Array<{
    id: string;
    description: string;
    category: string;
    verificationMethod: string;
    evidenceExpected: string;
    blocking: boolean;
    weight: number;
  }>;

  /** Validation commands to run before reporting done */
  validation: string[];

  /** Expected deliverables */
  deliverables: string[];

  /** Canonical execution contract shared by executor and reviewer */
  executionContract: ExecutionContract;

  /** Assumptions the plan is built on */
  assumptions: string[];

  /** Unknowns that may need resolution */
  unknowns: Array<{ question: string; whyItMatters: string; howToResolve: string }>;

  /** Risks with impact and mitigation */
  risks: Array<{ risk: string; impact: string; mitigation: string }>;

  /** Tooling decisions */
  tooling: {
    skills: Array<{ name: string; why: string }>;
    subagents: Array<{ name: string; role: string; why: string }>;
  };

  /** Target paths for focused changes */
  targetPaths: string[];

  /** Workspace location */
  workspacePath: string;

  /** Timestamp */
  createdAt: string;
};

// ── Image handling ───────────────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/**
 * Build a markdown section with base64-embedded images.
 * Used by adapters whose CLI has no `--image` flag (e.g. Gemini).
 * For CLIs with native image flags (Claude, Codex), use command-level flags instead.
 */
export function buildImagePromptSection(imagePaths: string[]): string {
  const validPaths = imagePaths.filter((p) => existsSync(p));
  if (validPaths.length === 0) return "";

  const parts: string[] = ["## Attached Images", ""];
  for (const imgPath of validPaths) {
    const ext = extname(imgPath).toLowerCase();
    const mime = MIME_MAP[ext] || "image/png";
    const name = basename(imgPath);
    try {
      const data = readFileSync(imgPath).toString("base64");
      parts.push(`### ${name}`);
      parts.push(`![${name}](data:${mime};base64,${data})`);
      parts.push("");
    } catch {
      // Skip unreadable images
    }
  }
  return parts.length > 2 ? parts.join("\n") : "";
}

/**
 * Build the canonical execution payload from issue + plan + provider context.
 */
export function buildExecutionPayload(
  issue: IssueEntry,
  provider: AgentProviderDefinition,
  plan: IssuePlan,
  workspacePath: string,
): ExecutionPayload {
  const strategy = plan.executionStrategy;
  const hasPhases = Boolean(plan.phases?.length);
  const acceptanceCriteria = normalizeAcceptanceCriteria(plan);
  const executionContract = deriveExecutionContract(plan);

  return {
    version: 1,

    issue: {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description || "",
      labels: issue.labels || [],
      paths: issue.paths || [],
    },

    provider: {
      name: provider.provider,
      role: provider.role,
      model: provider.model || "default",
      effort: provider.reasoningEffort || "medium",
      overlays: provider.overlays || [],
    },

    executionIntent: {
      complexity: plan.estimatedComplexity,
      harnessMode: plan.harnessMode,
      approach: strategy?.approach || "",
      rationale: strategy?.whyThisApproach || "",
      workPattern: hasPhases ? "phased" : "sequential",
    },

    plan: {
      summary: plan.summary,
      steps: plan.steps.map((s) => ({
        step: s.step,
        action: s.action,
        files: s.files || [],
        ownerType: s.ownerType || "agent",
        doneWhen: s.doneWhen || "",
      })),
      phases: (plan.phases || []).map((p) => ({
        name: p.phaseName,
        goal: p.goal,
        tasks: p.tasks.map((t) => t.step),
        dependencies: p.dependencies || [],
        outputs: p.outputs || [],
      })),
    },

    constraints: plan.constraints || [],
    acceptanceCriteria,
    validation: plan.validation || [],
    deliverables: plan.deliverables || [],
    executionContract,
    assumptions: plan.assumptions || [],
    unknowns: (plan.unknowns || []).map((u) => ({
      question: u.question,
      whyItMatters: u.whyItMatters || "",
      howToResolve: u.howToResolve || "",
    })),
    risks: (plan.risks || []).map((r) => ({
      risk: r.risk,
      impact: r.impact || "",
      mitigation: r.mitigation || "",
    })),

    tooling: {
      skills: (plan.suggestedSkills || []).map((name) => ({
        name,
        why: "Suggested by the planner for this issue.",
      })),
      subagents: (plan.suggestedAgents || []).map((name) => ({
        name,
        role: "specialist",
        why: "Suggested by the planner for parallel or specialized work.",
      })),
    },

    targetPaths: plan.suggestedPaths || [],
    workspacePath,
    createdAt: new Date().toISOString(),
  };
}
