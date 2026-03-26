import type { IssueEntry, RuntimeMetrics, RuntimeState } from "../types.ts";
import { isoWeek, now } from "../concerns/helpers.ts";
import { logger } from "../concerns/logger.ts";
import { persistState } from "../persistence/store.ts";
import { addEvent, computeMetrics } from "../domains/issues.ts";
import type { RouteRegistrar } from "./http.ts";
import { detectAvailableProviders } from "../agents/providers.ts";
import { analyzeParallelizability } from "../persistence/plugins/scheduler.ts";
import {
  getIssueStateMachineVisualization,
  getIssueStateMachineTransitions,
} from "../domains/issue-state.ts";
import {
  collectProviderUsage,
  collectProvidersUsage,
} from "../agents/providers-usage.ts";
import {
  buildProbeResult,
  collectRuntimeHealthSnapshot,
  runDoctorChecks,
} from "../domains/runtime-diagnostics.ts";

type GetStateResult = RuntimeState & {
  metrics: RuntimeMetrics;
  _filter: "all" | "recent";
  _totalIssues: number;
};

function getStateQuery(
  state: RuntimeState,
  showAll = false,
): GetStateResult {
  let issues: IssueEntry[] = state.issues;

  if (!showAll) {
    const thisWeek = isoWeek();
    const lastWeekDate = new Date();
    lastWeekDate.setUTCDate(lastWeekDate.getUTCDate() - 7);
    const lastWeek = isoWeek(lastWeekDate);
    const recentWeeks = new Set([thisWeek, lastWeek]);

    issues = state.issues.filter((i) => {
      if (!i.terminalWeek) return true;
      return recentWeeks.has(i.terminalWeek);
    });
  }

  return {
    ...state,
    issues,
    metrics: computeMetrics(issues),
    _filter: showAll ? "all" : "recent",
    _totalIssues: state.issues.length,
  };
}

export function registerStateRoutes(
  app: RouteRegistrar,
  state: RuntimeState,
): void {
  app.get("/api/state", async (c) => {
    const showAll = c.req.query("all") === "1";
    return c.json(getStateQuery(state, showAll));
  });

  app.get("/api/status", async (c) =>
    c.json({
      status: "ok",
      updatedAt: state.updatedAt,
      config: state.config,
      trackerKind: state.trackerKind,
      health: collectRuntimeHealthSnapshot(state),
    }),
  );

  app.get("/api/runtime/status", async (c) =>
    c.json({
      ok: true,
      snapshot: collectRuntimeHealthSnapshot(state),
    }),
  );

  app.get("/api/runtime/probe", async (c) =>
    c.json(buildProbeResult(state)),
  );

  app.get("/api/runtime/doctor", async (c) =>
    c.json({
      ok: true,
      generatedAt: now(),
      checks: runDoctorChecks(state),
    }),
  );

  app.get("/api/providers", async (c) => {
    const providers = detectAvailableProviders();
    return c.json({ providers });
  });

  app.get("/api/parallelism", async (c) => {
    return c.json(analyzeParallelizability(state.issues));
  });

  // RESTful: /api/providers/:slug/usage
  app.get("/api/providers/:slug/usage", async (c) => {
    const provider = c.req.param("slug") || "";
    try {
      const usage = await collectProviderUsage(provider);
      return c.json({
        providers: usage ? [usage] : [],
        collectedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ err: error, provider }, "Failed to collect provider usage");
      return c.json({ providers: [] }, 500);
    }
  });

  // Aggregate: /api/providers/usage (all providers)
  app.get("/api/providers/usage", async (c) => {
    try {
      const usage = await collectProvidersUsage();
      return c.json(usage);
    } catch (error) {
      logger.error({ err: error }, "Failed to collect providers usage");
      return c.json({ providers: [] }, 500);
    }
  });

  // NOTE: create, state, retry, cancel routes live in issues.resource.ts (s3db resource routes).
  // They have priority over collector routes. Do NOT duplicate them here.

  app.get("/api/state-machine/transitions", async (c) => {
    try {
      return c.json({ ok: true, transitions: getIssueStateMachineTransitions() });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.get("/api/state-machine/visualize", async (c) => {
    try {
      const dot = getIssueStateMachineVisualization();
      if (!dot) return c.json({ ok: false, error: "Visualization not available." }, 404);
      return c.json({ ok: true, dot });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/refresh", async (c) => {
    addEvent(state, undefined, "manual", "Manual refresh requested via API.");
    await persistState(state);
    return c.json({ queued: true, requestedAt: now() }, 202);
  });
}
