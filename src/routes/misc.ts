import type { RuntimeState } from "../types.ts";
import { logger } from "../concerns/logger.ts";
import type { RouteRegistrar } from "./http.ts";
import { persistState } from "../persistence/store.ts";
import { getGitRepoStatus, initializeGitRepoForWorktrees } from "../domains/workspace.ts";
import { listEvents } from "../routes/helpers.ts";
import { TARGET_ROOT, ATTACHMENTS_ROOT } from "../concerns/constants.ts";
import {
  getIssueDiff,
  getIssueLive,
  streamIssueLive,
} from "../persistence/resources/issues.resource.ts";
import { execSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { extname, join } from "node:path";

export function registerMiscRoutes(
  app: RouteRegistrar,
  state: RuntimeState,
): void {
  app.get("/api/queue/stats", async (c) => {
    const { getQueueStats } = await import("../persistence/plugins/queue-workers.ts");
    return c.json(await getQueueStats());
  });

  app.get("/api/live/:id/stream", async (c) => {
    const result = await streamIssueLive(c);
    if (result.body instanceof Response) return result.body;
    return c.json(result.body, result.status ?? 200);
  });

  app.get("/api/live/:id", async (c) => {
    const result = await getIssueLive(c);
    if (result.body instanceof Response) return result.body;
    return c.json(result.body, result.status ?? 200);
  });

  app.get("/api/diff/:id", async (c) => {
    const result = await getIssueDiff(c);
    if (result.body instanceof Response) return result.body;
    return c.json(result.body, result.status ?? 200);
  });

  app.get("/api/git/status", async (c) => {
    try {
      return c.json(getGitRepoStatus(TARGET_ROOT));
    } catch (error) {
      return c.json({ ok: false, error: String(error) }, 500);
    }
  });

  app.post("/api/git/init", async (c) => {
    try {
      const status = initializeGitRepoForWorktrees(TARGET_ROOT);
      state.config.defaultBranch = status.branch || state.config.defaultBranch || "main";
      await persistState(state);
      return c.json({ ok: true, ...status });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/git/branch", async (c) => {
    try {
      const { branchName } = await c.req.json() as { branchName?: string };
      if (!branchName || !/^[a-zA-Z0-9/_.-]+$/.test(branchName)) {
        return c.json({ ok: false, error: "Invalid branch name." }, 400);
      }
      execSync(`git checkout -b "${branchName}"`, { cwd: TARGET_ROOT, stdio: "pipe" });
      state.config.defaultBranch = branchName;
      await persistState(state);
      return c.json({ ok: true, defaultBranch: branchName });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/git/switch", async (c) => {
    try {
      const { branchName } = await c.req.json() as { branchName?: string };
      if (!branchName || !/^[a-zA-Z0-9/_.-]+$/.test(branchName)) {
        return c.json({ ok: false, error: "Invalid branch name." }, 400);
      }
      let created = false;
      try {
        // Try switching to existing branch first
        execSync(`git checkout "${branchName}"`, { cwd: TARGET_ROOT, stdio: "pipe" });
      } catch {
        // Branch doesn't exist — create it
        execSync(`git checkout -b "${branchName}"`, { cwd: TARGET_ROOT, stdio: "pipe" });
        created = true;
      }
      state.config.defaultBranch = branchName;
      await persistState(state);
      return c.json({ ok: true, defaultBranch: branchName, created });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.get("/api/events/feed", async (c) => {
    const since = c.req.query("since");
    const issueId = c.req.query("issueId");
    const kind = c.req.query("kind");
    const events = await listEvents(state, {
      since: typeof since === "string" ? since : undefined,
      issueId: typeof issueId === "string" && issueId ? issueId : undefined,
      kind: typeof kind === "string" && kind ? kind : undefined,
    });
    return c.json({ events: events.slice(0, 200) });
  });

  app.get("/api/gitignore/status", async (c) => {
    try {
      const gitignorePath = join(TARGET_ROOT, ".gitignore");
      if (!existsSync(gitignorePath)) {
        return c.json({ exists: false, hasFifony: false });
      }
      const content = readFileSync(gitignorePath, "utf-8");
      const lines = content.split("\n").map((l: string) => l.trim());
      const hasFifony = lines.some((l: string) => l === ".fifony" || l === ".fifony/" || l === "/.fifony" || l === "/.fifony/");
      return c.json({ exists: true, hasFifony });
    } catch (error) {
      logger.error({ err: error }, "Failed to check .gitignore");
      return c.json({ exists: false, hasFifony: false, error: "Failed to check .gitignore" }, 500);
    }
  });

  app.post("/api/gitignore/add", async (c) => {
    try {
      const gitignorePath = join(TARGET_ROOT, ".gitignore");
      if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, "# Fifony state directory\n.fifony/\n", "utf-8");
        return c.json({ ok: true, created: true });
      }
      const content = readFileSync(gitignorePath, "utf-8");
      const lines = content.split("\n").map((l: string) => l.trim());
      const hasFifony = lines.some((l: string) => l === ".fifony" || l === ".fifony/" || l === "/.fifony" || l === "/.fifony/");
      if (hasFifony) {
        return c.json({ ok: true, alreadyPresent: true });
      }
      const suffix = content.endsWith("\n") ? "" : "\n";
      appendFileSync(gitignorePath, `${suffix}\n# Fifony state directory\n.fifony/\n`, "utf-8");
      return c.json({ ok: true, added: true });
    } catch (error) {
      logger.error({ err: error }, "Failed to update .gitignore");
      return c.json({ ok: false, error: "Failed to update .gitignore" }, 500);
    }
  });

  app.post("/api/attachments/upload", async (c) => {
    try {
      const payload = await c.req.json() as { files?: Array<{ name: string; data: string; type: string }> };
      if (!Array.isArray(payload.files) || payload.files.length === 0) {
        return c.json({ ok: false, error: "No files provided." }, 400);
      }
      const uploadId = randomUUID();
      const uploadDir = join(ATTACHMENTS_ROOT, "temp", uploadId);
      mkdirSync(uploadDir, { recursive: true });
      const paths: string[] = [];
      for (const file of payload.files) {
        if (typeof file.data !== "string" || !file.name) continue;
        const safeExt = extname(file.name).replace(/[^a-z0-9.]/gi, "").slice(0, 10) || ".bin";
        const safeName = `${randomUUID()}${safeExt}`;
        const dest = join(uploadDir, safeName);
        writeFileSync(dest, Buffer.from(file.data, "base64"));
        paths.push(dest);
      }
      return c.json({ ok: true, paths, uploadId });
    } catch (error) {
      logger.error({ err: error }, "[API] Attachment upload failed");
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
}
