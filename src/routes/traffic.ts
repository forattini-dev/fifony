import type { RuntimeState } from "../types.ts";
import type { RouteRegistrar } from "./http.ts";
import { STATE_ROOT } from "../concerns/constants.ts";
import { listServiceStatuses } from "../domains/services.ts";
import {
  getTrafficBuffer,
  getServiceGraph,
  getTrafficProxyPort,
  getTrafficProxyStats,
  isTrafficProxyRunning,
} from "../persistence/plugins/traffic-proxy-server.ts";

export function registerTrafficRoutes(
  collector: RouteRegistrar,
  state: RuntimeState,
): void {
  // ── GET /api/mesh ──────────────────────────────────────────────
  // Returns the full service graph (nodes + edges)
  collector.get("/api/mesh", (c) => {
    const graph = getServiceGraph();
    if (!graph) return c.json({ ok: false, error: "Mesh proxy not running" }, 503);
    const entries = state.config.services ?? [];
    const services = listServiceStatuses(entries, STATE_ROOT);
    return c.json({ ok: true, graph: graph.getGraph(services) });
  });

  // ── GET /api/mesh/traffic ──────────────────────────────────────
  // Returns recent traffic entries from the ring buffer
  collector.get("/api/mesh/traffic", (c) => {
    const buf = getTrafficBuffer();
    if (!buf) return c.json({ ok: false, error: "Mesh proxy not running" }, 503);
    const limit = Number(c.req.query("limit") ?? 100);
    return c.json({ ok: true, entries: buf.getRecent(limit) });
  });

  // ── GET /api/mesh/stats ────────────────────────────────────────
  // Returns proxy stats (connections, bytes, errors)
  collector.get("/api/mesh/stats", (c) => {
    const stats = getTrafficProxyStats();
    if (!stats) return c.json({ ok: false, error: "Mesh proxy not running" }, 503);
    return c.json({ ok: true, stats });
  });

  // ── POST /api/mesh/clear ───────────────────────────────────────
  // Resets the ring buffer and graph accumulator
  collector.post("/api/mesh/clear", (c) => {
    getTrafficBuffer()?.clear();
    getServiceGraph()?.reset();
    return c.json({ ok: true });
  });

  // ── GET /api/mesh/status ───────────────────────────────────────
  // Returns mesh proxy status
  collector.get("/api/mesh/status", (c) => {
    return c.json({
      ok: true,
      enabled: state.config.meshEnabled ?? false,
      running: isTrafficProxyRunning(),
      port: getTrafficProxyPort(),
    });
  });
}
