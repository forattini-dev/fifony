import type { RuntimeState } from "../types.ts";
import type { RouteRegistrar } from "./http.ts";
import { STATE_ROOT } from "../concerns/constants.ts";
import { logger } from "../concerns/logger.ts";
import { listServiceStatuses } from "../domains/services.ts";
import {
  getTrafficBuffer,
  getServiceGraph,
  getTrafficProxyPort,
  getTrafficProxyStats,
  isTrafficProxyRunning,
  startTrafficProxy,
  stopTrafficProxy,
  setServicesAccessor,
} from "../persistence/plugins/traffic-proxy-server.ts";
import { sendToMeshRoom } from "./websocket.ts";

const MESH_VAR_KEYS = ["HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy"];

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

  // ── POST /api/mesh/toggle ──────────────────────────────────────
  // Enable or disable the mesh proxy at runtime
  collector.post("/api/mesh/toggle", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const enabled = body.enabled === true;

    // Persist the setting
    const { persistSetting } = await import("../persistence/settings.js");
    await persistSetting("runtime.meshEnabled", enabled, { scope: "runtime", source: "user" });
    state.config.meshEnabled = enabled;

    if (enabled && !isTrafficProxyRunning()) {
      try {
        setServicesAccessor(() => listServiceStatuses(state.config.services ?? [], STATE_ROOT));
        const port = await startTrafficProxy({
          port: state.config.meshProxyPort ?? 0,
          bufferSize: state.config.meshBufferSize ?? 1000,
          onEntry: (entry) => sendToMeshRoom({ type: "mesh:entry", entry }),
        });
        // Inject HTTP_PROXY as global env vars so all services pick it up automatically
        const dashPort = Number(state.config.dashboardPort ?? 4000);
        const proxyUrl = `http://localhost:${port}`;
        const noProxy = `localhost:${dashPort}`;
        const vars = state.variables ?? [];
        const ts = new Date().toISOString();
        const globalVars: Record<string, string> = {
          HTTP_PROXY: proxyUrl, http_proxy: proxyUrl,
          NO_PROXY: noProxy, no_proxy: noProxy,
        };
        for (const [key, value] of Object.entries(globalVars)) {
          const id = `global:${key}`;
          const idx = vars.findIndex((v) => v.id === id);
          const entry = { id, key, value, scope: "global" as const, updatedAt: ts };
          if (idx >= 0) vars[idx] = entry;
          else vars.push(entry);
        }
        state.variables = vars;
        logger.info({ port }, "[Mesh] Proxy started + global env vars injected");
        return c.json({ ok: true, running: true, port });
      } catch (err) {
        logger.error({ err }, "[Mesh] Failed to start proxy");
        return c.json({ ok: false, error: String(err) }, 500);
      }
    }

    if (!enabled && isTrafficProxyRunning()) {
      await stopTrafficProxy();
      // Remove mesh-related global env vars
      state.variables = (state.variables ?? []).filter(
        (v) => v.scope !== "global" || !MESH_VAR_KEYS.includes(v.key),
      );
      logger.info("[Mesh] Proxy stopped + global env vars removed");
    }

    return c.json({ ok: true, running: isTrafficProxyRunning(), port: getTrafficProxyPort() });
  });
}
