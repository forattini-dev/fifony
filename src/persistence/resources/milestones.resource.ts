import { S3DB_MILESTONE_RESOURCE } from "../../concerns/constants.ts";
import type { JsonRecord } from "../../types.ts";
import { getApiRuntimeContextOrThrow } from "../plugins/api-runtime-context.ts";
import { now, toStringValue } from "../../concerns/helpers.ts";
import { logger } from "../../concerns/logger.ts";
import { addEvent } from "../../domains/issues.ts";
import { createMilestoneFromPayload, findMilestone, normalizeMilestoneStatus, refreshMilestoneSummaries } from "../../domains/milestones.ts";
import { markMilestoneDirty } from "../dirty-tracker.ts";

type ApiContext = {
  req: {
    param: (name: string) => string | undefined;
    json: () => Promise<unknown>;
  };
};

type MilestoneApiDeps = {
  persistState: (state: Awaited<ReturnType<typeof getApiRuntimeContextOrThrow>>["state"]) => Promise<unknown>;
  deleteMilestoneRecord: (id: string) => Promise<unknown>;
};

async function loadMilestoneApiDeps(): Promise<MilestoneApiDeps> {
  const { getMilestoneStateResource, persistState } = await import("../store.ts");
  return {
    persistState,
    deleteMilestoneRecord: async (id: string) => {
      await (getMilestoneStateResource() as { delete?: (value: string) => Promise<unknown> } | null)?.delete?.(id);
    },
  };
}

export function parseMilestoneId(c: unknown): string | null {
  const value = (c as ApiContext)?.req?.param?.("id");
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function listMilestones(): Promise<{ body: unknown; status?: number }> {
  const context = getApiRuntimeContextOrThrow();
  refreshMilestoneSummaries(context.state);
  return { body: { ok: true, milestones: context.state.milestones } };
}

export async function getMilestone(c: unknown): Promise<{ body: unknown; status?: number }> {
  const context = getApiRuntimeContextOrThrow();
  const milestoneId = parseMilestoneId(c);
  if (!milestoneId) return { status: 400, body: { ok: false, error: "Milestone id is required." } };

  const milestone = findMilestone(context.state, milestoneId);
  if (!milestone) return { status: 404, body: { ok: false, error: "Milestone not found." } };

  const issues = context.state.issues.filter((issue) => issue.milestoneId === milestone.id);
  return { body: { ok: true, milestone, issues } };
}

export async function createMilestone(
  c: unknown,
  deps?: MilestoneApiDeps,
): Promise<{ body: unknown; status?: number }> {
  const context = getApiRuntimeContextOrThrow();
  const apiDeps = deps ?? await loadMilestoneApiDeps();

  try {
    const payload = await (c as ApiContext).req.json() as JsonRecord;
    const milestone = createMilestoneFromPayload(payload);
    if (context.state.milestones.some((entry) => entry.id === milestone.id || entry.slug === milestone.slug)) {
      return { status: 409, body: { ok: false, error: "Milestone id or slug already exists." } };
    }

    context.state.milestones.push(milestone);
    context.state.updatedAt = now();
    markMilestoneDirty(milestone.id);
    addEvent(context.state, undefined, "manual", `Milestone created: ${milestone.name}.`);
    await apiDeps.persistState(context.state);
    return { status: 201, body: { ok: true, milestone } };
  } catch (error) {
    logger.error({ err: error }, "[API] Failed to create milestone");
    return { status: 400, body: { ok: false, error: error instanceof Error ? error.message : String(error) } };
  }
}

export async function updateMilestone(
  c: unknown,
  deps?: MilestoneApiDeps,
): Promise<{ body: unknown; status?: number }> {
  const context = getApiRuntimeContextOrThrow();
  const apiDeps = deps ?? await loadMilestoneApiDeps();
  const milestoneId = parseMilestoneId(c);
  if (!milestoneId) return { status: 400, body: { ok: false, error: "Milestone id is required." } };

  const milestone = findMilestone(context.state, milestoneId);
  if (!milestone) return { status: 404, body: { ok: false, error: "Milestone not found." } };

  try {
    const payload = await (c as ApiContext).req.json() as JsonRecord;
    const nextName = toStringValue(payload.name, milestone.name).trim();
    if (!nextName) {
      return { status: 400, body: { ok: false, error: "Milestone name is required." } };
    }

    milestone.name = nextName;
    milestone.description = toStringValue(payload.description, milestone.description) || undefined;
    milestone.status = normalizeMilestoneStatus(payload.status ?? milestone.status);
    milestone.updatedAt = now();
    context.state.updatedAt = milestone.updatedAt;
    markMilestoneDirty(milestone.id);
    addEvent(context.state, undefined, "manual", `Milestone updated: ${milestone.name}.`);
    await apiDeps.persistState(context.state);
    return { body: { ok: true, milestone } };
  } catch (error) {
    logger.error({ err: error, milestoneId }, "[API] Failed to update milestone");
    return { status: 400, body: { ok: false, error: error instanceof Error ? error.message : String(error) } };
  }
}

export async function deleteMilestone(
  c: unknown,
  deps?: MilestoneApiDeps,
): Promise<{ body: unknown; status?: number }> {
  const context = getApiRuntimeContextOrThrow();
  const apiDeps = deps ?? await loadMilestoneApiDeps();
  const milestoneId = parseMilestoneId(c);
  if (!milestoneId) return { status: 400, body: { ok: false, error: "Milestone id is required." } };

  const milestone = findMilestone(context.state, milestoneId);
  if (!milestone) return { status: 404, body: { ok: false, error: "Milestone not found." } };

  const linkedIssues = context.state.issues.filter((issue) => issue.milestoneId === milestone.id);
  if (linkedIssues.length > 0) {
    return { status: 409, body: { ok: false, error: "Cannot delete a milestone that still has linked issues." } };
  }

  context.state.milestones = context.state.milestones.filter((entry) => entry.id !== milestone.id);
  context.state.updatedAt = now();
  addEvent(context.state, undefined, "manual", `Milestone deleted: ${milestone.name}.`);
  await apiDeps.persistState(context.state);

  try { await apiDeps.deleteMilestoneRecord(milestone.id); } catch {}

  return { body: { ok: true, id: milestone.id } };
}

export default {
  name: S3DB_MILESTONE_RESOURCE,
  attributes: {
    id: "string|required",
    slug: "string|required",
    name: "string|required",
    description: "string|optional",
    status: "string|required",
    createdAt: "datetime|required",
    updatedAt: "datetime|required",
  },
  partitions: {
    byStatus: { fields: { status: "string" } },
    bySlug: { fields: { slug: "string" } },
  },
  asyncPartitions: true,
  behavior: "body-overflow",
  paranoid: false,
  timestamps: false,
  api: {
    auth: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    description: "Milestone registry for orchestration runtime",
    "GET /": async () => listMilestones(),
    "GET /:id": async (c: unknown) => getMilestone(c),
    "POST /": async (c: unknown) => createMilestone(c),
    "POST /:id": async (c: unknown) => updateMilestone(c),
    "DELETE /:id": async (c: unknown) => deleteMilestone(c),
  },
};
