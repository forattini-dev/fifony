import { basename } from "node:path";
import type { ProjectNameSource, RuntimeSettingRecord } from "./types.ts";

export const SETTING_ID_PROJECT_NAME = "system.projectName";
export const LEGACY_PROJECT_SETTING_IDS = [
  "runtime.projectName",
  "ui.projectName",
  "projectName",
  "project.name",
];

export type ProjectMetadata = {
  projectName: string;
  detectedProjectName: string;
  projectNameSource: ProjectNameSource;
  queueTitle: string;
};

export function normalizeProjectName(value: unknown): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ")
    : "";
}

export function detectProjectName(targetRoot: string): string {
  const normalizedPath = typeof targetRoot === "string"
    ? targetRoot.trim().replace(/[\\/]+$/, "")
    : "";
  if (!normalizedPath) return "";
  return normalizeProjectName(basename(normalizedPath));
}

export function readSavedProjectName(settings: RuntimeSettingRecord[]): string {
  const settingIds = [SETTING_ID_PROJECT_NAME, ...LEGACY_PROJECT_SETTING_IDS];

  for (const id of settingIds) {
    const value = normalizeProjectName(settings.find((setting) => setting.id === id)?.value);
    if (value) {
      return value;
    }
  }

  return "";
}

export function buildQueueTitle(projectName: string): string {
  const normalizedProjectName = normalizeProjectName(projectName);
  return normalizedProjectName ? `fifony: ${normalizedProjectName}` : "fifony";
}

export function resolveProjectMetadata(
  settings: RuntimeSettingRecord[],
  targetRoot: string,
): ProjectMetadata {
  const savedProjectName = readSavedProjectName(settings);
  const detectedProjectName = detectProjectName(targetRoot);
  const projectName = savedProjectName || detectedProjectName;

  return {
    projectName,
    detectedProjectName,
    projectNameSource: savedProjectName ? "saved" : detectedProjectName ? "detected" : "missing",
    queueTitle: buildQueueTitle(projectName),
  };
}
