import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  pickEmbeddingProviderConfig,
  resolveEmbeddingModelCacheDir,
  seedLocalEmbeddingCacheFromLegacy,
} from "../src/agents/embedding-provider.ts";

describe("pickEmbeddingProviderConfig", () => {
  it("defaults to the local open-source model when nothing is configured", () => {
    const config = pickEmbeddingProviderConfig({});
    assert.ok(config);
    assert.equal(config.kind, "local");
    assert.equal(config.model, DEFAULT_LOCAL_EMBEDDING_MODEL);
    assert.equal(config.dimensions, 384);
  });

  it("uses remote config in auto mode when baseUrl and model are provided", () => {
    const config = pickEmbeddingProviderConfig({
      strategy: "auto",
      baseUrl: "https://example.test/v1/",
      model: "text-embedding-3-small",
      apiKey: "secret",
      dimensions: 384,
    });
    assert.ok(config);
    assert.equal(config.kind, "remote");
    assert.equal(config.baseUrl, "https://example.test/v1");
    assert.equal(config.model, "text-embedding-3-small");
  });

  it("disables embeddings entirely when disabled strategy is selected", () => {
    const config = pickEmbeddingProviderConfig({ strategy: "disabled" });
    assert.equal(config, null);
  });

  it("falls back to local when remote strategy is incomplete", () => {
    const config = pickEmbeddingProviderConfig({
      strategy: "remote",
      baseUrl: "",
      model: "",
    });
    assert.ok(config);
    assert.equal(config.kind, "local");
    assert.equal(config.model, DEFAULT_LOCAL_EMBEDDING_MODEL);
  });
});

describe("seedLocalEmbeddingCacheFromLegacy", () => {
  it("copies an existing legacy model into the shared cache location", () => {
    const root = mkdtempSync(join(tmpdir(), "fifony-embed-test-"));
    const cacheDir = join(root, "global-cache");
    const legacyCacheDir = join(root, "legacy-cache");
    const legacyModelDir = resolveEmbeddingModelCacheDir(legacyCacheDir, DEFAULT_LOCAL_EMBEDDING_MODEL);
    mkdirSync(legacyModelDir, { recursive: true });
    writeFileSync(join(legacyModelDir, "config.json"), "{}");

    const result = seedLocalEmbeddingCacheFromLegacy(DEFAULT_LOCAL_EMBEDDING_MODEL, {
      cacheDir,
      legacyCacheDir,
    });

    assert.equal(result, "migrated");
    assert.equal(existsSync(join(resolveEmbeddingModelCacheDir(cacheDir, DEFAULT_LOCAL_EMBEDDING_MODEL), "config.json")), true);
  });

  it("does not recopy when the shared cache already has the model", () => {
    const root = mkdtempSync(join(tmpdir(), "fifony-embed-test-"));
    const cacheDir = join(root, "global-cache");
    const legacyCacheDir = join(root, "legacy-cache");
    const cachedModelDir = resolveEmbeddingModelCacheDir(cacheDir, DEFAULT_LOCAL_EMBEDDING_MODEL);
    mkdirSync(cachedModelDir, { recursive: true });
    writeFileSync(join(cachedModelDir, "config.json"), "{}");

    const result = seedLocalEmbeddingCacheFromLegacy(DEFAULT_LOCAL_EMBEDDING_MODEL, {
      cacheDir,
      legacyCacheDir,
    });

    assert.equal(result, "existing");
  });
});
