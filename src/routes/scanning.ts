import type { RuntimeState } from "../types.ts";
import { logger } from "../concerns/logger.ts";
import { TARGET_ROOT } from "../concerns/constants.ts";
import type { RouteRegistrar } from "./http.ts";
import { broadcastToWebSocketClients } from "./websocket.ts";
import { scanProjectFiles } from "../domains/project.ts";

export function registerScanningRoutes(
  app: RouteRegistrar,
  state: RuntimeState,
): void {
  app.get("/api/scan/project", async (c) => {
    try {
      const result = scanProjectFiles(TARGET_ROOT);
      return c.json(result);
    } catch (error) {
      logger.error({ err: error }, "Failed to scan project files");
      return c.json({ ok: false, error: "Failed to scan project." }, 500);
    }
  });

  app.post("/api/boot/skip-scan", async (c) => {
    broadcastToWebSocketClients({ type: "boot:scan:skipped" });
    return c.json({ ok: true, message: "Scan skipped." });
  });
}
