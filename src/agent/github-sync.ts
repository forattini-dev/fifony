import { execFile } from "node:child_process";
import { logger } from "./logger.ts";
import type { ScannedIssue } from "./issue-scanner.ts";

type GitHubIssue = {
  number: number;
  title: string;
  body: string;
  labels: Array<{ name: string }>;
  state: string;
  url: string;
};

/**
 * Fetch open GitHub issues using the `gh` CLI (no API token dependency).
 * Returns them as ScannedIssue[] for uniform handling in the dashboard.
 */
export async function fetchGitHubIssues(targetRoot: string): Promise<ScannedIssue[]> {
  return new Promise((resolve) => {
    execFile(
      "gh",
      [
        "issue", "list",
        "--json", "number,title,body,labels,state,url",
        "--state", "open",
        "--limit", "50",
      ],
      {
        cwd: targetRoot,
        timeout: 15_000,
        maxBuffer: 2_000_000,
      },
      (error, stdout) => {
        if (error) {
          logger.warn(`Failed to fetch GitHub issues: ${String(error)}`);
          resolve([]);
          return;
        }

        try {
          const issues = JSON.parse(stdout.trim()) as GitHubIssue[];
          const results: ScannedIssue[] = issues.map((issue) => ({
            source: "github" as const,
            title: issue.title,
            file: "",
            line: 0,
            context: (issue.body || "").slice(0, 500),
            suggestedLabels: issue.labels.map((l) => l.name),
            suggestedPaths: [],
          }));
          resolve(results);
        } catch (parseError) {
          logger.warn(`Failed to parse GitHub issues: ${String(parseError)}`);
          resolve([]);
        }
      },
    );
  });
}
