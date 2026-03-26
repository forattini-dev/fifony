import type { RuntimeState, DevServerEntry } from "../types.ts";
import type { RouteRegistrar } from "./http.ts";
import { STATE_ROOT, TARGET_ROOT } from "../concerns/constants.ts";
import { logger } from "../concerns/logger.ts";
import {
  replaceAllDevServers,
  replacePersistedDevServer,
  deletePersistedDevServer,
} from "../persistence/store.ts";
import {
  getDevServerRuntimeStatus,
  listDevServerStatuses,
  startManagedDevServer,
  stopManagedDevServer,
  readDevServerLogTail,
  getManagedDevServerLogPath,
  type DevServerTransition,
} from "../domains/dev-server.ts";
import { broadcastToWebSocketClients } from "./websocket.ts";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

// ── Detection helpers ─────────────────────────────────────────────────────────

type DetectedServer = {
  label: string;
  command: string;
  cwd?: string;
  isRoot: boolean;
};

function detectDevServers(targetRoot: string): DetectedServer[] {
  const suggestions: DetectedServer[] = [];

  // 1. turbo.json → suggest pnpm turbo dev
  if (existsSync(join(targetRoot, "turbo.json"))) {
    suggestions.push({ label: "All (turbo dev)", command: "pnpm turbo dev", isRoot: true });
  }

  // 2. pnpm-workspace.yaml or package.json#workspaces → per-package suggestions
  const pnpmWorkspaceFile = join(targetRoot, "pnpm-workspace.yaml");
  const rootPkgFile = join(targetRoot, "package.json");
  const workspaceParentDirs: string[] = [];

  if (existsSync(pnpmWorkspaceFile)) {
    try {
      const content = readFileSync(pnpmWorkspaceFile, "utf8");
      for (const match of content.matchAll(/^\s+-\s+["']?([^"'\n]+)["']?/gm)) {
        const glob = match[1].trim();
        // Handle "apps/*" → resolve parent "apps/"
        const parent = glob.replace(/\/\*.*$/, "");
        if (parent && !workspaceParentDirs.includes(parent)) {
          workspaceParentDirs.push(parent);
        }
      }
    } catch {}
  } else if (existsSync(rootPkgFile)) {
    try {
      const pkg = JSON.parse(readFileSync(rootPkgFile, "utf8")) as Record<string, unknown>;
      if (Array.isArray(pkg.workspaces)) {
        for (const glob of pkg.workspaces as string[]) {
          const parent = String(glob).replace(/\/\*.*$/, "");
          if (parent && !workspaceParentDirs.includes(parent)) {
            workspaceParentDirs.push(parent);
          }
        }
      }
    } catch {}
  }

  for (const parent of workspaceParentDirs) {
    const parentAbs = join(targetRoot, parent);
    if (!existsSync(parentAbs)) continue;
    try {
      const children = readdirSync(parentAbs, { withFileTypes: true });
      for (const child of children) {
        if (!child.isDirectory()) continue;
        const childPkg = join(parentAbs, child.name, "package.json");
        if (!existsSync(childPkg)) continue;
        try {
          const pkg = JSON.parse(readFileSync(childPkg, "utf8")) as Record<string, unknown>;
          const pkgName = typeof pkg.name === "string" ? pkg.name : child.name;
          const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {};
          const preferred = ["dev", "start", "serve"];
          for (const script of preferred) {
            if (scripts[script]) {
              suggestions.push({
                label: `${pkgName} — ${script}`,
                command: `pnpm --filter ${pkgName} ${script}`,
                cwd: `${parent}/${child.name}`,
                isRoot: false,
              });
              break;
            }
          }
        } catch {}
      }
    } catch {}
  }

  // 3. Root Makefile — grep for dev:/start:/serve: targets
  const makefile = join(targetRoot, "Makefile");
  if (existsSync(makefile)) {
    try {
      const content = readFileSync(makefile, "utf8");
      for (const target of ["dev", "start", "serve"]) {
        if (new RegExp(`^${target}:`, "m").test(content)) {
          suggestions.push({ label: `make ${target}`, command: `make ${target}`, isRoot: true });
          break;
        }
      }
    } catch {}
  }

  // 4. Root package.json scripts (only if no workspace suggestions from it)
  if (workspaceParentDirs.length === 0 && existsSync(rootPkgFile)) {
    try {
      const pkg = JSON.parse(readFileSync(rootPkgFile, "utf8")) as Record<string, unknown>;
      const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {};
      for (const script of ["dev", "start", "serve"]) {
        if (scripts[script]) {
          suggestions.push({ label: `pnpm ${script}`, command: `pnpm ${script}`, isRoot: true });
          break;
        }
      }
    } catch {}
  }

  // 5. docker-compose
  if (existsSync(join(targetRoot, "docker-compose.yml")) || existsSync(join(targetRoot, "docker-compose.yaml"))) {
    suggestions.push({ label: "docker compose up", command: "docker compose up", isRoot: true });
  }

  return suggestions;
}

// ── Broadcast helper ──────────────────────────────────────────────────────────

function broadcastTransition(t: DevServerTransition): void {
  broadcastToWebSocketClients({
    type: "dev-server",
    id: t.id,
    state: t.to,
    running: t.to === "starting" || t.to === "running",
    pid: t.pid ?? null,
  });
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerDevServerRoutes(
  app: RouteRegistrar,
  state: RuntimeState,
): void {
  // GET /api/dev-server — list all entries with status
  app.get("/api/dev-server", (c) => {
    const entries = state.config.devServers ?? [];
    const servers = listDevServerStatuses(entries, STATE_ROOT);
    return c.json({ ok: true, servers });
  });

  // GET /api/dev-server/detect — scan project for runnable commands
  app.get("/api/dev-server/detect", (c) => {
    try {
      const suggestions = detectDevServers(TARGET_ROOT);
      return c.json({ ok: true, suggestions });
    } catch (err) {
      logger.error({ err }, "[DevServer] Detection failed");
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  // GET /api/dev-server/:id/status
  app.get("/api/dev-server/:id/status", (c) => {
    const id = c.req.param("id");
    const entry = (state.config.devServers ?? []).find((e) => e.id === id);
    if (!entry) return c.json({ ok: false, error: "Dev server not found." }, 404);
    return c.json({ ok: true, ...getDevServerRuntimeStatus(entry, STATE_ROOT) });
  });

  // POST /api/dev-server/:id/start
  app.post("/api/dev-server/:id/start", (c) => {
    const id = c.req.param("id");
    const entry = (state.config.devServers ?? []).find((e) => e.id === id);
    if (!entry) return c.json({ ok: false, error: "Dev server not found." }, 404);
    try {
      const t = startManagedDevServer(entry, TARGET_ROOT, STATE_ROOT);
      broadcastTransition(t);
      return c.json({ ok: true, pid: t.pid, state: t.to });
    } catch (err) {
      logger.error({ err }, `[DevServer] Failed to start ${id}`);
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  // POST /api/dev-server/:id/stop
  app.post("/api/dev-server/:id/stop", (c) => {
    const id = c.req.param("id");
    const entry = (state.config.devServers ?? []).find((e) => e.id === id);
    if (!entry) return c.json({ ok: false, error: "Dev server not found." }, 404);
    const t = stopManagedDevServer(id, STATE_ROOT);
    if (t) broadcastTransition(t);
    return c.json({ ok: true, state: t?.to ?? "stopped" });
  });

  // GET /api/dev-server/:id/log — tail (last 16KB) or new bytes since ?after=N
  app.get("/api/dev-server/:id/log", (c) => {
    const id = c.req.param("id");
    const entry = (state.config.devServers ?? []).find((e) => e.id === id);
    if (!entry) return c.json({ ok: false, error: "Dev server not found." }, 404);
    const logFile = getManagedDevServerLogPath(id, STATE_ROOT);
    let logSize = 0;
    if (existsSync(logFile)) {
      try { logSize = statSync(logFile).size; } catch {}
    }
    const afterParam = c.req.query("after");
    const after = afterParam !== undefined ? parseInt(afterParam, 10) : null;
    if (after !== null && !isNaN(after) && after >= 0 && logSize > after) {
      // Incremental: return only new bytes since `after`
      const readSize = logSize - after;
      try {
        const fd = openSync(logFile, "r");
        const buf = Buffer.alloc(readSize);
        readSync(fd, buf, 0, readSize, after);
        closeSync(fd);
        return c.json({ ok: true, text: buf.toString("utf8"), logSize, truncated: false });
      } catch {
        return c.json({ ok: true, text: "", logSize, truncated: false });
      }
    }
    // Full tail: last 16KB
    const logTail = readDevServerLogTail(id, STATE_ROOT, 16_384);
    const truncated = logSize > 16_384;
    return c.json({ ok: true, logTail, logSize, truncated });
  });

  // GET /api/dev-server/:id/stream — SSE live log
  app.get("/api/dev-server/:id/stream", (c) => {
    const id = c.req.param("id");
    const entry = (state.config.devServers ?? []).find((e) => e.id === id);
    if (!entry) return c.json({ ok: false, error: "Dev server not found." }, 404);

    const logFile = getManagedDevServerLogPath(id, STATE_ROOT);

    const enc = new TextEncoder();
    const sseMsg = (data: unknown) => enc.encode(`data: ${JSON.stringify(data)}\n\n`);
    const sseComment = () => enc.encode(": keepalive\n\n");

    let chunkIntervalId: ReturnType<typeof setInterval>;
    let keepaliveId: ReturnType<typeof setInterval>;
    let statusCheckId: ReturnType<typeof setInterval>;

    const stream = new ReadableStream({
      start(ctrl) {
        let lastSize = 0;

        // Send initial content (last 16KB)
        if (existsSync(logFile)) {
          try {
            const stat = statSync(logFile);
            lastSize = stat.size;
            const readSize = Math.min(lastSize, 16_384);
            const fd = openSync(logFile, "r");
            const buf = Buffer.alloc(readSize);
            readSync(fd, buf, 0, readSize, Math.max(0, lastSize - readSize));
            closeSync(fd);
            ctrl.enqueue(sseMsg({ type: "init", text: buf.toString("utf8"), size: lastSize }));
          } catch {}
        } else {
          ctrl.enqueue(sseMsg({ type: "init", text: "", size: 0 }));
        }

        // Stream new bytes every second
        chunkIntervalId = setInterval(() => {
          if (!existsSync(logFile)) return;
          try {
            const stat = statSync(logFile);
            if (stat.size < lastSize) {
              // File was truncated (server restarted) — re-init from beginning
              lastSize = 0;
              const readSize = Math.min(stat.size, 16_384);
              let text = "";
              if (readSize > 0) {
                const fd = openSync(logFile, "r");
                const buf = Buffer.alloc(readSize);
                readSync(fd, buf, 0, readSize, 0);
                closeSync(fd);
                text = buf.toString("utf8");
                lastSize = stat.size;
              }
              ctrl.enqueue(sseMsg({ type: "init", text, size: lastSize }));
            } else if (stat.size > lastSize) {
              const readSize = stat.size - lastSize;
              const fd = openSync(logFile, "r");
              const buf = Buffer.alloc(readSize);
              readSync(fd, buf, 0, readSize, lastSize);
              closeSync(fd);
              lastSize = stat.size;
              ctrl.enqueue(sseMsg({ type: "chunk", text: buf.toString("utf8"), size: lastSize }));
            }
          } catch {}
        }, 1_000);

        // Notify client if process dies
        statusCheckId = setInterval(() => {
          const currentEntry = (state.config.devServers ?? []).find((e) => e.id === id);
          if (!currentEntry) return;
          const status = getDevServerRuntimeStatus(currentEntry, STATE_ROOT);
          if (!status.running) {
            try { ctrl.enqueue(sseMsg({ type: "status", running: false })); } catch {}
          }
        }, 5_000);

        keepaliveId = setInterval(() => {
          try { ctrl.enqueue(sseComment()); } catch {}
        }, 15_000);
      },
      cancel() {
        clearInterval(chunkIntervalId);
        clearInterval(keepaliveId);
        clearInterval(statusCheckId);
      },
    });

    return c.body(stream, 200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
  });

  // POST /api/dev-server/config — save the devServers array
  app.post("/api/dev-server/config", async (c) => {
    try {
      const body = await c.req.json() as { servers: unknown };
      if (!Array.isArray(body.servers)) {
        return c.json({ ok: false, error: "Invalid servers array" }, 400);
      }
      const entries = body.servers as DevServerEntry[];
      await replaceAllDevServers(entries);
      state.config.devServers = entries;
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  // DELETE /api/dev-server/:id — stop + remove a single entry
  app.delete("/api/dev-server/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const t = stopManagedDevServer(id, STATE_ROOT);
      if (t) broadcastTransition(t);
    } catch { /* ignore if not running */ }
    await deletePersistedDevServer(id);
    state.config.devServers = (state.config.devServers ?? []).filter((e) => e.id !== id);
    return c.json({ ok: true });
  });

  // PUT /api/dev-server/:id — update a single entry
  app.put("/api/dev-server/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const entry = await c.req.json() as DevServerEntry;
      if (!entry.id || !entry.name || !entry.command) {
        return c.json({ ok: false, error: "id, name, and command are required" }, 400);
      }
      await replacePersistedDevServer(entry);
      const existing = state.config.devServers ?? [];
      const idx = existing.findIndex((e) => e.id === id);
      if (idx >= 0) {
        existing[idx] = entry;
      } else {
        existing.push(entry);
      }
      state.config.devServers = existing;
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });
}
