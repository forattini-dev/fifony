import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  AgentProviderDefinition,
  AgentProviderRole,
  DetectedProvider,
  EffortConfig,
  IssueEntry,
  JsonRecord,
  ReasoningEffort,
  ReviewProfileName,
  RuntimeState,
  WorkflowConfig,
} from "../types.ts";
import { TARGET_ROOT } from "../concerns/constants.ts";
import {
  toStringValue,
  getNestedRecord,
  getNestedString,
} from "../concerns/helpers.ts";
import { deriveReviewProfile } from "./review-profile.ts";
import { buildReviewRouteKey, recommendReviewRouteForIssue } from "./harness-policy.ts";

export function resolveAgentProfile(name: string): { profilePath: string; instructions: string } {
  const normalized = name.trim();
  if (!normalized) return { profilePath: "", instructions: "" };

  const candidates = [
    join(TARGET_ROOT, ".codex", "agents", `${normalized}.md`),
    join(TARGET_ROOT, ".codex", "agents", normalized, "AGENT.md"),
    join(TARGET_ROOT, "agents", `${normalized}.md`),
    join(TARGET_ROOT, "agents", normalized, "AGENT.md"),
    join(homedir(), ".codex", "agents", `${normalized}.md`),
    join(homedir(), ".codex", "agents", normalized, "AGENT.md"),
    join(homedir(), ".claude", "agents", `${normalized}.md`),
    join(homedir(), ".claude", "agents", normalized, "AGENT.md"),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    return {
      profilePath: candidate,
      instructions: readFileSync(candidate, "utf8").trim(),
    };
  }

  return { profilePath: "", instructions: "" };
}

export function normalizeAgentProvider(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "claude" || normalized === "codex" || normalized === "gemini") return normalized;
  if (!normalized) return "codex";
  return normalized;
}

export function normalizeAgentRole(value: string): AgentProviderRole {
  const normalized = value.trim().toLowerCase();
  if (normalized === "planner" || normalized === "executor" || normalized === "reviewer") {
    return normalized;
  }
  return "executor";
}

export function resolveProviderCapabilities(
  provider: string,
  overrides?: AgentProviderDefinition["capabilities"],
) {
  return getProviderCapabilities(provider, overrides ?? null);
}

export function getProviderCapabilityWarnings(
  provider: string,
  overrides?: AgentProviderDefinition["capabilities"],
): string[] {
  return describeProviderCapabilityWarnings(provider, resolveProviderCapabilities(provider, overrides));
}

export function resolveAgentCommand(
  provider: string,
  explicitCommand: string,
  codexCommand: string,
  claudeCommand: string,
  reasoningEffort?: string,
): string {
  if (explicitCommand.trim()) return explicitCommand.trim();
  if (provider === "claude" && claudeCommand.trim()) return claudeCommand.trim();
  if (provider === "codex" && codexCommand.trim()) return codexCommand.trim();
  return getProviderDefaultCommand(provider, reasoningEffort);
}

/** Resolve the effective reasoning effort for a given role, considering issue override and global defaults. */
export function resolveEffort(
  role: string,
  issueEffort?: EffortConfig,
  globalEffort?: EffortConfig,
): ReasoningEffort | undefined {
  // Issue-level per-role override takes highest priority
  const roleKey = role as keyof EffortConfig;
  if (issueEffort?.[roleKey]) return issueEffort[roleKey];
  // Issue-level default
  if (issueEffort?.default) return issueEffort.default;
  // Global per-role
  if (globalEffort?.[roleKey]) return globalEffort[roleKey];
  // Global default
  return globalEffort?.default;
}

import {
  ADAPTERS,
  describeProviderCapabilityWarnings,
  getProviderCapabilities,
  usesNativeStructuredOutput,
} from "./adapters/registry.ts";
import { CLAUDE_RESULT_SCHEMA } from "./adapters/commands.ts";

export function getProviderDefaultCommand(provider: string, reasoningEffort?: string, model?: string): string {
  const adapter = ADAPTERS[provider];
  if (!adapter) return "";
  const capabilities = resolveProviderCapabilities(provider);
  const jsonSchema = usesNativeStructuredOutput(capabilities) ? CLAUDE_RESULT_SCHEMA : undefined;
  return adapter.buildCommand({ model, effort: reasoningEffort, jsonSchema });
}

let cachedProviders: DetectedProvider[] | null = null;
let providersCachedAt = 0;
const PROVIDER_CACHE_TTL = 60_000;

export function detectAvailableProviders(): DetectedProvider[] {
  if (cachedProviders && Date.now() - providersCachedAt < PROVIDER_CACHE_TTL) {
    return cachedProviders;
  }

  const providers: DetectedProvider[] = [];

  for (const name of ["claude", "codex", "gemini"]) {
    const capabilities = resolveProviderCapabilities(name);
    try {
      const path = execFileSync("which", [name], { encoding: "utf8", timeout: 5000 }).trim();
      providers.push({ name, available: true, path, capabilities });
    } catch {
      providers.push({ name, available: false, path: "", capabilities });
    }
  }

  cachedProviders = providers;
  providersCachedAt = Date.now();
  return providers;
}

export function invalidateProviderCache(): void {
  cachedProviders = null;
  providersCachedAt = 0;
}

// ── Model discovery (delegated to model-discovery.ts) ────────────────────────

export type { DiscoveredModel } from "./model-discovery.ts";
export { discoverModels } from "./model-discovery.ts";

export function readCodexConfig(): { model?: string; reasoningEffort?: string } {
  try {
    const configPath = join(homedir(), ".codex", "config.toml");
    if (!existsSync(configPath)) return {};
    const raw = readFileSync(configPath, "utf8");
    const model = raw.match(/^model\s*=\s*"([^"]+)"/m)?.[1];
    const reasoningEffort = raw.match(/^model_reasoning_effort\s*=\s*"([^"]+)"/m)?.[1];
    return { model, reasoningEffort };
  } catch {
    return {};
  }
}

export function readGeminiConfig(): { model?: string; previewFeatures?: boolean } {
  try {
    const settingsPath = join(homedir(), ".gemini", "settings.json");
    if (!existsSync(settingsPath)) return {};
    const raw = readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(raw) as {
      model?: string;
      general?: { previewFeatures?: boolean };
    };
    return {
      model: typeof settings.model === "string" ? settings.model : undefined,
      previewFeatures: settings.general?.previewFeatures === true,
    };
  } catch {
    return {};
  }
}

export function readClaudeConfig(): { model?: string } {
  try {
    const settingsPath = join(homedir(), ".claude", "settings.json");
    if (!existsSync(settingsPath)) return {};
    const raw = readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(raw) as { model?: string };
    return {
      model: typeof settings.model === "string" ? settings.model : undefined,
    };
  } catch {
    return {};
  }
}

export function resolveDefaultProvider(detected: DetectedProvider[]): string {
  const available = detected.filter((p) => p.available);
  if (available.length === 0) return "";
  if (available.some((p) => p.name === "codex")) return "codex";
  return available[0].name;
}

export function resolveWorkflowAgentProviders(
  config: JsonRecord,
  fallbackProvider: string,
  fallbackProfile: string,
  explicitCommand: string,
): AgentProviderDefinition[] {
  const agentConfig = getNestedRecord(config, "agent");
  const codexConfig = getNestedRecord(config, "codex");
  const claudeConfig = getNestedRecord(config, "claude");
  const providersRaw = (agentConfig.providers ?? []) as unknown;
  const providers: AgentProviderDefinition[] = [];

  if (Array.isArray(providersRaw)) {
    for (const entry of providersRaw) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const record = entry as JsonRecord;
      const provider = normalizeAgentProvider(
        toStringValue(record.provider) || toStringValue(record.name) || fallbackProvider,
      );
      const role = normalizeAgentRole(toStringValue(record.role, "executor"));
      const profile = toStringValue(record.profile, role === "executor" ? fallbackProfile : "");
      const resolvedProfile = resolveAgentProfile(profile);
      const command = resolveAgentCommand(
        provider,
        toStringValue(record.command),
        getNestedString(codexConfig, "command"),
        getNestedString(claudeConfig, "command"),
      );

      providers.push({
        provider,
        role,
        command,
        profile,
        profilePath: resolvedProfile.profilePath,
        profileInstructions: resolvedProfile.instructions,
        capabilities: resolveProviderCapabilities(provider),
      });
    }
  }

  if (providers.length > 0) return providers;

  const resolvedProfile = resolveAgentProfile(fallbackProfile);
  return [
    {
      provider: fallbackProvider,
      role: "executor",
      command: resolveAgentCommand(
        fallbackProvider,
        explicitCommand,
        getNestedString(codexConfig, "command"),
        getNestedString(claudeConfig, "command"),
      ),
      profile: fallbackProfile,
      profilePath: resolvedProfile.profilePath,
      profileInstructions: resolvedProfile.instructions,
      capabilities: resolveProviderCapabilities(fallbackProvider),
    },
  ];
}

export function getBaseAgentProviders(
  state: RuntimeState,
): AgentProviderDefinition[] {
  return [
    {
      provider: state.config.agentProvider,
      role: "executor",
      command: state.config.agentCommand,
      profile: "",
      profilePath: "",
      profileInstructions: "",
      capabilities: resolveProviderCapabilities(state.config.agentProvider),
    },
  ];
}

type AgentStage = "plan" | "execute" | "review";

const EFFORT_ORDER: ReasoningEffort[] = ["low", "medium", "high", "extra-high"];

const REVIEW_PROFILE_MIN_EFFORT: Record<ReviewProfileName, ReasoningEffort> = {
  "general-quality": "medium",
  "ui-polish": "high",
  "workflow-fsm": "high",
  "integration-safety": "high",
  "api-contract": "high",
  "security-hardening": "extra-high",
};

const REVIEW_PROFILE_OVERLAYS: Record<ReviewProfileName, string[]> = {
  "general-quality": [],
  "ui-polish": ["impeccable", "frontend-design"],
  "workflow-fsm": ["workflow-audit"],
  "integration-safety": ["integration-safety"],
  "api-contract": ["api-contract"],
  "security-hardening": ["security-hardening"],
};

function maxEffort(left?: ReasoningEffort, right?: ReasoningEffort): ReasoningEffort | undefined {
  if (!left) return right;
  if (!right) return left;
  return EFFORT_ORDER[Math.max(EFFORT_ORDER.indexOf(left), EFFORT_ORDER.indexOf(right))] ?? left;
}

function stageToRole(stage: AgentStage): AgentProviderRole {
  if (stage === "plan") return "planner";
  if (stage === "review") return "reviewer";
  return "executor";
}


function buildStageProvider(
  state: RuntimeState,
  issue: IssueEntry,
  stage: AgentStage,
  workflowConfig?: WorkflowConfig | null,
): AgentProviderDefinition {
  const role = stageToRole(stage);
  const stageConfig = workflowConfig?.[roleToStageKey(stageToRole(stage))];
  const effort = stageConfig?.effort || resolveEffort(role, issue.effort, state.config.defaultEffort);
  const providerName = stageConfig?.provider || state.config.agentProvider;
  const model = stageConfig?.model || undefined;
  const command = stageConfig
    ? getProviderDefaultCommand(providerName, effort, model)
    : stage === "execute"
      ? resolveAgentCommand(providerName, state.config.agentCommand, "", "", effort)
      : getProviderDefaultCommand(providerName, effort, model);

  return {
    provider: providerName,
    role,
    command,
    model,
    profile: "",
    profilePath: "",
    profileInstructions: "",
    reasoningEffort: effort,
    selectionReason: stageConfig
      ? `Using workflow ${stage} stage configuration.`
      : `Using default ${stage} stage provider configuration.`,
    overlays: [],
    capabilities: resolveProviderCapabilities(providerName),
  };
}

function specializeReviewerProvider(baseProvider: AgentProviderDefinition, issue: IssueEntry): AgentProviderDefinition {
  const reviewProfile = issue.reviewProfile ?? deriveReviewProfile(issue);
  const minEffort = REVIEW_PROFILE_MIN_EFFORT[reviewProfile.primary];
  const reasoningEffort = maxEffort(baseProvider.reasoningEffort, minEffort);
  const overlays = [...new Set([...(baseProvider.overlays ?? []), ...REVIEW_PROFILE_OVERLAYS[reviewProfile.primary]])];
  const command = getProviderDefaultCommand(baseProvider.provider, reasoningEffort, baseProvider.model) || baseProvider.command;

  return {
    ...baseProvider,
    command,
    reasoningEffort,
    overlays,
    selectionReason: `Reviewer specialized for ${reviewProfile.primary}; raised scrutiny with ${reasoningEffort ?? "default"} effort.`,
  };
}

function resolveSynchronousProviderModel(provider: string, workflowConfig?: WorkflowConfig | null): string | undefined {
  const stages = workflowConfig ? [workflowConfig.review, workflowConfig.execute, workflowConfig.plan] : [];
  const fromWorkflow = stages.find((stage) => stage?.provider === provider)?.model;
  if (fromWorkflow) return fromWorkflow;
  if (provider === "codex") return readCodexConfig().model;
  if (provider === "gemini") return readGeminiConfig().model;
  if (provider === "claude") return readClaudeConfig().model;
  return undefined;
}

function buildAdaptiveReviewCandidates(
  baseProvider: AgentProviderDefinition,
  workflowConfig?: WorkflowConfig | null,
): AgentProviderDefinition[] {
  const availableProviders = detectAvailableProviders()
    .filter((provider) => provider.available)
    .map((provider) => provider.name);
  const candidates = new Map<string, AgentProviderDefinition>();
  const addCandidate = (providerName: string, reason: string) => {
    const model = resolveSynchronousProviderModel(providerName, workflowConfig ?? null);
    const command = getProviderDefaultCommand(providerName, baseProvider.reasoningEffort, model) || baseProvider.command;
    const candidate: AgentProviderDefinition = {
      ...baseProvider,
      provider: providerName,
      model,
      command,
      selectionReason: reason,
      capabilities: resolveProviderCapabilities(providerName),
    };
    candidates.set(buildReviewRouteKey(candidate), candidate);
  };

  addCandidate(baseProvider.provider, baseProvider.selectionReason || "Configured review route.");

  for (const providerName of availableProviders) {
    if (providerName === baseProvider.provider) continue;
    addCandidate(providerName, `Adaptive routing candidate using available ${providerName} reviewer.`);
  }

  return [...candidates.values()];
}

function adaptReviewerProvider(
  state: RuntimeState,
  issue: IssueEntry,
  baseProvider: AgentProviderDefinition,
  workflowConfig?: WorkflowConfig | null,
): AgentProviderDefinition {
  if (state.config.adaptiveReviewRouting === false) return baseProvider;

  const candidates = buildAdaptiveReviewCandidates(baseProvider, workflowConfig ?? null);
  const recommendation = recommendReviewRouteForIssue(
    state.issues,
    issue,
    candidates,
    state.config.adaptivePolicyMinSamples ?? 3,
  );
  if (!recommendation) return baseProvider;

  return {
    ...recommendation.candidate,
    selectionReason: `${recommendation.rationale} ${baseProvider.selectionReason ?? ""}`.trim(),
  };
}

/** Map AgentProviderRole to WorkflowConfig stage key */
function roleToStageKey(role: AgentProviderRole): keyof WorkflowConfig {
  switch (role) {
    case "planner": return "plan";
    case "executor": return "execute";
    case "reviewer": return "review";
  }
}

/**
 * Apply user's WorkflowConfig (from Settings → Workflow) to provider definitions.
 * Overrides provider, model, and effort for each role when a WorkflowConfig is present.
 */
export function applyWorkflowConfigToProviders(
  providers: AgentProviderDefinition[],
  workflowConfig: WorkflowConfig | null,
): AgentProviderDefinition[] {
  if (!workflowConfig) return providers;

  return providers.map((provider) => {
    const stageKey = roleToStageKey(provider.role);
    const stageConfig = workflowConfig[stageKey] as
      | { provider?: string; model?: string; effort?: ReasoningEffort }
      | undefined;
    if (!stageConfig) return provider;

    const newProvider = stageConfig.provider || provider.provider;
    const newModel = stageConfig.model || undefined;
    const newEffort = stageConfig.effort || provider.reasoningEffort;

    // Rebuild command with the configured provider, model, and effort
    const command = getProviderDefaultCommand(newProvider, newEffort, newModel);

    return {
      ...provider,
      provider: newProvider,
      model: newModel,
      command: command || provider.command,
      reasoningEffort: newEffort,
      capabilities: resolveProviderCapabilities(newProvider),
    };
  });
}

export function getExecutionProviders(
  state: RuntimeState,
  issue: IssueEntry,
  workflowConfig?: WorkflowConfig | null,
): AgentProviderDefinition[] {
  return [buildStageProvider(state, issue, "execute", workflowConfig ?? null)];
}

export function getReviewProvider(
  state: RuntimeState,
  issue: IssueEntry,
  workflowConfig?: WorkflowConfig | null,
): AgentProviderDefinition {
  const specialized = specializeReviewerProvider(buildStageProvider(state, issue, "review", workflowConfig ?? null), issue);
  return adaptReviewerProvider(state, issue, specialized, workflowConfig ?? null);
}

export function getSessionProvidersForIssue(
  state: RuntimeState,
  issue: IssueEntry,
  workflowConfig?: WorkflowConfig | null,
): AgentProviderDefinition[] {
  return [
    ...getExecutionProviders(state, issue, workflowConfig ?? null),
    getReviewProvider(state, issue, workflowConfig ?? null),
  ];
}

export function getEffectiveAgentProviders(
  state: RuntimeState,
  issue: IssueEntry,
  workflowDefinitionOrConfig?: WorkflowConfig | null,
  workflowConfig?: WorkflowConfig | null,
): AgentProviderDefinition[] {
  const effectiveWorkflowConfig = workflowConfig ?? workflowDefinitionOrConfig ?? null;
  return getSessionProvidersForIssue(state, issue, effectiveWorkflowConfig);
}
