import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerMilestoneRoutes } from "../src/routes/projects.ts";
import { buildRuntimeState, createIssueFromPayload } from "../src/domains/issues.ts";
import { deriveConfig } from "../src/domains/config.ts";
import type { ApiRouteContext, RouteHandler, RouteRegistrar } from "../src/routes/http.ts";

function createRouteCollector(): RouteRegistrar & { routes: Map<string, RouteHandler> } {
  const routes = new Map<string, RouteHandler>();
  const register = (method: string) => (path: string, handler: RouteHandler) => {
    routes.set(`${method} ${path}`, handler);
  };

  return {
    routes,
    get: register("GET"),
    post: register("POST"),
    put: register("PUT"),
    patch: register("PATCH"),
    delete: register("DELETE"),
  };
}

function createJsonContext(
  params: Record<string, string> = {},
  body: unknown = {},
): ApiRouteContext {
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
    json(payload: unknown, status = 200) {
      return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
    body(payload: unknown, status = 200, headers = {}) {
      return new Response(payload as BodyInit | null, { status, headers });
    },
  };
}

async function readJson(response: Response): Promise<any> {
  return await response.json();
}

describe("milestone routes", () => {
  it("creates a milestone and exposes the generated summary fields", async () => {
    const state = buildRuntimeState(null, deriveConfig([]));
    const app = createRouteCollector();
    registerMilestoneRoutes(app, state);

    const handler = app.routes.get("POST /api/milestones");
    assert.ok(handler, "milestone creation route should be registered");

    const response = await handler!(
      createJsonContext({}, {
        name: "Core Platform",
        description: "Track core delivery work",
        status: "active",
      }),
    );
    const payload = await readJson(response);

    assert.equal(response.status, 201);
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

    const app = createRouteCollector();
    registerMilestoneRoutes(app, state);
    const handler = app.routes.get("POST /api/issues/:id/milestone");
    assert.ok(handler, "issue milestone assignment route should be registered");

    const response = await handler!(
      createJsonContext({ id: "issue-1" }, { milestoneId: "milestone-b" }),
    );
    const payload = await readJson(response);

    assert.equal(response.status, 200);
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

    const app = createRouteCollector();
    registerMilestoneRoutes(app, state);
    const handler = app.routes.get("DELETE /api/milestones/:id");
    assert.ok(handler, "milestone delete route should be registered");

    const response = await handler!(createJsonContext({ id: "milestone-core" }));
    const payload = await readJson(response);

    assert.equal(response.status, 409);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /linked issues/i);
    assert.equal(state.milestones.length, 1);
  });
});
