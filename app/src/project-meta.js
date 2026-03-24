import {
  PROJECT_NAME_SETTING_ID,
  buildProjectDraft,
  buildQueueTitle,
  detectProjectNameFromPath,
  normalizeProjectName,
  readSavedProjectName,
} from "../../src/shared/project-meta.ts";

export const PROJECT_SETTING_ID = PROJECT_NAME_SETTING_ID;
export {
  buildProjectDraft,
  buildQueueTitle,
  detectProjectNameFromPath,
  normalizeProjectName,
  readSavedProjectName,
};

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
