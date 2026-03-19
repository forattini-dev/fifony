import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { IssuePlan, RuntimeConfig, IssueEntry, AgentTokenUsage } from "./types.ts";
import { appendFileTail, now } from "./helpers.ts";
import { detectAvailableProviders } from "./providers.ts";
import { getWorkflowConfig, loadRuntimeSettings } from "./settings.ts";
import { logger } from "./logger.ts";
import { record as recordTokens } from "./token-ledger.ts";
import { STATE_ROOT } from "./constants.ts";
import { type PlanningSessionUsage } from "./planning-session.ts";
import { parsePlanOutput, tryBuildPlan, extractPlanTokenUsage } from "./planning-parser.ts";
import { buildRefinePrompt, getPlanCommand } from "./planning-prompts.ts";

// ── Debug helpers ─────────────────────────────────────────────────────────────

function savePlanDebugFiles(slug: string, prompt: string, output: string): void {
  try {
    const debugDir = join(STATE_ROOT, "debug");
    mkdirSync(debugDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    writeFileSync(join(debugDir, `plan-${slug}-${ts}-prompt.md`), prompt, "utf8");
    if (output) writeFileSync(join(debugDir, `plan-${slug}-${ts}-output.txt`), output, "utf8");
  } catch {
    // non-critical
  }
}

// ── Public types ──────────────────────────────────────────────────────────────

export type RefinePlanResult = {
  plan: IssuePlan;
  usage: PlanningSessionUsage;
};

// ── Refine plan ───────────────────────────────────────────────────────────────

export async function refinePlan(
  issue: IssueEntry,
  feedback: string,
  config: RuntimeConfig,
  _workflowDefinition: null,
): Promise<RefinePlanResult> {
  if (!issue.plan) throw new Error("Issue has no plan to refine.");

  const providers = detectAvailableProviders();
  const available = providers.filter((p) => p.available).map((p) => p.name);

  // Use the same provider/model/effort logic as generatePlan
  let planStageProvider: string | undefined;
  let planStageModel: string | undefined;
  let planStageEffort: string | undefined;
  try {
    const settings = await loadRuntimeSettings();
    const workflowConfig = getWorkflowConfig(settings);
    if (workflowConfig?.plan) {
      planStageProvider = workflowConfig.plan.provider;
      planStageModel = workflowConfig.plan.model;
      planStageEffort = workflowConfig.plan.effort;
    }
  } catch {
    // Fall through to default provider selection
  }

  const configuredProvider = planStageProvider && available.includes(planStageProvider) ? planStageProvider : null;
  const preferred = configuredProvider
    ?? (available.includes("claude") ? "claude" : available[0]);
  if (!preferred) throw new Error("No AI provider available for plan refinement.");

  // If provider changed (configured wasn't available → fallback), discard provider-specific model
  if (preferred !== configuredProvider) planStageModel = undefined;

  const refineStartMs = Date.now();
  const prompt = await buildRefinePrompt(issue.title, issue.description, issue.plan, feedback);

  let plan: IssuePlan | null = null;
  let refineUsage: PlanningSessionUsage;

  // ── All providers: spawn CLI process ──
  {
    const command = getPlanCommand(preferred, planStageModel);
    if (!command) throw new Error(`No command configured for provider ${preferred}.`);

    const tempDir = mkdtempSync(join(tmpdir(), "fifony-refine-"));
    const promptFile = join(tempDir, "fifony-refine-prompt.md");

    writeFileSync(promptFile, `${prompt}\n`, "utf8");

    const output = await new Promise<string>((resolve, reject) => {
      let stdout = "";
      const child = spawn(command, {
        shell: true,
        cwd: tempDir,
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          FIFONY_PROMPT_FILE: promptFile,
          FIFONY_AGENT_PROVIDER: preferred,
        },
      });
      child.unref();
      child.stdin?.end();

      let refineOutputBytes = 0;
      child.stdout?.on("data", (chunk) => {
        stdout = appendFileTail(stdout, String(chunk), 32_000);
        refineOutputBytes += String(chunk).length;
      });
      child.stderr?.on("data", (chunk) => {
        stdout = appendFileTail(stdout, String(chunk), 32_000);
        refineOutputBytes += String(chunk).length;
      });

      const REFINE_TIMEOUT_MS = 1_800_000; // 30 minutes
      const REFINE_STALE_OUTPUT_MS = 300_000; // 5 minutes without output growth

      const timer = setTimeout(() => {
        if (child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
        else { child.kill("SIGTERM"); }
        reject(new Error("Plan refinement timed out after 30 minutes."));
      }, REFINE_TIMEOUT_MS);

      // Progress watchdog: check PID alive + output growing every 30s
      let lastRefineWatchdogBytes = 0;
      let lastRefineOutputGrowthAt = Date.now();
      const watchdog = setInterval(() => {
        // Check if PID is still alive
        if (child.pid) {
          try { process.kill(child.pid, 0); } catch {
            clearInterval(watchdog);
            clearTimeout(timer);
            reject(new Error(`Refinement process died unexpectedly (PID ${child.pid}).`));
            return;
          }
        }
        // Check if output is still growing
        if (refineOutputBytes > lastRefineWatchdogBytes) {
          lastRefineWatchdogBytes = refineOutputBytes;
          lastRefineOutputGrowthAt = Date.now();
        } else if (Date.now() - lastRefineOutputGrowthAt > REFINE_STALE_OUTPUT_MS) {
          clearInterval(watchdog);
          clearTimeout(timer);
          if (child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
          else { child.kill("SIGTERM"); }
          reject(new Error(`Refinement process stuck — no output for ${Math.round(REFINE_STALE_OUTPUT_MS / 60_000)} minutes.`));
        }
      }, 30_000);

      child.on("error", () => { clearInterval(watchdog); clearTimeout(timer); reject(new Error("Failed to execute refinement command.")); });
      child.on("close", (code) => {
        clearInterval(watchdog);
        clearTimeout(timer);
        rmSync(tempDir, { recursive: true, force: true });
        if (code !== 0) {
          reject(new Error(`Plan refinement failed (exit ${code}): ${stdout.slice(0, 500)}`));
          return;
        }
        resolve(stdout);
      });
    });

    logger.info({ rawOutput: output.slice(0, 2000) }, `Refine raw output from ${preferred}`);
    savePlanDebugFiles("refine-cli", prompt, output);

    plan = parsePlanOutput(output);

    const durationMs = Date.now() - refineStartMs;
    const tokenInfo = extractPlanTokenUsage(output);
    refineUsage = {
      inputTokens: tokenInfo?.inputTokens ?? 0,
      outputTokens: tokenInfo?.outputTokens ?? 0,
      totalTokens: tokenInfo?.totalTokens ?? 0,
      model: tokenInfo?.model || planStageModel || preferred,
      promptChars: prompt.length,
      outputChars: output.length,
      durationMs,
    };
  }

  if (!plan) {
    logger.error("[Planner] Could not parse refined plan from AI output");
    throw new Error("Could not parse refined plan from AI output.");
  }

  plan.provider = planStageModel ? `${preferred}/${planStageModel}` : preferred;

  // Carry over refinement history from the original plan and append the new refinement
  const existingRefinements = issue.plan.refinements ?? [];
  const nextVersion = existingRefinements.length + 1;
  plan.refinements = [
    ...existingRefinements,
    { feedback, at: now(), version: nextVersion },
  ];

  const durationMs = Date.now() - refineStartMs;
  refineUsage.durationMs = durationMs;

  // Record refinement tokens in the ledger
  if (refineUsage.totalTokens > 0) {
    const tokenUsage: AgentTokenUsage = {
      inputTokens: refineUsage.inputTokens,
      outputTokens: refineUsage.outputTokens,
      totalTokens: refineUsage.totalTokens,
      model: refineUsage.model,
    };
    recordTokens({ id: issue.id, identifier: issue.identifier, title: issue.title } as IssueEntry, tokenUsage, "planner");
  }

  const tokenSummary = refineUsage.totalTokens > 0
    ? `, ${refineUsage.totalTokens.toLocaleString()} tokens (in: ${refineUsage.inputTokens.toLocaleString()}, out: ${refineUsage.outputTokens.toLocaleString()})`
    : `, ${refineUsage.outputChars.toLocaleString()} output chars`;
  logger.info(`Plan refined for "${issue.title}" via ${refineUsage.model}: ${plan.steps.length} steps, complexity: ${plan.estimatedComplexity}${tokenSummary}, ${durationMs}ms`);
  return { plan, usage: refineUsage };
}
