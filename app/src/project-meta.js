export const PROJECT_SETTING_ID = "system.projectName";
export const LEGACY_PROJECT_SETTING_IDS = [
  "runtime.projectName",
  "ui.projectName",
  "projectName",
  "project.name",
];

export function normalizeProjectName(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ")
    : "";
}

export function detectProjectNameFromPath(path) {
  const normalizedPath = typeof path === "string"
    ? path.trim().replace(/[\\/]+$/, "")
    : "";
  if (!normalizedPath) return "";
  const segments = normalizedPath.split(/[\\/]+/).filter(Boolean);
  return normalizeProjectName(segments.at(-1) || "");
}

export function readSavedProjectName(settings) {
  const settingIds = [PROJECT_SETTING_ID, ...LEGACY_PROJECT_SETTING_IDS];
  const list = Array.isArray(settings) ? settings : [];

  for (const id of settingIds) {
    const entry = list.find((setting) => setting?.id === id);
    const value = normalizeProjectName(entry?.value);
    if (value) {
      return value;
    }
  }

  return "";
}

export function buildQueueTitle(projectName) {
  const normalizedProjectName = normalizeProjectName(projectName);
  return normalizedProjectName ? `fifony: ${normalizedProjectName}` : "fifony";
}

export function buildProjectDraft({ savedProjectName = "", detectedProjectName = "" } = {}) {
  const saved = normalizeProjectName(savedProjectName);
  const detected = normalizeProjectName(detectedProjectName);
  const projectName = saved || detected;

  return {
    projectName,
    detectedProjectName: detected,
    source: saved ? "saved" : detected ? "detected" : "missing",
    requiresManualEntry: !projectName,
  };
}

export function resolveProjectMeta(settings, runtimeState = {}) {
  const savedProjectName = readSavedProjectName(settings);
  const detectedProjectName = normalizeProjectName(runtimeState?.detectedProjectName)
    || detectProjectNameFromPath(runtimeState?.sourceRepoUrl || runtimeState?.config?.sourceRepo || "");
  const runtimeProjectName = normalizeProjectName(runtimeState?.projectName);
  const runtimeSource = runtimeState?.projectNameSource;
  const draft = buildProjectDraft({
    savedProjectName,
    detectedProjectName,
  });

  const projectName = draft.projectName || runtimeProjectName;
  const source = draft.source !== "missing"
    ? draft.source
    : runtimeSource === "saved" || runtimeSource === "detected"
      ? runtimeSource
      : projectName
        ? "detected"
        : "missing";

  return {
    projectName,
    detectedProjectName: draft.detectedProjectName,
    source,
    queueTitle: buildQueueTitle(projectName),
  };
}
