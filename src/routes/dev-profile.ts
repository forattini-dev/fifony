import { STATE_ROOT, TARGET_ROOT } from "../concerns/constants.ts";
import type { RouteRegistrar } from "./http.ts";
import {
  bootstrapDevProfile,
  getDevProfileStatus,
  resetDevProfile,
} from "../domains/dev-profile.ts";
import { logger } from "../concerns/logger.ts";

export function registerDevProfileRoutes(app: RouteRegistrar): void {
  app.get("/api/dev-profile", async (c) => {
    try {
      return c.json({
        ok: true,
        profile: getDevProfileStatus(TARGET_ROOT, STATE_ROOT),
      });
    } catch (error) {
      logger.error({ err: error }, "[DevProfile] Failed to load status");
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/dev-profile/bootstrap", async (c) => {
    try {
      return c.json({
        ok: true,
        profile: bootstrapDevProfile(TARGET_ROOT, STATE_ROOT),
      });
    } catch (error) {
      logger.error({ err: error }, "[DevProfile] Failed to bootstrap profile");
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/dev-profile/reset", async (c) => {
    try {
      return c.json({
        ok: true,
        result: resetDevProfile(TARGET_ROOT, STATE_ROOT),
        profile: getDevProfileStatus(TARGET_ROOT, STATE_ROOT),
      });
    } catch (error) {
      logger.error({ err: error }, "[DevProfile] Failed to reset profile");
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
}
