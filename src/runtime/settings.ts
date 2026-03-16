import type {
  DetectedProvider,
  RuntimeConfig,
  RuntimeSettingRecord,
  RuntimeSettingScope,
  RuntimeSettingSource,
} from "./types.ts";
import { clamp, now } from "./helpers.ts";
import { loadPersistedSettings, replacePersistedSetting } from "./store.ts";

export const SETTING_ID_WORKER_CONCURRENCY = "runtime.workerConcurrency";
export const SETTING_ID_DETECTED_PROVIDERS = "providers.detected";
export const SETTING_ID_UI_THEME = "ui.theme";
export const SETTING_ID_UI_NOTIFICATIONS_ENABLED = "ui.notifications.enabled";

export async function loadRuntimeSettings(): Promise<RuntimeSettingRecord[]> {
  return loadPersistedSettings();
}

export function applyPersistedSettings(config: RuntimeConfig, settings: RuntimeSettingRecord[]): RuntimeConfig {
  const workerConcurrencySetting = settings.find((setting) => setting.id === SETTING_ID_WORKER_CONCURRENCY);
  const rawWorkerConcurrency = workerConcurrencySetting?.value;
  const parsedWorkerConcurrency = typeof rawWorkerConcurrency === "number"
    ? rawWorkerConcurrency
    : Number.parseInt(String(rawWorkerConcurrency ?? ""), 10);

  if (!Number.isFinite(parsedWorkerConcurrency)) {
    return config;
  }

  return {
    ...config,
    workerConcurrency: clamp(parsedWorkerConcurrency, 1, 16),
  };
}

export function inferSettingScope(settingId: string): RuntimeSettingScope {
  if (settingId.startsWith("runtime.")) return "runtime";
  if (settingId.startsWith("providers.")) return "providers";
  if (settingId.startsWith("ui.")) return "ui";
  return "system";
}

export async function persistSetting(
  id: string,
  value: unknown,
  options: {
    scope?: RuntimeSettingScope;
    source?: RuntimeSettingSource;
  } = {},
): Promise<RuntimeSettingRecord> {
  const setting: RuntimeSettingRecord = {
    id,
    scope: options.scope ?? inferSettingScope(id),
    value,
    source: options.source ?? "user",
    updatedAt: now(),
  };
  await replacePersistedSetting(setting);
  return setting;
}

export async function persistWorkerConcurrencySetting(value: number, source: RuntimeSettingRecord["source"] = "user"): Promise<void> {
  await persistSetting(
    SETTING_ID_WORKER_CONCURRENCY,
    clamp(Math.round(value), 1, 16),
    { scope: "runtime", source },
  );
}

export async function persistDetectedProvidersSetting(providers: DetectedProvider[]): Promise<void> {
  await persistSetting(
    SETTING_ID_DETECTED_PROVIDERS,
    {
      providers,
      detectedAt: now(),
    },
    { scope: "providers", source: "detected" },
  );
}
