import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { DetectedProvider } from "../types.ts";
import { readClaudeConfig, readCodexConfig, readGeminiConfig } from "./providers.ts";

// ── Model discovery ─────────────────────────────────────────────────────────

export type DiscoveredModel = {
  id: string;
  provider: string;
  label: string;
  tier: string;
};

/** Cache: { models, fetchedAt } per provider */
const modelCache = new Map<string, { models: DiscoveredModel[]; fetchedAt: number }>();
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes


function resolveGeminiModelsFile(): string | null {
  try {
    const binPath = execFileSync("which", ["gemini"], { encoding: "utf8", timeout: 3000 }).trim();
    if (!binPath) return null;
    const realBin = realpathSync(binPath);
    const cliRoot = dirname(dirname(realBin));
    const modelsPath = join(cliRoot, "node_modules", "@google", "gemini-cli-core", "dist", "src", "config", "models.js");
    return existsSync(modelsPath) ? modelsPath : null;
  } catch {
    return null;
  }
}

export async function fetchGeminiModels(): Promise<DiscoveredModel[]> {
  const modelsPath = resolveGeminiModelsFile();
  if (!modelsPath) return [];

  try {
    const content = readFileSync(modelsPath, "utf8");
    const regex = /export const ([A-Z0-9_]+)\s*=\s*'(gemini-[^']+)';/g;
    const seen = new Set<string>();
    const stable: DiscoveredModel[] = [];
    const preview: DiscoveredModel[] = [];

    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const [, constName, modelId] = match;
      if (seen.has(modelId)) continue;
      if (modelId.includes("embedding")) continue;
      seen.add(modelId);

      const isPreview = constName.startsWith("PREVIEW_");
      const tier = isPreview ? "Preview" : "Stable";
      const model: DiscoveredModel = { id: modelId, provider: "gemini", label: modelId, tier };
      if (isPreview) preview.push(model);
      else stable.push(model);
    }

    return [...stable, ...preview];
  } catch {
    return [];
  }
}

export async function fetchCodexModels(): Promise<DiscoveredModel[]> {
  const cachePath = join(homedir(), ".codex", "models_cache.json");
  try {
    if (existsSync(cachePath)) {
      const raw = readFileSync(cachePath, "utf8");
      const cache = JSON.parse(raw) as {
        models?: Array<{
          slug: string;
          display_name?: string;
          description?: string;
          visibility?: string;
          priority?: number;
          supported_reasoning_levels?: Array<{ effort: string; description?: string }>;
        }>;
      };

      if (Array.isArray(cache.models) && cache.models.length > 0) {
        return cache.models
          .sort((a, b) => {
            const visA = a.visibility === "list" ? 0 : 1;
            const visB = b.visibility === "list" ? 0 : 1;
            if (visA !== visB) return visA - visB;
            return (a.priority ?? 99) - (b.priority ?? 99);
          })
          .map((m) => ({
            id: m.slug,
            provider: "codex",
            label: m.slug,
            tier: m.description || (m.visibility === "list" ? "Supported" : "Legacy"),
          }));
      }
    }
  } catch {
    // Cache unreadable
  }

  return [];
}

export async function fetchAnthropicModels(): Promise<DiscoveredModel[]> {
  try {
    execFileSync("which", ["claude"], { encoding: "utf8", timeout: 3000 });
  } catch {
    return [];
  }

  return [
    { id: "opus",   provider: "claude", label: "claude/opus (latest)",   tier: "Most capable" },
    { id: "sonnet", provider: "claude", label: "claude/sonnet (latest)",  tier: "Balanced" },
    { id: "haiku",  provider: "claude", label: "claude/haiku (latest)",   tier: "Fast" },
  ];
}

export async function discoverModels(providers: DetectedProvider[]): Promise<Record<string, DiscoveredModel[]>> {
  const result: Record<string, DiscoveredModel[]> = {};

  const tasks: Array<{ name: string; fetch: () => Promise<DiscoveredModel[]> }> = [];

  for (const p of providers) {
    if (!p.available) continue;
    const cached = modelCache.get(p.name);
    if (cached && Date.now() - cached.fetchedAt < MODEL_CACHE_TTL_MS) {
      result[p.name] = cached.models;
      continue;
    }
    if (p.name === "codex") tasks.push({ name: "codex", fetch: fetchCodexModels });
    if (p.name === "claude") tasks.push({ name: "claude", fetch: fetchAnthropicModels });
    if (p.name === "gemini") tasks.push({ name: "gemini", fetch: fetchGeminiModels });
  }

  const settled = await Promise.allSettled(tasks.map((t) => t.fetch()));
  for (let i = 0; i < tasks.length; i++) {
    const res = settled[i];
    let models = res.status === "fulfilled" ? res.value : [];

    if (tasks[i].name === "codex") {
      const { model: configuredModel } = readCodexConfig();
      if (configuredModel) {
        const idx = models.findIndex((m) => m.id === configuredModel);
        if (idx > 0) {
          models = [models[idx], ...models.slice(0, idx), ...models.slice(idx + 1)];
        } else if (idx === -1) {
          models = [{ id: configuredModel, provider: "codex", label: configuredModel, tier: "Configured default" }, ...models];
        }
      }
    }

    if (tasks[i].name === "claude") {
      const { model: configuredModel } = readClaudeConfig();
      if (configuredModel) {
        const idx = models.findIndex((m) => m.id === configuredModel || m.id.includes(configuredModel));
        if (idx > 0) {
          models = [models[idx], ...models.slice(0, idx), ...models.slice(idx + 1)];
        }
      }
    }

    if (tasks[i].name === "gemini") {
      const { model: configuredModel, previewFeatures } = readGeminiConfig();
      if (configuredModel) {
        const idx = models.findIndex((m) => m.id === configuredModel);
        if (idx > 0) {
          models = [models[idx], ...models.slice(0, idx), ...models.slice(idx + 1)];
        } else if (idx === -1) {
          models = [{ id: configuredModel, provider: "gemini", label: configuredModel, tier: "Configured default" }, ...models];
        }
      } else if (previewFeatures) {
        const previewIdx = models.findIndex((m) => m.tier === "Preview");
        if (previewIdx > 0) {
          models = [models[previewIdx], ...models.slice(0, previewIdx), ...models.slice(previewIdx + 1)];
        }
      }
    }

    result[tasks[i].name] = models;
    modelCache.set(tasks[i].name, { models, fetchedAt: Date.now() });
  }

  return result;
}
