import { S3DB_VARIABLES_RESOURCE } from "../../concerns/constants.ts";
import type { VariableEntry, RuntimeState } from "../../types.ts";
import { getApiRuntimeContextOrThrow } from "../plugins/api-runtime-context.ts";

export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function getRuntimeState(): RuntimeState {
  return getApiRuntimeContextOrThrow().state;
}

function normalizeVariableEntry(value: unknown): { entry?: VariableEntry; error?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Variable entry must be an object." };
  }

  const raw = value as Record<string, unknown>;
  const key = typeof raw.key === "string" ? raw.key.trim() : "";
  const scope = typeof raw.scope === "string" ? raw.scope.trim() : "";
  const val = typeof raw.value === "string" ? raw.value : String(raw.value ?? "");

  if (!key) return { error: "Variable key is required." };
  if (!ENV_KEY_PATTERN.test(key)) return { error: `Invalid variable name "${key}". Must match [A-Za-z_][A-Za-z0-9_]*.` };
  if (!scope) return { error: "Variable scope is required." };

  const id = `${scope}:${key}`;
  const entry: VariableEntry = { id, key, value: val, scope, updatedAt: new Date().toISOString() };
  return { entry };
}

type ApiContext = {
  req: {
    param: (name: string) => string | undefined;
    json: () => Promise<unknown>;
    query: (name: string) => string | undefined;
  };
};

export async function listVariables(c: unknown): Promise<{ body: unknown; status?: number }> {
  const state = getRuntimeState();
  const scopeFilter = (c as ApiContext)?.req?.query?.("scope");
  const variables = scopeFilter
    ? (state.variables ?? []).filter((v) => v.scope === scopeFilter)
    : (state.variables ?? []);
  return { body: { ok: true, variables } };
}

export async function upsertVariable(
  c: unknown,
  deps: { upsertPersistedVariable: (v: VariableEntry) => Promise<void> },
): Promise<{ body: unknown; status?: number }> {
  const state = getRuntimeState();
  const body = await (c as ApiContext).req.json();
  const result = normalizeVariableEntry(body);
  if (result.error || !result.entry) {
    return { body: { ok: false, error: result.error ?? "Invalid variable." }, status: 400 };
  }
  const entry = result.entry;
  await deps.upsertPersistedVariable(entry);
  const existing = state.variables ?? [];
  const idx = existing.findIndex((v) => v.id === entry.id);
  if (idx >= 0) existing[idx] = entry;
  else existing.push(entry);
  state.variables = existing;
  return { body: { ok: true, variable: entry } };
}

export async function deleteVariable(
  c: unknown,
  deps: { deletePersistedVariable: (id: string) => Promise<void> },
): Promise<{ body: unknown; status?: number }> {
  const state = getRuntimeState();
  const id = (c as ApiContext)?.req?.param?.("id");
  if (!id) return { body: { ok: false, error: "Variable id required." }, status: 400 };
  await deps.deletePersistedVariable(id);
  state.variables = (state.variables ?? []).filter((v) => v.id !== id);
  return { body: { ok: true, id } };
}

export default {
  name: S3DB_VARIABLES_RESOURCE,
  attributes: {
    id: "string|required",
    key: "string|required",
    value: "string|required",
    scope: "string|required",
    updatedAt: "datetime|required",
  },
  asyncPartitions: false,
  behavior: "body-overflow",
  paranoid: false,
  timestamps: false,
};
