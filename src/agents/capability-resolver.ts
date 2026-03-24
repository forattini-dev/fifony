import {
  type DiscoveredAgent,
  type DiscoveredCommand,
  type DiscoveredSkill,
  discoverAgents,
  discoverCommands,
  discoverSkills,
} from "./skills.ts";
import {
  type CapabilityContext,
  inferCapabilityDomains,
  normalizeCapabilityContext,
} from "../shared/capability-domains.ts";
export { inferCapabilityDomains } from "../shared/capability-domains.ts";
export type { CapabilityContext } from "../shared/capability-domains.ts";

export type CapabilityMatch = {
  name: string;
  description?: string;
  score: number;
  why: string;
};

export type CapabilityResolution = {
  detectedDomains: string[];
  context: {
    title: string;
    description: string;
    paths: string[];
  };
  available: {
    agents: number;
    skills: number;
    commands: number;
  };
  suggestedAgents: CapabilityMatch[];
  suggestedSkills: CapabilityMatch[];
  suggestedCommands: CapabilityMatch[];
};

export type CapabilitiesSnapshot = {
  available: {
    agents: number;
    skills: number;
    commands: number;
  };
  agents: Array<Pick<DiscoveredAgent, "name" | "description" | "whenToUse" | "avoidIf">>;
  skills: Array<Pick<DiscoveredSkill, "name" | "description" | "whenToUse" | "avoidIf">>;
  commands: DiscoveredCommand[];
};

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  frontend: ["frontend", "ui", "ux", "design", "react", "css", "html", "tailwind", "accessibility"],
  backend: ["backend", "api", "server", "route", "endpoint", "service", "handler"],
  database: ["database", "db", "sql", "migration", "schema", "query", "sqlite", "postgres"],
  devops: ["devops", "deploy", "infra", "docker", "kubernetes", "terraform", "ci", "pipeline"],
  security: ["security", "auth", "permission", "secret", "oauth", "jwt", "token"],
  testing: ["test", "testing", "coverage", "playwright", "jest", "vitest", "cypress"],
  mobile: ["mobile", "ios", "android", "react-native", "swift", "kotlin"],
  "ai-ml": ["ai", "ml", "llm", "model", "embedding", "prompt", "rag"],
  docs: ["docs", "documentation", "readme", "guide", "markdown", "writer"],
};

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "into", "this", "that", "issue", "task", "work",
  "file", "files", "path", "paths", "need", "needs", "make", "update", "fix", "bug",
  "app", "src", "lib", "page", "pages", "component", "components",
]);

const WORKSPACE_ONLY_DISCOVERY = { includeHome: false } as const;

function tokenize(value: string): string[] {
  return [...new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  )];
}

function buildWhy(matchedDomains: string[], matchedTokens: string[]): string {
  const reasons: string[] = [];
  if (matchedDomains.length > 0) reasons.push(`matched ${matchedDomains.join(", ")}`);
  if (matchedTokens.length > 0) reasons.push(`keywords: ${matchedTokens.join(", ")}`);
  return reasons.length > 0 ? reasons.join(" • ") : "general workspace match";
}

function scoreCapability(
  metadata: string,
  contextTokens: string[],
  detectedDomains: string[],
): { score: number; why: string } {
  const metadataLower = metadata.toLowerCase();
  const matchedDomains = detectedDomains.filter((domain) =>
    (DOMAIN_KEYWORDS[domain] || []).some((keyword) => metadataLower.includes(keyword)),
  );
  const matchedTokens = contextTokens.filter((token) => metadataLower.includes(token)).slice(0, 4);
  const score = matchedDomains.length * 4 + matchedTokens.length;
  return {
    score,
    why: buildWhy(matchedDomains, matchedTokens),
  };
}

function rankCapabilities<T extends { name: string }>(
  items: T[],
  metadataOf: (item: T) => string,
  descriptionOf: (item: T) => string | undefined,
  contextTokens: string[],
  detectedDomains: string[],
): CapabilityMatch[] {
  return items
    .map((item) => {
      const { score, why } = scoreCapability(metadataOf(item), contextTokens, detectedDomains);
      return {
        name: item.name,
        description: descriptionOf(item),
        score,
        why,
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 5);
}

export function getCapabilitiesSnapshot(workspacePath: string): CapabilitiesSnapshot {
  const agents = discoverAgents(workspacePath, WORKSPACE_ONLY_DISCOVERY);
  const skills = discoverSkills(workspacePath, WORKSPACE_ONLY_DISCOVERY);
  const commands = discoverCommands(workspacePath, WORKSPACE_ONLY_DISCOVERY);

  return {
    available: {
      agents: agents.length,
      skills: skills.length,
      commands: commands.length,
    },
    agents: agents.map(({ name, description, whenToUse, avoidIf }) => ({ name, description, whenToUse, avoidIf })),
    skills: skills.map(({ name, description, whenToUse, avoidIf }) => ({ name, description, whenToUse, avoidIf })),
    commands,
  };
}

export function resolveCapabilities(workspacePath: string, context: CapabilityContext): CapabilityResolution {
  const normalized = normalizeCapabilityContext(context);
  const detectedDomains = inferCapabilityDomains(normalized);
  const contextTokens = tokenize([normalized.title, normalized.description, ...normalized.paths].join(" "));
  const snapshot = getCapabilitiesSnapshot(workspacePath);
  const agents = discoverAgents(workspacePath, WORKSPACE_ONLY_DISCOVERY);
  const skills = discoverSkills(workspacePath, WORKSPACE_ONLY_DISCOVERY);
  const commands = discoverCommands(workspacePath, WORKSPACE_ONLY_DISCOVERY);

  return {
    detectedDomains,
    context: normalized,
    available: snapshot.available,
    suggestedAgents: rankCapabilities(
      agents,
      (agent) => [agent.name, agent.description, agent.whenToUse, agent.avoidIf].filter(Boolean).join(" "),
      (agent) => agent.description,
      contextTokens,
      detectedDomains,
    ),
    suggestedSkills: rankCapabilities(
      skills,
      (skill) => [skill.name, skill.description, skill.whenToUse, skill.avoidIf].filter(Boolean).join(" "),
      (skill) => skill.description,
      contextTokens,
      detectedDomains,
    ),
    suggestedCommands: rankCapabilities(
      commands,
      (command) => [command.name, command.description].filter(Boolean).join(" "),
      (command) => command.description,
      contextTokens,
      detectedDomains,
    ),
  };
}
