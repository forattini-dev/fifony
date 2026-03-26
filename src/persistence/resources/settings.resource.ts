import { S3DB_SETTINGS_RESOURCE } from "../../concerns/constants.ts";
import type { JsonRecord, RuntimeSettingScope, RuntimeSettingSource } from "../../types.ts";
import { now } from "../../concerns/helpers.ts";
import { addEvent } from "../../domains/issues.ts";
import { resolveProjectMetadata, SETTING_ID_PROJECT_NAME } from "../../domains/project.ts";
import { getApiRuntimeContextOrThrow } from "../plugins/api-runtime-context.ts";
import {
  applyPersistedSettings,
  inferSettingScope,
  loadRuntimeSettings,
  persistSetting,
  RUNTIME_CONFIG_SETTING_IDS,
} from "../settings.ts";

type ApiContext = {
  req: {
    param: (name: string) => string | undefined;
    json: () => Promise<unknown>;
  };
};

const VALID_SETTING_SCOPES = new Set<RuntimeSettingScope>(["runtime", "providers", "ui", "system"]);
const VALID_SETTING_SOURCES = new Set<RuntimeSettingSource>(["user", "detected", "workflow", "system"]);

export async function listSettings(): Promise<{ body: unknown; status?: number }> {
  const settings = await loadRuntimeSettings();
  return { body: { settings } };
}

export async function getSetting(c: unknown): Promise<{ body: unknown; status?: number }> {
  const settingId = (c as ApiContext).req.param("id") || "";
  const settings = await loadRuntimeSettings();
  const setting = settings.find((entry) => entry.id === settingId);
  if (!setting) {
    return { status: 404, body: { ok: false, error: "Setting not found" } };
  }
  return { body: { ok: true, setting } };
}

export async function updateSetting(c: unknown): Promise<{ body: unknown; status?: number }> {
  const context = getApiRuntimeContextOrThrow();
  const { persistState } = await import("../store.ts");
  const settingId = (c as ApiContext).req.param("id") || "";
  if (!settingId) {
    return { status: 400, body: { ok: false, error: "Setting id is required" } };
  }

  const payload = await (c as ApiContext).req.json() as JsonRecord;
  const scopeValue = typeof payload.scope === "string" ? payload.scope : inferSettingScope(settingId);
  const sourceValue = typeof payload.source === "string" ? payload.source : "user";

  if (!VALID_SETTING_SCOPES.has(scopeValue as RuntimeSettingScope)) {
    return { status: 400, body: { ok: false, error: "Invalid setting scope" } };
  }

  if (!VALID_SETTING_SOURCES.has(sourceValue as RuntimeSettingSource)) {
    return { status: 400, body: { ok: false, error: "Invalid setting source" } };
  }

  const setting = await persistSetting(settingId, payload.value, {
    scope: scopeValue as RuntimeSettingScope,
    source: sourceValue as RuntimeSettingSource,
  });

  if (settingId === SETTING_ID_PROJECT_NAME) {
    const settings = await loadRuntimeSettings();
    const projectMetadata = resolveProjectMetadata(settings, context.state.sourceRepoUrl);
    context.state.projectName = projectMetadata.projectName;
    context.state.detectedProjectName = projectMetadata.detectedProjectName;
    context.state.projectNameSource = projectMetadata.projectNameSource;
    context.state.queueTitle = projectMetadata.queueTitle;
    context.state.updatedAt = now();
    addEvent(context.state, undefined, "manual", `Project title updated to ${projectMetadata.queueTitle}.`);
    await persistState(context.state);
  }

  if (RUNTIME_CONFIG_SETTING_IDS.has(settingId)) {
    context.state.config = applyPersistedSettings(context.state.config, [setting]);
    context.state.updatedAt = now();
    addEvent(context.state, undefined, "manual", `Runtime setting ${settingId} updated.`);
    await persistState(context.state);
  }

  return { body: { ok: true, setting } };
}

export default {
  name: S3DB_SETTINGS_RESOURCE,
  attributes: {
    id: "string|required",
    scope: "string|required",
    value: "json|required",
    source: "string|required",
    updatedAt: "datetime|required",
  },
  partitions: {
    byScope: { fields: { scope: "string" } },
  },
  asyncPartitions: true,
  behavior: "body-overflow",
  paranoid: false,
  timestamps: false,
  api: {
    auth: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    description: "Runtime settings",
    "GET /": async () => listSettings(),
    "GET /:id": async (c: unknown) => getSetting(c),
    "POST /:id": async (c: unknown) => updateSetting(c),
  },
};
