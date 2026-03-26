import type { AgentTokenUsage, ProviderCapabilities, ReviewProfile, ReviewScope } from "../../types.ts";
import type { ExecutionPayload } from "./shared.ts";

export type CompiledExecution = {
  prompt: string;
  command: string;
  env: Record<string, string>;
  preHooks: string[];
  postHooks: string[];
  outputSchema: string;
  payload: ExecutionPayload | null;
  meta: {
    adapter: "claude" | "codex" | "gemini" | "passthrough";
    reasoningEffort: string;
    model: string;
    providerCapabilities: ProviderCapabilities;
    skillsActivated: string[];
    subagentsRequested: string[];
    phasesCount: number;
  };
};

export type CompiledReview = {
  prompt: string;
  command: string;
  meta: {
    scope: ReviewScope;
    reviewProfile: ReviewProfile;
  };
};

export type CompiledContractNegotiation = {
  prompt: string;
  command: string;
  meta: {
    reviewProfile: ReviewProfile;
    round: number;
    maxRounds: number;
  };
};

export type ExecutionAudit = {
  runtime: string;
  model: string;
  effort: string;
  role: string;
  skillsActivated: string[];
  subagentsRequested: string[];
  durationMs: number;
  tokenUsage: AgentTokenUsage | null;
  diffStats: { filesChanged: number; linesAdded: number; linesRemoved: number } | null;
  result: string;
  compiledAt: string;
  completedAt: string;
};
