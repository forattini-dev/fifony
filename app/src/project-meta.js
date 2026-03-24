// NOTE: Core functions (normalizeProjectName, buildQueueTitle, readSavedProjectName)
// are intentionally duplicated from src/domains/project.ts because the frontend
// cannot import backend modules that depend on Node.js APIs (fs, crypto, etc).
export const PROJECT_SETTING_ID = "system.projectName";

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
  const list = Array.isArray(settings) ? settings : [];
  return normalizeProjectName(list.find((s) => s?.id === PROJECT_SETTING_ID)?.value);
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
