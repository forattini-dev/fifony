import { execFile } from "node:child_process";
import type { IssueEntry, RuntimeConfig, ValidationResult } from "../types.ts";
import { logger } from "../concerns/logger.ts";

/**
 * Run the configured test command as a validation gate (async — does not block event loop).
 * Returns null if no testCommand is configured (no-op).
 */
export async function runValidationGate(issue: IssueEntry, config: RuntimeConfig): Promise<ValidationResult | null> {
  if (!config.testCommand) return null;

  const cwd = issue.worktreePath ?? issue.workspacePath;
  if (!cwd) {
    logger.warn({ issueId: issue.id }, "[Validation] No workspace path — skipping gate");
    return null;
  }

  const command = config.testCommand;
  logger.info({ issueId: issue.id, command, cwd }, "[Validation] Running validation gate");

  return new Promise((resolve) => {
    // Use shell: true so the user's testCommand can contain pipes, &&, etc.
    const child = execFile("sh", ["-c", command], {
      cwd,
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 2 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      const combined = (stdout || "") + (stderr || "");

      if (!err) {
        logger.info({ issueId: issue.id }, "[Validation] Gate passed");
        resolve({
          passed: true,
          output: combined.slice(-2048),
          command,
          ranAt: new Date().toISOString(),
        });
        return;
      }

      logger.warn({ issueId: issue.id, exitCode: (err as any).code }, "[Validation] Gate failed");
      resolve({
        passed: false,
        output: combined.slice(-2048) || String(err).slice(0, 2048),
        command,
        ranAt: new Date().toISOString(),
      });
    });
  });
}
