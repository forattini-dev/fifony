import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildRuntimeState, createIssueFromPayload } from "../src/domains/issues.ts";
import { deriveConfig } from "../src/domains/config.ts";
import { setApiRuntimeContext, clearApiRuntimeContext } from "../src/persistence/plugins/api-runtime-context.ts";
import { createMilestone, deleteMilestone } from "../src/persistence/resources/milestones.resource.ts";
import { assignIssueMilestoneForState } from "../src/persistence/resources/issue-milestone.api.ts";

function createJsonContext(
  params: Record<string, string> = {},
  body: unknown = {},
) {
  return {
    req: {
      param(name: string) {
        return params[name];
      },
      query() {
        return undefined;
      },
      async json() {
        return body;
      },
    },
  };
}

afterEach(() => {
  clearApiRuntimeContext();
});

const NOOP_MILESTONE_DEPS = {
  persistState: async () => {},
  deleteMilestoneRecord: async () => {},
};

const NOOP_ISSUE_DEPS = {
  persistState: async () => {},
};

describe("milestone resource api", () => {
  it("creates a milestone and exposes the generated summary fields", async () => {
    const state = buildRuntimeState(null, deriveConfig([]));
    setApiRuntimeContext(state);

    const result = await createMilestone(
      createJsonContext({}, {
        name: "Core Platform",
        description: "Track core delivery work",
        status: "active",
      }),
      NOOP_MILESTONE_DEPS,
    );

    const payload = result.body as { ok: boolean };
    assert.equal(result.status, 201);
    assert.equal(payload.ok, true);
    assert.equal(state.milestones.length, 1);
    assert.equal(state.milestones[0].name, "Core Platform");
    assert.equal(state.milestones[0].slug, "core-platform");
    assert.equal(state.milestones[0].status, "active");
    assert.deepEqual(state.milestones[0].progress, {
      scopeCount: 0,
      completedCount: 0,
      progressPercent: 0,
    });
  });

  it("reassigns an issue between milestones and refreshes both milestone summaries", async () => {
    const state = buildRuntimeState(null, deriveConfig([]));
    state.milestones = [
      {
        id: "milestone-a",
        slug: "milestone-a",
        name: "Milestone A",
        status: "active",
        createdAt: "2026-03-25T00:00:00.000Z",
        updatedAt: "2026-03-25T00:00:00.000Z",
        progress: { scopeCount: 0, completedCount: 0, progressPercent: 0 },
        issueCount: 0,
      },
      {
        id: "milestone-b",
        slug: "milestone-b",
        name: "Milestone B",
        status: "active",
        createdAt: "2026-03-25T00:00:00.000Z",
        updatedAt: "2026-03-25T00:00:00.000Z",
        progress: { scopeCount: 0, completedCount: 0, progressPercent: 0 },
        issueCount: 0,
      },
    ];
    state.issues = [
      createIssueFromPayload({
        id: "issue-1",
        identifier: "#1",
        title: "Move me",
        state: "Queued",
        milestoneId: "milestone-a",
      }, []),
    ];
    setApiRuntimeContext(state);

    const result = await assignIssueMilestoneForState(
      state,
      createJsonContext({ id: "issue-1" }, { milestoneId: "milestone-b" }),
      NOOP_ISSUE_DEPS,
    );

    const payload = result.body as { ok: boolean };
    assert.equal(result.status, undefined);
    assert.equal(payload.ok, true);
    assert.equal(state.issues[0].milestoneId, "milestone-b");
    assert.equal(state.milestones.find((m) => m.id === "milestone-a")?.issueCount, 0);
    assert.equal(state.milestones.find((m) => m.id === "milestone-b")?.issueCount, 1);
    assert.equal(state.milestones.find((m) => m.id === "milestone-b")?.progress.scopeCount, 1);
  });

  it("rejects deleting a milestone that still has linked issues", async () => {
    const state = buildRuntimeState(null, deriveConfig([]));
    state.milestones = [
      {
        id: "milestone-core",
        slug: "milestone-core",
        name: "Milestone Core",
        status: "active",
        createdAt: "2026-03-25T00:00:00.000Z",
        updatedAt: "2026-03-25T00:00:00.000Z",
        progress: { scopeCount: 0, completedCount: 0, progressPercent: 0 },
        issueCount: 0,
      },
    ];
    state.issues = [
      createIssueFromPayload({
        id: "issue-1",
        identifier: "#1",
        title: "Still linked",
        state: "Running",
        milestoneId: "milestone-core",
      }, []),
    ];
    setApiRuntimeContext(state);

    const result = await deleteMilestone(createJsonContext({ id: "milestone-core" }), NOOP_MILESTONE_DEPS);
    const payload = result.body as { ok: boolean; error: string };

    assert.equal(result.status, 409);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /linked issues/i);
    assert.equal(state.milestones.length, 1);
  });
});
