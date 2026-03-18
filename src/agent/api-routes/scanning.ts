import type { RuntimeState } from "../types.ts";
import { logger } from "../logger.ts";
import { TARGET_ROOT } from "../constants.ts";
import { broadcastToWebSocketClients } from "../api-websocket.ts";
import { scanProjectFiles, analyzeProjectWithCli } from "../project-scanner.ts";
import { scanForTodos, categorizeScannedIssues } from "../issue-scanner.ts";
import { fetchGitHubIssues } from "../github-sync.ts";

export function registerScanningRoutes(
  app: any,
  state: RuntimeState,
): void {
  app.get("/api/scan/project", async (c: any) => {
    try {
      const result = scanProjectFiles(TARGET_ROOT);
      return c.json(result);
    } catch (error) {
      logger.error({ err: error }, "Failed to scan project files");
      return c.json({ ok: false, error: "Failed to scan project." }, 500);
    }
  });

  app.post("/api/scan/analyze", async (c: any) => {
    try {
      const payload = await c.req.json() as { provider?: string };
      const provider = typeof payload.provider === "string" ? payload.provider : state.config.agentProvider;
      const result = await analyzeProjectWithCli(provider, TARGET_ROOT);
      return c.json(result);
    } catch (error) {
      logger.error({ err: error }, "Failed to analyze project with CLI");
      return c.json({ ok: false, error: "Failed to analyze project." }, 500);
    }
  });

  app.get("/api/scan/issues", async (c: any) => {
    try {
      const todos = scanForTodos(TARGET_ROOT);
      const categorized = categorizeScannedIssues(todos);
      return c.json({ ok: true, issues: categorized, total: categorized.length });
    } catch (error) {
      logger.error({ err: error }, "Failed to scan for TODOs");
      return c.json({ ok: false, error: "Failed to scan for issues." }, 500);
    }
  });

  app.post("/api/boot/skip-scan", async (c: any) => {
    broadcastToWebSocketClients({ type: "boot:scan:skipped" });
    return c.json({ ok: true, message: "Scan skipped." });
  });

  app.get("/api/scan/github-issues", async (c: any) => {
    try {
      const issues = await fetchGitHubIssues(TARGET_ROOT);
      const categorized = categorizeScannedIssues(issues);
      return c.json({ ok: true, issues: categorized, total: categorized.length });
    } catch (error) {
      logger.error({ err: error }, "Failed to fetch GitHub issues");
      return c.json({ ok: false, error: "Failed to fetch GitHub issues." }, 500);
    }
  });
}
