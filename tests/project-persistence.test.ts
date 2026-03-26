import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("milestone persistence", () => {
  it("persists milestone records and reloads them from the milestones resource", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "fifony-milestone-store-"));
    const workspaceRoot = join(tempRoot, "workspace");
    const persistenceRoot = join(tempRoot, ".fifony");
    mkdirSync(workspaceRoot, { recursive: true });
    mkdirSync(persistenceRoot, { recursive: true });

    const previousEnv = {
      FIFONY_WORKSPACE_ROOT: process.env.FIFONY_WORKSPACE_ROOT,
      FIFONY_PERSISTENCE: process.env.FIFONY_PERSISTENCE,
      FIFONY_BOOTSTRAP_ROOT: process.env.FIFONY_BOOTSTRAP_ROOT,
    };

    process.env.FIFONY_WORKSPACE_ROOT = workspaceRoot;
    process.env.FIFONY_PERSISTENCE = persistenceRoot;
    process.env.FIFONY_BOOTSTRAP_ROOT = persistenceRoot;

    let closeStateStore: (() => Promise<void>) | null = null;

    try {
      const store = await import("../src/persistence/store.ts");
      const { buildRuntimeState } = await import("../src/domains/issues.ts");
      const { deriveConfig } = await import("../src/domains/config.ts");

      closeStateStore = store.closeStateStore;

      await store.initStateStore();

      const state = buildRuntimeState(null, deriveConfig([]));
      state.milestones = [
        {
          id: "milestone-core",
          slug: "core",
          name: "Core Platform",
          description: "Local-first planning",
          status: "active",
          createdAt: "2026-03-25T00:00:00.000Z",
          updatedAt: "2026-03-25T00:00:00.000Z",
          progress: { scopeCount: 0, completedCount: 0, progressPercent: 0 },
          issueCount: 0,
        },
      ];

      store.markMilestoneDirty("milestone-core");
      await store.persistState(state);
      await store.closeStateStore();

      await store.initStateStore();
      const reloaded = await store.loadPersistedMilestones();

      assert.equal(reloaded.length, 1);
      assert.deepEqual(reloaded[0], {
        id: "milestone-core",
        slug: "core",
        name: "Core Platform",
        description: "Local-first planning",
        status: "active",
        createdAt: "2026-03-25T00:00:00.000Z",
        updatedAt: "2026-03-25T00:00:00.000Z",
        progress: { scopeCount: 0, completedCount: 0, progressPercent: 0 },
        issueCount: 0,
      });
    } finally {
      if (closeStateStore) {
        await closeStateStore().catch(() => {});
      }

      if (previousEnv.FIFONY_WORKSPACE_ROOT === undefined) delete process.env.FIFONY_WORKSPACE_ROOT;
      else process.env.FIFONY_WORKSPACE_ROOT = previousEnv.FIFONY_WORKSPACE_ROOT;

      if (previousEnv.FIFONY_PERSISTENCE === undefined) delete process.env.FIFONY_PERSISTENCE;
      else process.env.FIFONY_PERSISTENCE = previousEnv.FIFONY_PERSISTENCE;

      if (previousEnv.FIFONY_BOOTSTRAP_ROOT === undefined) delete process.env.FIFONY_BOOTSTRAP_ROOT;
      else process.env.FIFONY_BOOTSTRAP_ROOT = previousEnv.FIFONY_BOOTSTRAP_ROOT;

      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
