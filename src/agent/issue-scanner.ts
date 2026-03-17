import { execFileSync } from "node:child_process";
import { logger } from "./logger.ts";
import {
  resolveTaskCapabilities,
} from "../routing/capability-resolver.ts";
import {
  getCapabilityRoutingOptions,
} from "./providers.ts";
import type { WorkflowDefinition } from "./types.ts";

export type ScannedIssue = {
  source: "todo" | "fixme" | "hack" | "github";
  title: string;
  file: string;
  line: number;
  context: string;
  category?: string;
  overlays?: string[];
  rationale?: string[];
  suggestedLabels?: string[];
  suggestedPaths?: string[];
};

const SCAN_PATTERN = /\b(TODO|FIXME|HACK|XXX)\b[:\s]*(.*)/i;

const EXCLUDE_DIRS = [
  "node_modules", ".git", ".fifony", "dist", "build",
  ".turbo", ".next", ".nuxt", "coverage", ".venv",
  "vendor", "tmp", "temp", "artifacts",
];

export function scanForTodos(targetRoot: string): ScannedIssue[] {
  const excludeArgs = EXCLUDE_DIRS.flatMap((dir) => ["--exclude-dir", dir]);

  let output: string;
  try {
    output = execFileSync("grep", [
      "-rn",
      "-E", "\\b(TODO|FIXME|HACK|XXX)\\b",
      ...excludeArgs,
      "--include=*.ts",
      "--include=*.tsx",
      "--include=*.js",
      "--include=*.jsx",
      "--include=*.py",
      "--include=*.rs",
      "--include=*.go",
      "--include=*.java",
      "--include=*.rb",
      "--include=*.php",
      "--include=*.cs",
      "--include=*.swift",
      "--include=*.kt",
      "--include=*.vue",
      "--include=*.svelte",
      targetRoot,
    ], {
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 5_000_000,
    });
  } catch (error: any) {
    // grep returns exit code 1 when no matches found
    if (error.status === 1) return [];
    if (error.stdout) output = error.stdout;
    else {
      logger.warn(`TODO scan failed: ${String(error)}`);
      return [];
    }
  }

  const results: ScannedIssue[] = [];
  const lines = output.split("\n").filter(Boolean);

  for (const line of lines) {
    // Format: file:line:content
    const match = line.match(/^(.+?):(\d+):(.+)$/);
    if (!match) continue;

    const [, file, lineNo, content] = match;
    const todoMatch = content.match(SCAN_PATTERN);
    if (!todoMatch) continue;

    const [, tag, text] = todoMatch;
    const source = tag.toLowerCase() as ScannedIssue["source"];
    const trimmedText = text.trim();
    if (!trimmedText || trimmedText.length < 5) continue;

    const relativePath = file.startsWith(targetRoot)
      ? file.slice(targetRoot.length + 1)
      : file;

    results.push({
      source: source === "xxx" ? "hack" : source,
      title: trimmedText.length > 120 ? `${trimmedText.slice(0, 117)}...` : trimmedText,
      file: relativePath,
      line: parseInt(lineNo, 10),
      context: content.trim(),
    });
  }

  return results;
}

/**
 * Enrich scanned issues with capability routing metadata.
 */
export function categorizeScannedIssues(
  issues: ScannedIssue[],
  workflowDefinition: WorkflowDefinition | null,
): ScannedIssue[] {
  const options = getCapabilityRoutingOptions(workflowDefinition);

  return issues.map((issue) => {
    const resolution = resolveTaskCapabilities({
      id: `scan-${issue.file}:${issue.line}`,
      identifier: `${issue.source}:${issue.file}:${issue.line}`,
      title: issue.title,
      description: issue.context,
      labels: [issue.source],
      paths: [issue.file],
    }, options);

    return {
      ...issue,
      category: resolution.category,
      overlays: resolution.overlays,
      rationale: resolution.rationale,
      suggestedLabels: [
        issue.source,
        resolution.category ? `capability:${resolution.category}` : "",
      ].filter(Boolean),
      suggestedPaths: [issue.file],
    };
  });
}
