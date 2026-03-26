import type {
  IssueEntry,
  AgentProviderDefinition,
  ProviderCapabilities,
  RuntimeConfig,
  IssuePlan,
} from "../../types.ts";
import type { CompiledExecution } from "./types.ts";

/** Normalized options passed to every provider's buildCommand. */
export type ProviderCommandOptions = {
  model?: string;
  effort?: string;
  addDirs?: string[];
  /** Images to attach — passed via CLI flag (codex --image) or embedded in prompt (claude/gemini) */
  imagePaths?: string[];
  /** JSON schema for structured output (claude --json-schema) */
  jsonSchema?: string;
  /** Disable tool access — for planning runs where tools break --json-schema (claude only) */
  noToolAccess?: boolean;
  /** Maximum dollar budget for the run (claude --max-budget-usd) */
  maxBudgetUsd?: number;
  /** Read-only mode — disables file edits (claude --permission-mode plan, gemini --approval-mode plan) */
  readOnly?: boolean;
  /** Enable web search (codex --search) */
  search?: boolean;
};

export type ProviderAdapter = {
  /** Declared runtime capabilities for this provider. */
  capabilities: ProviderCapabilities;
  /** Build the CLI command string for execution/planning */
  buildCommand(options: ProviderCommandOptions): string;
  /** Build the CLI command string for review */
  buildReviewCommand(reviewer: AgentProviderDefinition, config?: RuntimeConfig): string;
  /** Compile full execution payload for the provider */
  compile(
    issue: IssueEntry,
    provider: AgentProviderDefinition,
    plan: IssuePlan,
    config: RuntimeConfig,
    workspacePath: string,
    skillContext: string,
    capabilitiesManifest?: string,
  ): Promise<CompiledExecution>;
};

import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";
import { geminiAdapter } from "./gemini.ts";

export const ADAPTERS: Record<string, ProviderAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
};

const UNSUPPORTED_CAPABILITIES: ProviderCapabilities = {
  readOnlyExecution: "none",
  structuredOutput: {
    mode: "none",
    requiresToolDisable: false,
  },
  imageInput: "none",
  usageReporting: "none",
  nativeSubagents: "runtime-only",
};

export function getProviderAdapter(provider: string): ProviderAdapter | null {
  return ADAPTERS[provider] ?? null;
}

export function getProviderCapabilities(
  provider: string,
  overrides?: ProviderCapabilities | null,
): ProviderCapabilities {
  if (overrides) return overrides;
  return ADAPTERS[provider]?.capabilities ?? UNSUPPORTED_CAPABILITIES;
}

export function supportsReadOnlyExecution(capabilities: ProviderCapabilities): boolean {
  return capabilities.readOnlyExecution !== "none";
}

export function usesNativeStructuredOutput(capabilities: ProviderCapabilities): boolean {
  return capabilities.structuredOutput.mode === "json-schema";
}

export function shouldDisableToolsForStructuredOutput(capabilities: ProviderCapabilities): boolean {
  return capabilities.structuredOutput.requiresToolDisable;
}

export function usesCliImageInput(capabilities: ProviderCapabilities): boolean {
  return capabilities.imageInput === "cli-flag";
}

export function supportsNativeSubagents(capabilities: ProviderCapabilities): boolean {
  return capabilities.nativeSubagents === "native";
}

export function describeProviderCapabilityWarnings(provider: string, capabilities: ProviderCapabilities): string[] {
  const warnings: string[] = [];

  if (!supportsReadOnlyExecution(capabilities)) {
    warnings.push(`${provider} does not expose CLI-enforced read-only execution; planner/reviewer runs fall back to prompt/runtime discipline.`);
  }

  if (!usesNativeStructuredOutput(capabilities)) {
    warnings.push(`${provider} does not expose native JSON schema enforcement; structured output falls back to prompt-contract parsing.`);
  }

  if (!supportsNativeSubagents(capabilities)) {
    warnings.push(`${provider} does not expose native subagents; delegation will use Fifony runtime orchestration instead.`);
  }

  if (capabilities.usageReporting === "none") {
    warnings.push(`${provider} does not expose usage reporting; provider budget telemetry may be incomplete.`);
  }

  return warnings;
}
