import type { JsonRecord, RuntimeState } from "../types.ts";
import { now, toStringValue } from "../concerns/helpers.ts";
import { logger } from "../concerns/logger.ts";
import { addEvent } from "../domains/issues.ts";
import { createMilestoneFromPayload, findMilestone, normalizeMilestoneStatus, refreshMilestoneSummaries } from "../domains/projects.ts";
import { markMilestoneDirty, markIssueDirty } from "../persistence/dirty-tracker.ts";
import { persistState } from "../persistence/store.ts";
import type { RouteRegistrar } from "./http.ts";
import { findIssue, parseIssue } from "./helpers.ts";

function parseMilestoneId(c: { req: { param: (name: string) => string | undefined } }): string | null {
  const value = c.req.param("id");
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function registerMilestoneRoutes(app: RouteRegistrar, state: RuntimeState): void {
  app.get("/api/milestones", async (c) => {
    refreshMilestoneSummaries(state);
    return c.json({ ok: true, milestones: state.milestones });
  });

  app.get("/api/milestones/:id", async (c) => {
    const milestoneId = parseMilestoneId(c);
    if (!milestoneId) return c.json({ ok: false, error: "Milestone id is required." }, 400);
    const milestone = findMilestone(state, milestoneId);
    if (!milestone) return c.json({ ok: false, error: "Milestone not found." }, 404);
    const issues = state.issues.filter((issue) => issue.milestoneId === milestone.id);
    return c.json({ ok: true, milestone, issues });
  });

  app.post("/api/milestones", async (c) => {
    try {
      const payload = await c.req.json() as JsonRecord;
      const milestone = createMilestoneFromPayload(payload);
      if (state.milestones.some((entry) => entry.id === milestone.id || entry.slug === milestone.slug)) {
        return c.json({ ok: false, error: "Milestone id or slug already exists." }, 409);
      }
      state.milestones.push(milestone);
      state.updatedAt = now();
      markMilestoneDirty(milestone.id);
      addEvent(state, undefined, "manual", `Milestone created: ${milestone.name}.`);
      await persistState(state);
      return c.json({ ok: true, milestone }, 201);
    } catch (error) {
      logger.error({ err: error }, "[API] Failed to create milestone");
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/api/milestones/:id", async (c) => {
    const milestoneId = parseMilestoneId(c);
    if (!milestoneId) return c.json({ ok: false, error: "Milestone id is required." }, 400);
    const milestone = findMilestone(state, milestoneId);
    if (!milestone) return c.json({ ok: false, error: "Milestone not found." }, 404);

    try {
      const payload = await c.req.json() as JsonRecord;
      const nextName = toStringValue(payload.name, milestone.name).trim();
      if (!nextName) {
        return c.json({ ok: false, error: "Milestone name is required." }, 400);
      }
      milestone.name = nextName;
      milestone.description = toStringValue(payload.description, milestone.description) || undefined;
      milestone.status = normalizeMilestoneStatus(payload.status ?? milestone.status);
      milestone.updatedAt = now();
      state.updatedAt = milestone.updatedAt;
      markMilestoneDirty(milestone.id);
      addEvent(state, undefined, "manual", `Milestone updated: ${milestone.name}.`);
      await persistState(state);
      return c.json({ ok: true, milestone });
    } catch (error) {
      logger.error({ err: error, milestoneId }, "[API] Failed to update milestone");
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.delete("/api/milestones/:id", async (c) => {
    const milestoneId = parseMilestoneId(c);
    if (!milestoneId) return c.json({ ok: false, error: "Milestone id is required." }, 400);
    const milestone = findMilestone(state, milestoneId);
    if (!milestone) return c.json({ ok: false, error: "Milestone not found." }, 404);
    const linkedIssues = state.issues.filter((issue) => issue.milestoneId === milestone.id);
    if (linkedIssues.length > 0) {
      return c.json({ ok: false, error: "Cannot delete a milestone that still has linked issues." }, 409);
    }

    state.milestones = state.milestones.filter((entry) => entry.id !== milestone.id);
    state.updatedAt = now();
    addEvent(state, undefined, "manual", `Milestone deleted: ${milestone.name}.`);
    await persistState(state);
    try {
      const { getMilestoneStateResource } = await import("../persistence/store.ts");
      await (getMilestoneStateResource() as any)?.delete?.(milestone.id);
    } catch {}
    return c.json({ ok: true, id: milestone.id });
  });

  app.post("/api/issues/:id/milestone", async (c) => {
    const issueId = parseIssue(c);
    if (!issueId) return c.json({ ok: false, error: "Issue id is required." }, 400);
    const issue = findIssue(state, issueId);
    if (!issue) return c.json({ ok: false, error: "Issue not found." }, 404);

    try {
      const payload = await c.req.json() as JsonRecord;
      const rawMilestoneId = toStringValue(payload.milestoneId);
      const nextMilestoneId = rawMilestoneId || undefined;
      if (nextMilestoneId && !findMilestone(state, nextMilestoneId)) {
        return c.json({ ok: false, error: "Milestone not found." }, 404);
      }
      issue.milestoneId = nextMilestoneId;
      issue.updatedAt = now();
      state.updatedAt = issue.updatedAt;
      markIssueDirty(issue.id);
      addEvent(state, issue.id, "manual", nextMilestoneId
        ? `${issue.identifier} assigned to milestone ${nextMilestoneId}.`
        : `${issue.identifier} removed from its milestone.`);
      await persistState(state);
      return c.json({ ok: true, issue });
    } catch (error) {
      logger.error({ err: error, issueId }, "[API] Failed to update issue milestone");
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
}
