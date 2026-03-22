import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Dirent, existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { env } from "node:process";
import { logger } from "../concerns/logger.ts";
import { collectClaudeUsageFromCli } from "./adapters/claude.ts";
import { collectCodexUsageFromCli } from "./adapters/codex.ts";
import { collectGeminiUsageFromCli } from "./adapters/gemini.ts";
import type { RateLimitEntry } from "./adapters/usage.ts";

const execFileAsync = promisify(execFile);

async function whichExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync("which", [cmd], { encoding: "utf8", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ModelInfo {
  slug: string;
  displayName: string;
  description: string;
}

interface UsagePeriod {
  inputTokens: number;
  outputTokens: number;
  tokensUsed: number;
  sessions: number;
  since: string;
}

interface ProviderUsage {
  name: string;
  available: boolean;
  models: ModelInfo[];
  currentModel: string;
  usage: {
    today: UsagePeriod;
    thisWeek: UsagePeriod;
    last5Hours: UsagePeriod;
    allTime: UsagePeriod;
  };
  resetInfo: string;
  nextResetAt: string;
  weeklyLimitEstimate: number | null;
  percentUsed: number | null;
  version: string | null;
  plan: string | null;
  account: string | null;
  effort: string | null;
  rateLimits: RateLimitEntry[];
}

interface ProvidersUsageResult {
  providers: ProviderUsage[];
  collectedAt: string;
}

const PROVIDER_USAGE_ORDER = ["claude", "codex", "gemini"] as const;

type ProviderUsageName = (typeof PROVIDER_USAGE_ORDER)[number];

function normalizeProviderName(name: string): ProviderUsageName | null {
  const normalized = (name || "").trim().toLowerCase();
  return PROVIDER_USAGE_ORDER.includes(normalized as ProviderUsageName)
    ? (normalized as ProviderUsageName)
    : null;
}

function resolveCodexHomeCandidates(): string[] {
  const homePaths = new Set<string>([
    homedir(),
    env.XDG_STATE_HOME?.trim() || "",
    env.XDG_DATA_HOME?.trim() || "",
  ]);

  const sudoUser = env.SUDO_USER?.trim();
  if (sudoUser && sudoUser !== "root") {
    homePaths.add(`/home/${sudoUser}`);
  }

  const direct = new Set<string>([
    env.CODEX_HOME?.trim() || "",
  ]);

  const candidates = [...homePaths, ...direct]
    .filter(Boolean)
    .flatMap((candidate) => {
      if (candidate.endsWith("/.codex") || candidate.endsWith("/codex")) return [candidate];
      return [join(candidate, ".codex"), join(candidate, "codex")];
    });

  return [...new Set(candidates)];
}

function resolveCodexDir(): string | null {
  for (const candidate of resolveCodexHomeCandidates()) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function findLatestCodexDb(codexDir: string): string | null {
  const explicit = join(codexDir, "state_5.sqlite");
  if (existsSync(explicit)) return explicit;

  const candidates = readdirSync(codexDir)
    .filter((name) => name.startsWith("state_") && name.endsWith(".sqlite"))
    .sort()
    .reverse();

  if (candidates.length === 0) return null;
  return join(codexDir, candidates[0]);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeNextMonday(): Date {
  const now = new Date();
  const utcDay = now.getUTCDay();
  const daysUntilMonday = utcDay === 0 ? 1 : utcDay === 1 ? 7 : 8 - utcDay;
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + daysUntilMonday);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function computeWeekStart(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const utcDay = d.getUTCDay();
  const daysFromMonday = utcDay === 0 ? 6 : utcDay - 1;
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  return d;
}

function computeTodayStart(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function computeLastHoursStart(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makePeriod(input: number, output: number, sessions: number, since: string): UsagePeriod {
  return { inputTokens: input, outputTokens: output, tokensUsed: input + output, sessions, since };
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseTimestamp(value: unknown): number {
  if (typeof value !== "string") return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function parseNumber(value: string | undefined | null): number {
  if (!value) return 0;
  const clean = value.replace(/[^\d]/g, "");
  if (!clean) return 0;
  const parsed = Number.parseInt(clean, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function keepLargest(current: number | null, incoming: number): number {
  if (!Number.isFinite(incoming)) return current ?? 0;
  if (incoming <= 0) return current ?? 0;
  return current === null ? incoming : Math.max(current, incoming);
}

// Known weekly token limits per plan (approximate, based on public info)
const CLAUDE_PLAN_LIMITS: Record<string, number> = {
  pro: 45_000_000,      // ~45M tokens/week (Pro plan estimate)
  max: 135_000_000,     // ~135M tokens/week (Max plan)
  max5x: 675_000_000,   // ~675M tokens/week (Max 5x plan)
};

/** Map display names from CLI banner (e.g. "Claude Max") to plan keys. */
function resolveClaudePlanKey(displayName: string): string | null {
  const lower = displayName.toLowerCase().trim();
  if (/max\s*5x/i.test(lower)) return "max5x";
  if (/max/i.test(lower)) return "max";
  if (/pro/i.test(lower)) return "pro";
  if (/free/i.test(lower)) return null;
  return null;
}

// ── Claude usage (from JSONL session files) ──────────────────────────────────

async function collectClaudeUsage(): Promise<ProviderUsage | null> {
  const home = homedir();
  const claudeDir = join(home, ".claude");
  if (!existsSync(claudeDir)) return null;

  const available = await whichExists("claude");

  // Aggregate token usage from all project session files
  const projectsDir = join(claudeDir, "projects");
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalSessions = 0;
  let todayInputTokens = 0;
  let todayOutputTokens = 0;
  let todaySessions = 0;
  let weekInputTokens = 0;
  let weekOutputTokens = 0;
  let weekSessions = 0;
  let last5hInputTokens = 0;
  let last5hOutputTokens = 0;
  let last5hSessions = 0;

  const todayStart = computeTodayStart();
  const todayMs = todayStart.getTime();
  const weekStart = computeWeekStart();
  const weekMs = weekStart.getTime();
  const last5hStart = computeLastHoursStart(5);
  const last5hMs = last5hStart.getTime();

  if (existsSync(projectsDir)) {
    try {
      const projectDirs = readdirSync(projectsDir, { withFileTypes: true });
      for (const dir of projectDirs) {
        if (!dir.isDirectory()) continue;
        const projectPath = join(projectsDir, dir.name);

        let sessionFiles: string[];
        try {
          sessionFiles = readdirSync(projectPath)
            .filter((f) => f.endsWith(".jsonl"));
        } catch {
          continue;
        }

        for (const file of sessionFiles) {
          const filePath = join(projectPath, file);
          let content: string;
          try {
            content = readFileSync(filePath, "utf8");
          } catch {
            continue;
          }

          let sessionCounted = false;
          let sessionTodayCounted = false;
          let sessionWeekCounted = false;
          let sessionLast5hCounted = false;

          for (const line of content.split("\n")) {
            if (!line.trim()) continue;
            try {
              const entry = JSON.parse(line);
              if (entry.type !== "assistant" || !entry.message?.usage) continue;

              const usage = entry.message.usage;
              // Only count actual billed tokens — cache reads are free/cheap
              const inputTokens = (usage.input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0);
              const outputTokens = usage.output_tokens || 0;

              totalInputTokens += inputTokens;
              totalOutputTokens += outputTokens;
              if (!sessionCounted) {
                totalSessions++;
                sessionCounted = true;
              }

              const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;

              if (timestamp >= todayMs) {
                todayInputTokens += inputTokens;
                todayOutputTokens += outputTokens;
                if (!sessionTodayCounted) {
                  todaySessions++;
                  sessionTodayCounted = true;
                }
              }

              if (timestamp >= weekMs) {
                weekInputTokens += inputTokens;
                weekOutputTokens += outputTokens;
                if (!sessionWeekCounted) {
                  weekSessions++;
                  sessionWeekCounted = true;
                }
              }

              if (timestamp >= last5hMs) {
                last5hInputTokens += inputTokens;
                last5hOutputTokens += outputTokens;
                if (!sessionLast5hCounted) {
                  last5hSessions++;
                  sessionLast5hCounted = true;
                }
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      logger.debug(`Failed to read Claude session files: ${String(err)}`);
    }
  }

  // Claude models (known models for Claude Code)
  const models: ModelInfo[] = [
    { slug: "claude-opus-4-6", displayName: "claude-opus-4-6", description: "Most capable for complex work" },
    { slug: "claude-sonnet-4-6", displayName: "claude-sonnet-4-6", description: "Best for everyday tasks" },
    { slug: "claude-sonnet-4-6-1m", displayName: "claude-sonnet-4-6 (1m context)", description: "Billed as extra usage · $3/$15 per Mtok" },
    { slug: "claude-haiku-4-5", displayName: "claude-haiku-4-5", description: "Fastest for quick answers" },
  ];

  // Detect subscription type and configured model from settings
  let plan = "pro";
  let resetInfo = "Weekly reset (every Monday 00:00 UTC)";
  let currentModel = "";
  const settingsPath = join(claudeDir, "settings.json");
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      if (settings.plan === "max" || settings.plan === "max5x") {
        plan = settings.plan;
        resetInfo = `Plan: ${settings.plan.toUpperCase()} — Weekly token limit resets every Monday 00:00 UTC`;
      }
      if (typeof settings.model === "string" && settings.model.trim()) {
        currentModel = settings.model.trim();
      }
    } catch {}
  }

  let nextResetAt = computeNextMonday().toISOString();
  let weeklyLimit = CLAUDE_PLAN_LIMITS[plan] ?? null;
  const weeklyUsed = weekInputTokens + weekOutputTokens;
  const percentUsed = weeklyLimit ? Math.min(100, Math.round((weeklyUsed / weeklyLimit) * 100)) : null;

  const statusUsage = await collectClaudeUsageFromCli();
  if (statusUsage) {
    if (statusUsage.currentModel) {
      currentModel = statusUsage.currentModel;
    }
    // Map CLI plan name (e.g. "Claude Max") → plan key → weekly limit
    if (statusUsage.plan) {
      const planKey = resolveClaudePlanKey(statusUsage.plan);
      if (planKey && CLAUDE_PLAN_LIMITS[planKey]) {
        plan = planKey;
        weeklyLimit = CLAUDE_PLAN_LIMITS[planKey];
      }
    }
    if (statusUsage.weeklyLimitEstimate !== null) {
      weeklyLimit = statusUsage.weeklyLimitEstimate;
    }
    if (statusUsage.thisWeekInputTokens !== null || statusUsage.thisWeekOutputTokens !== null) {
      weekInputTokens = statusUsage.thisWeekInputTokens ?? weekInputTokens;
      weekOutputTokens = statusUsage.thisWeekOutputTokens ?? weekOutputTokens;
      if (statusUsage.thisWeekSessions !== null) weekSessions = statusUsage.thisWeekSessions;
    }
    if (statusUsage.todayInputTokens !== null || statusUsage.todayOutputTokens !== null) {
      todayInputTokens = statusUsage.todayInputTokens ?? todayInputTokens;
      todayOutputTokens = statusUsage.todayOutputTokens ?? todayOutputTokens;
      if (statusUsage.todaySessions !== null) todaySessions = statusUsage.todaySessions;
    }
    if (statusUsage.last5HoursInputTokens !== null || statusUsage.last5HoursOutputTokens !== null) {
      last5hInputTokens = statusUsage.last5HoursInputTokens ?? last5hInputTokens;
      last5hOutputTokens = statusUsage.last5HoursOutputTokens ?? last5hOutputTokens;
      if (statusUsage.last5HoursSessions !== null) last5hSessions = statusUsage.last5HoursSessions;
    }
    if (statusUsage.allTimeInputTokens !== null || statusUsage.allTimeOutputTokens !== null) {
      totalInputTokens = statusUsage.allTimeInputTokens ?? totalInputTokens;
      totalOutputTokens = statusUsage.allTimeOutputTokens ?? totalOutputTokens;
      if (statusUsage.allTimeSessions !== null) totalSessions = statusUsage.allTimeSessions;
    }
    if (statusUsage.resetInfo) {
      resetInfo = statusUsage.resetInfo;
    }
    if (statusUsage.nextResetAt) {
      nextResetAt = statusUsage.nextResetAt;
    }
  }

  const finalPercentUsed = weeklyLimit ? Math.min(100, Math.round(((weekInputTokens + weekOutputTokens) / weeklyLimit) * 100)) : percentUsed;

  return {
    name: "claude",
    available,
    models,
    currentModel,
    usage: {
      today: makePeriod(todayInputTokens, todayOutputTokens, todaySessions, todayStart.toISOString()),
      thisWeek: makePeriod(weekInputTokens, weekOutputTokens, weekSessions, weekStart.toISOString()),
      last5Hours: makePeriod(last5hInputTokens, last5hOutputTokens, last5hSessions, last5hStart.toISOString()),
      allTime: makePeriod(totalInputTokens, totalOutputTokens, totalSessions, ""),
    },
    resetInfo,
    nextResetAt,
    weeklyLimitEstimate: weeklyLimit,
    percentUsed: finalPercentUsed,
    version: statusUsage?.version ?? null,
    plan: statusUsage?.plan ?? (plan !== "pro" ? plan.toUpperCase() : "Pro"),
    account: statusUsage?.account ?? null,
    effort: statusUsage?.effort ?? null,
    rateLimits: statusUsage?.rateLimits ?? [],
  };
}

// ── Codex usage (from SQLite state DB) ───────────────────────────────────────

interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  timestampMs: number;
}

function aggregateCodexSessionUsageFromJsonl(lines: string[]): SessionUsage {
  let maxInput = 0;
  let maxOutput = 0;
  let maxTotal = 0;
  let sessionTs = 0;

  for (const line of lines) {
    if (!line.trim()) continue;

    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const lineTs = parseTimestamp(entry?.timestamp);
    const payloadTs = parseTimestamp(entry?.payload?.timestamp);
    const candidateTs = Math.max(lineTs, payloadTs);
    if (candidateTs > sessionTs) sessionTs = candidateTs;

    if (entry.type !== "event_msg") continue;
    if (entry.payload?.type !== "token_count") continue;

    const info = entry.payload?.info || {};
    const usage = info.total_token_usage || info.last_token_usage;
    if (!usage || typeof usage !== "object") continue;

    const input = toNumber(usage.input_tokens);
    const output = toNumber(usage.output_tokens);
    const total = toNumber(usage.total_tokens);
    if (total <= 0) continue;

    if (total > maxTotal) {
      maxTotal = total;
      maxInput = input;
      maxOutput = output;
    }
  }

  if (maxTotal <= 0) return { inputTokens: 0, outputTokens: 0, totalTokens: 0, timestampMs: sessionTs };

  return {
    inputTokens: maxInput,
    outputTokens: maxOutput,
    totalTokens: maxTotal,
    timestampMs: sessionTs,
  };
}

function collectCodexSessionUsagesFromJsonl(codexDir: string): SessionUsage[] {
  const sessionsDir = join(codexDir, "sessions");
  if (!existsSync(sessionsDir)) return [];

  const stack = [sessionsDir];
  const usageByFile: SessionUsage[] = [];
  const seen = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);

    let entries: Dirent[] = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const next = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(next);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      try {
        const content = readFileSync(next, "utf8");
        const usage = aggregateCodexSessionUsageFromJsonl(content.split("\n"));
        if (usage.totalTokens > 0) {
          usageByFile.push(usage);
        }
      } catch {}
    }
  }

  return usageByFile;
}

async function collectCodexUsage(): Promise<ProviderUsage | null> {
  const codexDir = resolveCodexDir();
  if (!codexDir) return null;

  const available = await whichExists("codex");

  // Read models from cache
  const models: ModelInfo[] = [];
  const modelsCachePath = join(codexDir, "models_cache.json");
  let currentModel = "";

  if (existsSync(modelsCachePath)) {
    try {
      const cache = JSON.parse(readFileSync(modelsCachePath, "utf8"));
      for (const m of cache.models || []) {
        models.push({
          slug: m.slug,
          displayName: (m.display_name || m.slug).toLowerCase(),
          description: (m.description || "").slice(0, 80),
        });
      }
    } catch {}
  }

  // Read current model from config
  const configPath = join(codexDir, "config.toml");
  if (existsSync(configPath)) {
    try {
      const configContent = readFileSync(configPath, "utf8");
      const modelMatch = configContent.match(/^model\s*=\s*"([^"]+)"/m);
      if (modelMatch) currentModel = modelMatch[1];
    } catch {}
  }

  const todayStart = computeTodayStart();
  const weekStart = computeWeekStart();
  let nextResetAt = computeNextMonday().toISOString();
  let resetInfo = "Weekly rate limit resets every Monday";
  const last5hStart = computeLastHoursStart(5);
  const last5hMs = last5hStart.getTime();
  const todayMs = todayStart.getTime();
  const weekMs = weekStart.getTime();

  // Find the right SQLite file
  const dbPath = findLatestCodexDb(codexDir);
  let allTimeTokens = 0;
  let allTimeSessions = 0;
  let todayTokens = 0;
  let todaySessions = 0;
  let weekTokens = 0;
  let weekSessions = 0;
  let last5hTokens = 0;
  let last5hSessions = 0;
  let allTimeInputTokens = 0;
  let allTimeOutputTokens = 0;
  let todayInputTokens = 0;
  let todayOutputTokens = 0;
  let weekInputTokens = 0;
  let weekOutputTokens = 0;
  let last5hInputTokens = 0;
  let last5hOutputTokens = 0;

  const todayUnix = Math.floor(todayStart.getTime() / 1000);
  const weekUnix = Math.floor(weekStart.getTime() / 1000);
  const last5hUnix = Math.floor(last5hStart.getTime() / 1000);

  if (dbPath) {
    try {
      const query = `
        SELECT
          SUM(tokens_used) as total_tokens,
          COUNT(*) as total_sessions,
          SUM(CASE WHEN created_at >= ${todayUnix} THEN tokens_used ELSE 0 END) as today_tokens,
          SUM(CASE WHEN created_at >= ${todayUnix} THEN 1 ELSE 0 END) as today_sessions,
          SUM(CASE WHEN created_at >= ${weekUnix} THEN tokens_used ELSE 0 END) as week_tokens,
          SUM(CASE WHEN created_at >= ${weekUnix} THEN 1 ELSE 0 END) as week_sessions,
          SUM(CASE WHEN created_at >= ${last5hUnix} THEN tokens_used ELSE 0 END) as last5h_tokens,
          SUM(CASE WHEN created_at >= ${last5hUnix} THEN 1 ELSE 0 END) as last5h_sessions
        FROM threads;
      `;
      const { stdout } = await execFileAsync("sqlite3", [dbPath, query], {
        encoding: "utf8",
        timeout: 5000,
      });
      const result = stdout.trim();

      if (result) {
        const parts = result.split("|");
        allTimeTokens = parseInt(parts[0], 10) || 0;
        allTimeSessions = parseInt(parts[1], 10) || 0;
        todayTokens = parseInt(parts[2], 10) || 0;
        todaySessions = parseInt(parts[3], 10) || 0;
        weekTokens = parseInt(parts[4], 10) || 0;
        weekSessions = parseInt(parts[5], 10) || 0;
        last5hTokens = parseInt(parts[6], 10) || 0;
        last5hSessions = parseInt(parts[7], 10) || 0;
      }
    } catch (err) {
      logger.debug(`Failed to query Codex SQLite: ${String(err)}`);
    }
  }

  const sessionUsages = collectCodexSessionUsagesFromJsonl(codexDir);
  if (sessionUsages.length > 0) {
    // If SQLite is not available or missing usage splits, build usage from JSONL logs.
    let jsonlAllTimeInput = 0;
    let jsonlAllTimeOutput = 0;
    let jsonlAllTimeTokens = 0;
    let jsonlAllTimeSessions = 0;
    let jsonlTodayInput = 0;
    let jsonlTodayOutput = 0;
    let jsonlTodaySessions = 0;
    let jsonlWeekInput = 0;
    let jsonlWeekOutput = 0;
    let jsonlWeekSessions = 0;
    let jsonlLast5hInput = 0;
    let jsonlLast5hOutput = 0;
    let jsonlLast5hSessions = 0;

    for (const usage of sessionUsages) {
      if (usage.totalTokens <= 0) continue;
      jsonlAllTimeInput += usage.inputTokens;
      jsonlAllTimeOutput += usage.outputTokens;
      jsonlAllTimeTokens += usage.totalTokens;
      jsonlAllTimeSessions++;

      if (usage.timestampMs >= todayMs) {
        jsonlTodayInput += usage.inputTokens;
        jsonlTodayOutput += usage.outputTokens;
        jsonlTodaySessions++;
      }
      if (usage.timestampMs >= weekMs) {
        jsonlWeekInput += usage.inputTokens;
        jsonlWeekOutput += usage.outputTokens;
        jsonlWeekSessions++;
      }
      if (usage.timestampMs >= last5hMs) {
        jsonlLast5hInput += usage.inputTokens;
        jsonlLast5hOutput += usage.outputTokens;
        jsonlLast5hSessions++;
      }
    }

    if (allTimeTokens === 0 && allTimeSessions === 0) {
      allTimeTokens = jsonlAllTimeTokens;
      allTimeSessions = jsonlAllTimeSessions;
      todayTokens = jsonlTodayInput + jsonlTodayOutput;
      todaySessions = jsonlTodaySessions;
      weekTokens = jsonlWeekInput + jsonlWeekOutput;
      weekSessions = jsonlWeekSessions;
      last5hTokens = jsonlLast5hInput + jsonlLast5hOutput;
      last5hSessions = jsonlLast5hSessions;
    } else {
      allTimeInputTokens = jsonlAllTimeInput;
      allTimeOutputTokens = jsonlAllTimeOutput;
      todayInputTokens = jsonlTodayInput;
      todayOutputTokens = jsonlTodayOutput;
      weekInputTokens = jsonlWeekInput;
      weekOutputTokens = jsonlWeekOutput;
      last5hInputTokens = jsonlLast5hInput;
      last5hOutputTokens = jsonlLast5hOutput;
    }

    // Fallback sessions in case SQLite returns zero counts with populated logs.
    if (allTimeSessions === 0) allTimeSessions = jsonlAllTimeSessions;
    if (todaySessions === 0) todaySessions = jsonlTodaySessions;
    if (weekSessions === 0) weekSessions = jsonlWeekSessions;
    if (last5hSessions === 0) last5hSessions = jsonlLast5hSessions;
  }

  // If SQLiite reported totals but no token split, use the JSONL split when available.
  if (allTimeInputTokens === 0 && allTimeOutputTokens === 0 && sessionUsages.length > 0) {
    for (const usage of sessionUsages) {
      if (usage.totalTokens <= 0) continue;
      allTimeInputTokens += usage.inputTokens;
      allTimeOutputTokens += usage.outputTokens;
    }
    if (allTimeInputTokens > 0 || allTimeOutputTokens > 0) {
      todayInputTokens = 0;
      todayOutputTokens = 0;
      weekInputTokens = 0;
      weekOutputTokens = 0;
      last5hInputTokens = 0;
      last5hOutputTokens = 0;
      for (const usage of sessionUsages) {
        if (usage.timestampMs >= todayMs) {
          todayInputTokens += usage.inputTokens;
          todayOutputTokens += usage.outputTokens;
        }
        if (usage.timestampMs >= weekMs) {
          weekInputTokens += usage.inputTokens;
          weekOutputTokens += usage.outputTokens;
        }
        if (usage.timestampMs >= last5hMs) {
          last5hInputTokens += usage.inputTokens;
          last5hOutputTokens += usage.outputTokens;
        }
      }
    }
  }

  // If we only have SQLite totals, report whole usage under input to avoid zeroed display.
  if (allTimeInputTokens === 0 && allTimeOutputTokens === 0) {
    allTimeInputTokens = allTimeTokens;
  }
  if (todayInputTokens === 0 && todayOutputTokens === 0) {
    todayInputTokens = todayTokens;
  }
  if (weekInputTokens === 0 && weekOutputTokens === 0) {
    weekInputTokens = weekTokens;
  }
  if (last5hInputTokens === 0 && last5hOutputTokens === 0) {
    last5hInputTokens = last5hTokens;
  }

  const statusUsage = await collectCodexUsageFromCli();
  if (statusUsage) {
    if (statusUsage.currentModel) {
      currentModel = statusUsage.currentModel;
    }
    if (statusUsage.allTimeInputTokens !== null || statusUsage.allTimeOutputTokens !== null) {
      allTimeInputTokens = statusUsage.allTimeInputTokens ?? allTimeInputTokens;
      allTimeOutputTokens = statusUsage.allTimeOutputTokens ?? allTimeOutputTokens;
      if (statusUsage.allTimeSessions !== null) allTimeSessions = statusUsage.allTimeSessions;
    }
    if (statusUsage.todayInputTokens !== null || statusUsage.todayOutputTokens !== null) {
      todayInputTokens = statusUsage.todayInputTokens ?? todayInputTokens;
      todayOutputTokens = statusUsage.todayOutputTokens ?? todayOutputTokens;
      if (statusUsage.todaySessions !== null) todaySessions = statusUsage.todaySessions;
    }
    if (statusUsage.thisWeekInputTokens !== null || statusUsage.thisWeekOutputTokens !== null) {
      weekInputTokens = statusUsage.thisWeekInputTokens ?? weekInputTokens;
      weekOutputTokens = statusUsage.thisWeekOutputTokens ?? weekOutputTokens;
      if (statusUsage.thisWeekSessions !== null) weekSessions = statusUsage.thisWeekSessions;
    }
    if (statusUsage.last5HoursInputTokens !== null || statusUsage.last5HoursOutputTokens !== null) {
      last5hInputTokens = statusUsage.last5HoursInputTokens ?? last5hInputTokens;
      last5hOutputTokens = statusUsage.last5HoursOutputTokens ?? last5hOutputTokens;
      if (statusUsage.last5HoursSessions !== null) last5hSessions = statusUsage.last5HoursSessions;
    }
    if (statusUsage.resetInfo) {
      resetInfo = statusUsage.resetInfo;
    }
    if (statusUsage.nextResetAt) {
      nextResetAt = statusUsage.nextResetAt;
    }
  }

  // Codex doesn't expose input/output split from SQL in some environments.
  return {
    name: "codex",
    available,
    models,
    currentModel,
    usage: {
      today: makePeriod(todayInputTokens, todayOutputTokens, todaySessions, todayStart.toISOString()),
      thisWeek: makePeriod(weekInputTokens, weekOutputTokens, weekSessions, weekStart.toISOString()),
      last5Hours: makePeriod(last5hInputTokens, last5hOutputTokens, last5hSessions, last5hStart.toISOString()),
      allTime: makePeriod(allTimeInputTokens, allTimeOutputTokens, allTimeSessions, ""),
    },
    resetInfo,
    nextResetAt,
    weeklyLimitEstimate: null,
    percentUsed: statusUsage?.weeklyPercentUsed ?? null,
    version: statusUsage?.version ?? null,
    plan: statusUsage?.plan ?? null,
    account: statusUsage?.account ?? null,
    effort: statusUsage?.effort ?? null,
    rateLimits: statusUsage?.rateLimits ?? [],
  };
}

// ── Gemini usage (from local session files) ──────────────────────────────────

function aggregateGeminiSessionUsageFromJson(content: string): SessionUsage {
  let sessionInput = 0;
  let sessionOutput = 0;
  let sessionTotal = 0;
  let sessionTs = 0;

  let session: {
    startTime?: string;
    lastUpdated?: string;
    messages?: Array<{
      type?: string;
      timestamp?: string;
      tokens?: {
        input?: number;
        output?: number;
        total?: number;
      };
    }>;
  };

  try {
    session = JSON.parse(content);
  } catch {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0, timestampMs: 0 };
  }

  const fallbackTs = parseTimestamp(session.startTime) || parseTimestamp(session.lastUpdated);
  if (fallbackTs > sessionTs) sessionTs = fallbackTs;

  const messages = Array.isArray(session.messages) ? session.messages : [];
  for (const message of messages) {
    if (!message || message.type !== "gemini" || !message.tokens) continue;

    const tokens = message.tokens;
    const input = toNumber(tokens.input);
    const output = toNumber(tokens.output);
    const total = toNumber(tokens.total);
    if (input === 0 && output === 0 && total === 0) continue;

    sessionInput += input;
    sessionOutput += output;
    sessionTotal += total > 0 ? total : input + output;

    const messageTs = parseTimestamp(message.timestamp);
    if (messageTs > sessionTs) sessionTs = messageTs;
  }

  if (sessionTotal <= 0) return { inputTokens: 0, outputTokens: 0, totalTokens: 0, timestampMs: sessionTs };

  return {
    inputTokens: sessionInput,
    outputTokens: sessionOutput,
    totalTokens: sessionTotal,
    timestampMs: sessionTs,
  };
}

function collectGeminiSessionUsages(): SessionUsage[] {
  const geminiTmp = join(homedir(), ".gemini", "tmp");
  if (!existsSync(geminiTmp)) return [];

  const usages: SessionUsage[] = [];
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(geminiTmp, { withFileTypes: true });
  } catch {
    return usages;
  }

  for (const profile of entries) {
    if (!profile.isDirectory()) continue;

    const chatsDir = join(geminiTmp, profile.name, "chats");
    if (!existsSync(chatsDir)) continue;

    let sessions: string[] = [];
    try {
      sessions = readdirSync(chatsDir)
        .filter((name) => name.startsWith("session-") && (name.endsWith(".json") || name.endsWith(".jsonl")));
    } catch {
      continue;
    }

    for (const sessionFile of sessions) {
      const sessionPath = join(chatsDir, sessionFile);
      try {
        const usage = aggregateGeminiSessionUsageFromJson(readFileSync(sessionPath, "utf8"));
        if (usage.totalTokens > 0) usages.push(usage);
      } catch {}
    }
  }

  return usages;
}

async function collectGeminiUsage(): Promise<ProviderUsage | null> {
  const available = await whichExists("gemini");
  if (!available) return null;

  // Version: `gemini --version` (non-interactive, no PTY needed)
  let version: string | null = null;
  try {
    const { stdout } = await execFileAsync("gemini", ["--version"], { encoding: "utf8", timeout: 5000 });
    const trimmed = stdout.trim();
    if (/^\d+\.\d+/.test(trimmed)) version = trimmed;
  } catch {}

  // Account: from local google_accounts.json
  let account: string | null = null;
  const accountsPath = join(homedir(), ".gemini", "google_accounts.json");
  if (existsSync(accountsPath)) {
    try {
      const data = JSON.parse(readFileSync(accountsPath, "utf8"));
      if (typeof data.active === "string" && data.active.includes("@")) {
        account = data.active;
      }
    } catch {}
  }

  const todayStart = computeTodayStart();
  const weekStart = computeWeekStart();
  let nextResetAt = computeNextMonday().toISOString();
  const last5hStart = computeLastHoursStart(5);

  // Read models from the installed CLI package (same source as discoverModels)
  const models: ModelInfo[] = [];
  try {
    const { stdout: binPath } = await execFileAsync("which", ["gemini"], { encoding: "utf8", timeout: 3000 });
    const realBin = realpathSync(binPath.trim());
    const modelsPath = join(dirname(dirname(realBin)), "node_modules", "@google", "gemini-cli-core", "dist", "src", "config", "models.js");
    if (existsSync(modelsPath)) {
      const content = readFileSync(modelsPath, "utf8");
      const regex = /export const ([A-Z0-9_]+)\s*=\s*'(gemini-[^']+)';/g;
      const seen = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = regex.exec(content)) !== null) {
        const [, constName, slug] = m;
        if (seen.has(slug) || slug.includes("embedding")) continue;
        seen.add(slug);
        models.push({
          slug,
          displayName: slug,
          description: constName.startsWith("PREVIEW_") ? "Preview" : "Stable",
        });
      }
    }
  } catch { /* fall through — models stays empty */ }

  let currentModel = "";
  const settingsPath = join(homedir(), ".gemini", "settings.json");
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      if (typeof settings.model === "string" && settings.model.trim()) {
        currentModel = settings.model.trim();
      }
    } catch {}
  }

  const todayMs = todayStart.getTime();
  const weekMs = weekStart.getTime();
  const last5hMs = last5hStart.getTime();

  let resetInfo = "Usage from local Gemini session logs";

  let todayInputTokens = 0;
  let todayOutputTokens = 0;
  let todaySessions = 0;
  let weekInputTokens = 0;
  let weekOutputTokens = 0;
  let weekSessions = 0;
  let last5hInputTokens = 0;
  let last5hOutputTokens = 0;
  let last5hSessions = 0;
  let allTimeInputTokens = 0;
  let allTimeOutputTokens = 0;
  let allTimeSessions = 0;

  const sessionUsages = collectGeminiSessionUsages();
  for (const usage of sessionUsages) {
    allTimeInputTokens += usage.inputTokens;
    allTimeOutputTokens += usage.outputTokens;
    allTimeSessions++;

    if (usage.timestampMs >= todayMs) {
      todayInputTokens += usage.inputTokens;
      todayOutputTokens += usage.outputTokens;
      todaySessions++;
    }
    if (usage.timestampMs >= weekMs) {
      weekInputTokens += usage.inputTokens;
      weekOutputTokens += usage.outputTokens;
      weekSessions++;
    }
    if (usage.timestampMs >= last5hMs) {
      last5hInputTokens += usage.inputTokens;
      last5hOutputTokens += usage.outputTokens;
      last5hSessions++;
    }
  }

  const statusUsage = await collectGeminiUsageFromCli();
  if (statusUsage) {
    if (statusUsage.currentModel) {
      currentModel = statusUsage.currentModel;
    }
    if (statusUsage.allTimeInputTokens !== null || statusUsage.allTimeOutputTokens !== null) {
      allTimeInputTokens = statusUsage.allTimeInputTokens ?? allTimeInputTokens;
      allTimeOutputTokens = statusUsage.allTimeOutputTokens ?? allTimeOutputTokens;
      if (statusUsage.allTimeSessions !== null) allTimeSessions = statusUsage.allTimeSessions;
    }
    if (statusUsage.todayInputTokens !== null || statusUsage.todayOutputTokens !== null) {
      todayInputTokens = statusUsage.todayInputTokens ?? todayInputTokens;
      todayOutputTokens = statusUsage.todayOutputTokens ?? todayOutputTokens;
      if (statusUsage.todaySessions !== null) todaySessions = statusUsage.todaySessions;
    }
    if (statusUsage.thisWeekInputTokens !== null || statusUsage.thisWeekOutputTokens !== null) {
      weekInputTokens = statusUsage.thisWeekInputTokens ?? weekInputTokens;
      weekOutputTokens = statusUsage.thisWeekOutputTokens ?? weekOutputTokens;
      if (statusUsage.thisWeekSessions !== null) weekSessions = statusUsage.thisWeekSessions;
    }
    if (statusUsage.last5HoursInputTokens !== null || statusUsage.last5HoursOutputTokens !== null) {
      last5hInputTokens = statusUsage.last5HoursInputTokens ?? last5hInputTokens;
      last5hOutputTokens = statusUsage.last5HoursOutputTokens ?? last5hOutputTokens;
      if (statusUsage.last5HoursSessions !== null) last5hSessions = statusUsage.last5HoursSessions;
    }
    if (statusUsage.resetInfo) {
      resetInfo = statusUsage.resetInfo;
    }
    if (statusUsage.nextResetAt) {
      nextResetAt = statusUsage.nextResetAt;
    }
    if (statusUsage.weeklyLimitEstimate !== null && statusUsage.weeklyPercentUsed !== null) {
      resetInfo = `Estimated weekly used: ${statusUsage.weeklyPercentUsed}%`;
    }
  }

  return {
    name: "gemini",
    available,
    models,
    currentModel,
    usage: {
      today: makePeriod(todayInputTokens, todayOutputTokens, todaySessions, todayStart.toISOString()),
      thisWeek: makePeriod(weekInputTokens, weekOutputTokens, weekSessions, weekStart.toISOString()),
      last5Hours: makePeriod(last5hInputTokens, last5hOutputTokens, last5hSessions, last5hStart.toISOString()),
      allTime: makePeriod(allTimeInputTokens, allTimeOutputTokens, allTimeSessions, ""),
    },
    resetInfo,
    nextResetAt,
    weeklyLimitEstimate: null,
    percentUsed: statusUsage?.weeklyPercentUsed ?? null,
    version: statusUsage?.version ?? version,
    plan: statusUsage?.plan ?? null,
    account: statusUsage?.account ?? account,
    effort: null, // Gemini has no effort/reasoning concept
    rateLimits: statusUsage?.rateLimits ?? [],
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

let usageCache: ProvidersUsageResult | null = null;
let usageCacheAt = 0;
const USAGE_CACHE_TTL = 60_000; // 1 minute

export async function collectProvidersUsage(): Promise<ProvidersUsageResult> {
  if (usageCache && Date.now() - usageCacheAt < USAGE_CACHE_TTL) {
    return usageCache;
  }

  const results = await Promise.all([
    collectClaudeUsage(),
    collectCodexUsage(),
    collectGeminiUsage(),
  ]);

  usageCache = {
    providers: results.filter((p): p is ProviderUsage => p !== null),
    collectedAt: new Date().toISOString(),
  };
  usageCacheAt = Date.now();
  return usageCache;
}

export async function collectProviderUsage(providerName: string): Promise<ProviderUsage | null> {
  const normalized = normalizeProviderName(providerName);
  if (!normalized) return null;

  if (normalized === "claude") return collectClaudeUsage();
  if (normalized === "codex") return collectCodexUsage();
  return collectGeminiUsage();
}
