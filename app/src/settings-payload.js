export function getSettingsList(payload) {
  if (Array.isArray(payload?.settings)) return payload.settings;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

export function getSettingValue(settings, settingId, fallback) {
  const entry = Array.isArray(settings) ? settings.find((setting) => setting?.id === settingId) : null;
  return entry?.value ?? fallback;
}

export function upsertSettingPayload(current, setting) {
  const payload = current && typeof current === "object" ? current : {};
  const settings = getSettingsList(payload).filter((entry) => entry?.id !== setting.id);
  const nextSettings = [...settings, setting];

  if (Array.isArray(payload?.settings)) {
    return { ...payload, settings: nextSettings };
  }

  return {
    ...payload,
    success: payload?.success ?? true,
    data: nextSettings,
  };
}
