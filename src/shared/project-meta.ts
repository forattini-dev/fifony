export const PROJECT_NAME_SETTING_ID = "system.projectName";

type SettingLike = {
  id?: string;
  value?: unknown;
} | null | undefined;

export function normalizeProjectName(value: unknown): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ")
    : "";
}

export function detectProjectNameFromPath(path: unknown): string {
  const normalizedPath = typeof path === "string"
    ? path.trim().replace(/[\\/]+$/, "")
    : "";
  if (!normalizedPath) return "";
  const segments = normalizedPath.split(/[\\/]+/).filter(Boolean);
  return normalizeProjectName(segments.at(-1) || "");
}

export function readSavedProjectName(settings: SettingLike[]): string {
  const list = Array.isArray(settings) ? settings : [];
  return normalizeProjectName(list.find((setting) => setting?.id === PROJECT_NAME_SETTING_ID)?.value);
}

export function buildQueueTitle(projectName: string): string {
  const normalizedProjectName = normalizeProjectName(projectName);
  return normalizedProjectName ? `fifony: ${normalizedProjectName}` : "fifony";
}

export function buildProjectDraft(
  {
    savedProjectName = "",
    detectedProjectName = "",
  }: {
    savedProjectName?: string;
    detectedProjectName?: string;
  } = {},
) {
  const saved = normalizeProjectName(savedProjectName);
  const detected = normalizeProjectName(detectedProjectName);
  const projectName = saved || detected;

  return {
    projectName,
    detectedProjectName: detected,
    source: saved ? "saved" : detected ? "detected" : "missing",
    requiresManualEntry: !projectName,
  } as const;
}
