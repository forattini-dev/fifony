import { S3DB_SERVICES_RESOURCE } from "../../concerns/constants.ts";
import type { ServiceEntry, RuntimeState } from "../../types.ts";
import { normalizeServiceEnvironment } from "../../domains/service-env.ts";
import { getApiRuntimeContextOrThrow } from "../plugins/api-runtime-context.ts";

type ServiceApiDeps = {
  replacePersistedService: (entry: ServiceEntry) => Promise<void>;
  deletePersistedService: (id: string) => Promise<void>;
  replaceAllServices: (entries: ServiceEntry[]) => Promise<void>;
};

type ApiContext = {
  req: {
    param: (name: string) => string | undefined;
    json: () => Promise<unknown>;
  };
};

async function loadServiceApiDeps(): Promise<ServiceApiDeps> {
  const {
    replacePersistedService,
    deletePersistedService,
    replaceAllServices,
  } = await import("../store.ts");

  return {
    replacePersistedService,
    deletePersistedService,
    replaceAllServices,
  };
}

function parseServiceId(c: unknown): string | null {
  const value = (c as ApiContext)?.req?.param?.("id");
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getRuntimeState(): RuntimeState {
  return getApiRuntimeContextOrThrow().state;
}

function normalizeServiceEntry(value: unknown): { entry?: ServiceEntry; error?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Service entry must be an object." };
  }

  const entry = value as ServiceEntry;
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  const command = typeof entry.command === "string" ? entry.command.trim() : "";
  const cwd = typeof entry.cwd === "string" ? entry.cwd.trim() : "";
  const envResult = normalizeServiceEnvironment(entry.env);

  if (!id || !name || !command) {
    return { error: "id, name, and command are required" };
  }
  if (envResult.errors.length > 0) {
    return { error: envResult.errors[0] };
  }

  return {
    entry: {
      ...entry,
      id,
      name,
      command,
      cwd: cwd || undefined,
      env: Object.keys(envResult.env).length > 0 ? envResult.env : undefined,
    },
  };
}

export async function listServiceConfigs(): Promise<{ body: unknown; status?: number }> {
  const state = getRuntimeState();
  return { body: { ok: true, services: state.config.services ?? [] } };
}

export async function replaceServiceConfigs(
  c: unknown,
  deps?: ServiceApiDeps,
): Promise<{ body: unknown; status?: number }> {
  const state = getRuntimeState();
  const apiDeps = deps ?? await loadServiceApiDeps();

  try {
    const body = await (c as ApiContext).req.json() as { services: unknown };
    if (!Array.isArray(body.services)) {
      return { status: 400, body: { ok: false, error: "Invalid services array" } };
    }

    const entries = body.services as ServiceEntry[];
    const normalizedEntries: ServiceEntry[] = [];
    for (const entry of entries) {
      const normalized = normalizeServiceEntry(entry);
      if (!normalized.entry) {
        return { status: 400, body: { ok: false, error: normalized.error ?? "Invalid service entry" } };
      }
      normalizedEntries.push(normalized.entry);
    }
    await apiDeps.replaceAllServices(normalizedEntries);
    state.config.services = normalizedEntries;
    return { body: { ok: true, services: normalizedEntries } };
  } catch (error) {
    return { status: 500, body: { ok: false, error: String(error) } };
  }
}

export async function upsertServiceConfig(
  c: unknown,
  deps?: ServiceApiDeps,
): Promise<{ body: unknown; status?: number }> {
  const state = getRuntimeState();
  const apiDeps = deps ?? await loadServiceApiDeps();
  const id = parseServiceId(c);
  if (!id) return { status: 400, body: { ok: false, error: "Service id is required." } };

  try {
    const rawEntry = await (c as ApiContext).req.json() as ServiceEntry;
    const normalized = normalizeServiceEntry(rawEntry);
    if (!normalized.entry) {
      return { status: 400, body: { ok: false, error: normalized.error ?? "Invalid service entry" } };
    }
    const entry = normalized.entry;

    await apiDeps.replacePersistedService(entry);
    const existing = state.config.services ?? [];
    const idx = existing.findIndex((service) => service.id === id);
    if (idx >= 0) existing[idx] = entry;
    else existing.push(entry);
    state.config.services = existing;
    return { body: { ok: true, service: entry } };
  } catch (error) {
    return { status: 500, body: { ok: false, error: String(error) } };
  }
}

export async function deleteServiceConfig(
  c: unknown,
  deps?: ServiceApiDeps,
): Promise<{ body: unknown; status?: number }> {
  const state = getRuntimeState();
  const apiDeps = deps ?? await loadServiceApiDeps();
  const id = parseServiceId(c);
  if (!id) return { status: 400, body: { ok: false, error: "Service id is required." } };

  await apiDeps.deletePersistedService(id);
  state.config.services = (state.config.services ?? []).filter((entry) => entry.id !== id);
  return { body: { ok: true, id } };
}

export default {
  name: S3DB_SERVICES_RESOURCE,
  attributes: {
    id: "string|required",
    name: "string|required",
    command: "string|required",
    cwd: "string|optional",
    env: "json|optional",
    autoStart: "json|optional",
    updatedAt: "datetime|required",
  },
  asyncPartitions: false,
  behavior: "body-overflow",
  paranoid: false,
  timestamps: false,
  api: {
    auth: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    description: "Managed service configuration entries",
    "GET /": async () => listServiceConfigs(),
    "POST /config": async (c: unknown) => replaceServiceConfigs(c),
    "PUT /:id": async (c: unknown) => upsertServiceConfig(c),
    "DELETE /:id": async (c: unknown) => deleteServiceConfig(c),
  },
};
