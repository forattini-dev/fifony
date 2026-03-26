import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { env as processEnv } from "node:process";
import {
  EMBEDDING_LOCAL_CACHE_DIR,
  EMBEDDING_VECTOR_DIMENSIONS,
  LEGACY_WORKSPACE_EMBEDDING_CACHE_DIR,
} from "../concerns/constants.ts";
import { logger } from "../concerns/logger.ts";
import { loadRuntimeSettings } from "../persistence/settings.ts";

const SETTING_ID_EMBEDDINGS_STRATEGY = "providers.embeddings.strategy";
const SETTING_ID_EMBEDDINGS_LOCAL_MODEL = "providers.embeddings.localModel";
const SETTING_ID_EMBEDDINGS_BASE_URL = "providers.embeddings.baseUrl";
const SETTING_ID_EMBEDDINGS_API_KEY = "providers.embeddings.apiKey";
const SETTING_ID_EMBEDDINGS_MODEL = "providers.embeddings.model";
const SETTING_ID_EMBEDDINGS_DIMENSIONS = "providers.embeddings.dimensions";

export const DEFAULT_EMBEDDING_STRATEGY = "auto";
export const DEFAULT_LOCAL_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

export type EmbeddingStrategy = "auto" | "local" | "remote" | "disabled";

export type EmbeddingProviderConfig = {
  kind: "local" | "remote";
  strategy: EmbeddingStrategy;
  model: string;
  dimensions: number;
  baseUrl?: string;
  apiKey?: string;
};

export type EmbeddingProvider = {
  config: EmbeddingProviderConfig;
  embedTexts: (texts: string[]) => Promise<number[][]>;
};

export type EmbeddingWarmupResult = {
  kind: "disabled" | "local" | "remote";
  model?: string;
  cacheDir?: string;
  source?: "existing-cache" | "migrated-legacy-cache" | "downloaded";
};

type RawEmbeddingSettings = {
  strategy?: string;
  localModel?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  dimensions?: number | null;
};

type FeatureExtractionOutput = {
  data?: Float32Array | number[];
};

type FeatureExtractionPipeline = (
  input: string,
  options?: Record<string, unknown>,
) => Promise<FeatureExtractionOutput>;

type LocalCacheSeedResult = "existing" | "migrated" | "missing";

function readStringSetting(settings: Array<{ id: string; value: unknown }>, id: string): string {
  const entry = settings.find((item) => item.id === id);
  return typeof entry?.value === "string" ? entry.value.trim() : "";
}

function readNumberSetting(settings: Array<{ id: string; value: unknown }>, id: string): number | null {
  const entry = settings.find((item) => item.id === id);
  const value = typeof entry?.value === "number" ? entry.value : Number.parseInt(String(entry?.value ?? ""), 10);
  return Number.isFinite(value) ? value : null;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeStrategy(value: string): EmbeddingStrategy {
  return value === "local" || value === "remote" || value === "disabled" ? value : DEFAULT_EMBEDDING_STRATEGY;
}

function resolveDimensions(rawValue: number | null | undefined): number {
  if (rawValue == null) return EMBEDDING_VECTOR_DIMENSIONS;
  if (rawValue !== EMBEDDING_VECTOR_DIMENSIONS) {
    logger.warn(
      { requestedDimensions: rawValue, expectedDimensions: EMBEDDING_VECTOR_DIMENSIONS },
      "[Embeddings] Ignoring mismatched embedding dimensions; store is fixed to the configured vector size",
    );
  }
  return EMBEDDING_VECTOR_DIMENSIONS;
}

export function pickEmbeddingProviderConfig(raw: RawEmbeddingSettings): EmbeddingProviderConfig | null {
  const strategy = normalizeStrategy(String(raw.strategy || processEnv.FIFONY_EMBEDDINGS_STRATEGY || ""));
  const envDimensions = Number.parseInt(processEnv.FIFONY_EMBEDDINGS_DIMENSIONS || "", 10);
  const dimensions = resolveDimensions(raw.dimensions ?? (Number.isFinite(envDimensions) ? envDimensions : null));
  const localModel = (raw.localModel || processEnv.FIFONY_EMBEDDINGS_LOCAL_MODEL || DEFAULT_LOCAL_EMBEDDING_MODEL).trim();
  const baseUrl = normalizeBaseUrl((raw.baseUrl || processEnv.FIFONY_EMBEDDINGS_BASE_URL || "").trim());
  const model = (raw.model || processEnv.FIFONY_EMBEDDINGS_MODEL || "").trim();
  const apiKey = (raw.apiKey || processEnv.FIFONY_EMBEDDINGS_API_KEY || "").trim() || undefined;
  const remoteConfigured = Boolean(baseUrl && model);

  if (strategy === "disabled") {
    return null;
  }

  if (strategy === "remote" && remoteConfigured) {
    return { kind: "remote", strategy, baseUrl, apiKey, model, dimensions };
  }

  if (strategy === "remote" && !remoteConfigured) {
    logger.warn("[Embeddings] Remote strategy requested without complete config; falling back to local default embeddings");
    return { kind: "local", strategy, model: localModel, dimensions };
  }

  if (strategy === "local") {
    return { kind: "local", strategy, model: localModel, dimensions };
  }

  if (remoteConfigured) {
    return { kind: "remote", strategy, baseUrl, apiKey, model, dimensions };
  }

  return { kind: "local", strategy, model: localModel, dimensions };
}

export function resolveEmbeddingModelCacheDir(cacheDir: string, model: string): string {
  const segments = model.split("/").map((part) => part.trim()).filter(Boolean);
  return join(cacheDir, ...segments);
}

export function seedLocalEmbeddingCacheFromLegacy(
  model: string,
  options: {
    cacheDir?: string;
    legacyCacheDir?: string;
  } = {},
): LocalCacheSeedResult {
  const cacheDir = options.cacheDir || EMBEDDING_LOCAL_CACHE_DIR;
  const legacyCacheDir = options.legacyCacheDir || LEGACY_WORKSPACE_EMBEDDING_CACHE_DIR;
  const currentModelDir = resolveEmbeddingModelCacheDir(cacheDir, model);

  if (existsSync(currentModelDir)) {
    return "existing";
  }

  if (!legacyCacheDir || legacyCacheDir === cacheDir) {
    return "missing";
  }

  const legacyModelDir = resolveEmbeddingModelCacheDir(legacyCacheDir, model);
  if (!existsSync(legacyModelDir)) {
    return "missing";
  }

  mkdirSync(dirname(currentModelDir), { recursive: true });
  cpSync(legacyModelDir, currentModelDir, {
    recursive: true,
    errorOnExist: false,
    force: false,
  });
  return "migrated";
}

async function resolveEmbeddingProviderConfig(): Promise<EmbeddingProviderConfig | null> {
  try {
    const settings = await loadRuntimeSettings();
    return pickEmbeddingProviderConfig({
      strategy: readStringSetting(settings, SETTING_ID_EMBEDDINGS_STRATEGY),
      localModel: readStringSetting(settings, SETTING_ID_EMBEDDINGS_LOCAL_MODEL),
      baseUrl: readStringSetting(settings, SETTING_ID_EMBEDDINGS_BASE_URL),
      model: readStringSetting(settings, SETTING_ID_EMBEDDINGS_MODEL),
      apiKey: readStringSetting(settings, SETTING_ID_EMBEDDINGS_API_KEY),
      dimensions: readNumberSetting(settings, SETTING_ID_EMBEDDINGS_DIMENSIONS),
    });
  } catch (error) {
    logger.warn({ err: error }, "[Embeddings] Failed to resolve embedding provider config, falling back to local default");
    return pickEmbeddingProviderConfig({});
  }
}

async function embedTextsOpenAICompatible(config: EmbeddingProviderConfig, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const response = await fetch(`${config.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      input: texts,
      dimensions: config.dimensions,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Embedding request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const payload = await response.json() as {
    data?: Array<{ embedding?: number[] }>;
  };

  const vectors = Array.isArray(payload?.data)
    ? payload.data.map((item) => Array.isArray(item?.embedding) ? item.embedding : [])
    : [];

  if (vectors.length !== texts.length) {
    throw new Error(`Embedding response length mismatch: expected ${texts.length}, got ${vectors.length}`);
  }

  for (const vector of vectors) {
    if (vector.length !== config.dimensions) {
      throw new Error(`Embedding dimensions mismatch: expected ${config.dimensions}, got ${vector.length}`);
    }
  }

  return vectors;
}

const localExtractorPromises = new Map<string, Promise<FeatureExtractionPipeline>>();

async function getLocalFeatureExtractor(model: string): Promise<FeatureExtractionPipeline> {
  const cached = localExtractorPromises.get(model);
  if (cached) return cached;

  const promise = (async () => {
    const cacheSeed = seedLocalEmbeddingCacheFromLegacy(model);
    if (cacheSeed === "migrated") {
      logger.info(
        {
          model,
          from: LEGACY_WORKSPACE_EMBEDDING_CACHE_DIR,
          to: EMBEDDING_LOCAL_CACHE_DIR,
        },
        "[Embeddings] Migrated local embedding cache into the shared Fifony cache",
      );
    }
    const { pipeline, env } = await import("@huggingface/transformers");
    mkdirSync(EMBEDDING_LOCAL_CACHE_DIR, { recursive: true });
    env.cacheDir = EMBEDDING_LOCAL_CACHE_DIR;
    env.allowLocalModels = true;
    env.allowRemoteModels = true;
    return await pipeline("feature-extraction", model) as FeatureExtractionPipeline;
  })();

  localExtractorPromises.set(model, promise);
  return promise;
}

async function embedTextsLocally(config: EmbeddingProviderConfig, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getLocalFeatureExtractor(config.model);
  const vectors: number[][] = [];

  for (const text of texts) {
    const output = await extractor(text, {
      pooling: "mean",
      normalize: true,
    });
    const vector = Array.from(output?.data || []);
    if (vector.length !== config.dimensions) {
      throw new Error(`Local embedding dimensions mismatch for ${config.model}: expected ${config.dimensions}, got ${vector.length}`);
    }
    vectors.push(vector);
  }

  return vectors;
}

export async function warmEmbeddingProvider(): Promise<EmbeddingWarmupResult> {
  const config = await resolveEmbeddingProviderConfig();
  if (!config) {
    return { kind: "disabled" };
  }

  if (config.kind === "remote") {
    return { kind: "remote", model: config.model };
  }

  const cacheSeed = seedLocalEmbeddingCacheFromLegacy(config.model);
  await embedTextsLocally(config, ["fifony embedding warmup"]);
  return {
    kind: "local",
    model: config.model,
    cacheDir: EMBEDDING_LOCAL_CACHE_DIR,
    source: cacheSeed === "existing"
      ? "existing-cache"
      : cacheSeed === "migrated"
      ? "migrated-legacy-cache"
      : "downloaded",
  };
}

export async function getEmbeddingProvider(): Promise<EmbeddingProvider | null> {
  const config = await resolveEmbeddingProviderConfig();
  if (!config) return null;

  if (config.kind === "remote") {
    return {
      config,
      embedTexts: async (texts: string[]) => embedTextsOpenAICompatible(config, texts),
    };
  }

  return {
    config,
    embedTexts: async (texts: string[]) => embedTextsLocally(config, texts),
  };
}
