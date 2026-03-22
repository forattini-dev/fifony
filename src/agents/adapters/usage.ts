import { homedir } from "node:os";
import { cwd, env } from "node:process";
import { logger } from "../../concerns/logger.ts";

export interface RateLimitEntry {
  scope: string;        // "global", "session", or model slug
  period: string;       // "5h" | "weekly" | "daily" | "session"
  percentUsed: number;
  resetInfo: string | null;
  nextResetAt: string | null;
}

export interface ProviderUsageSnapshot {
  currentModel: string | null;
  allTimeInputTokens: number | null;
  allTimeOutputTokens: number | null;
  todayInputTokens: number | null;
  todayOutputTokens: number | null;
  thisWeekInputTokens: number | null;
  thisWeekOutputTokens: number | null;
  last5HoursInputTokens: number | null;
  last5HoursOutputTokens: number | null;
  allTimeSessions: number | null;
  todaySessions: number | null;
  thisWeekSessions: number | null;
  last5HoursSessions: number | null;
  weeklyLimitEstimate: number | null;
  weeklyPercentUsed: number | null;
  resetInfo: string | null;
  nextResetAt: string | null;
  version: string | null;
  plan: string | null;
  account: string | null;
  effort: string | null;
  sessionPercentUsed: number | null;
  sessionResetInfo: string | null;
  rateLimits: RateLimitEntry[];
  raw: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createPtyProcess(command: string, args: string[]) {
  try {
    const nodePty = await import("node-pty");
    if (typeof nodePty.spawn !== "function") {
      return null;
    }

    return nodePty.spawn(command, args, {
      name: "xterm-color",
      cols: 160,
      rows: 48,
      cwd: cwd(),
      env,
    });
  } catch (error) {
    logger.debug(`Failed to initialize node-pty for ${command}: ${String(error)}`);
    return null;
  }
}

function stripTerminalEscapes(input: string): string {
  return input
    // CSI cursor-movement & erase sequences → replace with space (preserves word spacing)
    // A-H=cursor move, J=erase display, K=erase line, S/T=scroll, d=vert abs, f=cursor pos alt, G=horiz abs
    .replace(/\x1B\[[?>=!]?[0-9;]*[A-HJKSTdfG]/g, " ")
    // CSI formatting sequences (colors, modes, etc.) → remove entirely
    .replace(/\x1B\[[?>=!]?[0-9;]*[a-zI-Ri-z~]/g, "")
    // Catch any remaining CSI
    .replace(/\x1B\[[?>=!]?[0-9;]*[A-Za-z~]/g, "")
    // OSC sequences: \x1B]...ST (string terminator is \x1B\\ or \x07)
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, "")
    // Other escape sequences
    .replace(/\x1B[()#][A-Za-z0-9]/g, "")
    .replace(/\x1B[A-Za-z]/g, "")
    // Strip remaining non-printable ASCII and non-ASCII (box-drawing, progress bars, etc.)
    .replace(/[^\x20-\x7E\r\n\t]/g, "")
    // Collapse runs of whitespace on the same line
    .replace(/[ \t]{2,}/g, " ");
}

function parseNumber(value: string | undefined | null): number {
  if (!value) return 0;
  const clean = value.replace(/[^\d]/g, "");
  if (!clean) return 0;
  const parsed = Number.parseInt(clean, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseTokenQuantity(value: string | undefined | null): number {
  if (!value) return 0;
  const match = value.replace(/,/g, "").trim().match(/^([0-9]+(?:\.[0-9]+)?)([kKmMbBtT]?)$/);
  if (!match) {
    const fallback = parseNumber(value);
    return fallback;
  }

  const number = Number.parseFloat(match[1]);
  if (!Number.isFinite(number)) return 0;

  const suffix = match[2].toLowerCase();
  if (suffix === "t") return number * 1_000_000_000_000;
  if (suffix === "b") return number * 1_000_000_000;
  if (suffix === "m") return number * 1_000_000;
  if (suffix === "k") return number * 1_000;
  return number;
}

function parsePercent(value: string | undefined | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function keepLargest(current: number | null, incoming: number): number {
  if (!Number.isFinite(incoming)) return current ?? 0;
  if (incoming <= 0) return current ?? 0;
  return current === null ? incoming : Math.max(current, incoming);
}

const MONTH_MAP: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function toMonthIndex(value: string): number | null {
  const index = MONTH_MAP[value.toLowerCase().slice(0, 3)];
  return typeof index === "number" ? index : null;
}

function normalizeResetText(value: string): string {
  return value
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseResetTime(value: string): { hour: number; minute: number } | null {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
  if (!match) return null;

  let hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2] || "0", 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  const suffix = match[3]?.toLowerCase();
  if (suffix === "pm" && hour !== 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;

  return { hour, minute };
}

function parseResetDateFromText(raw: string): string | null {
  const text = normalizeResetText(raw);
  if (!text) return null;
  const now = new Date();

  const explicitDateMatch = text.match(/([A-Za-z]{3,9})\s*(\d{1,2})(?:,?|\s+)(\d{1,2}:\d{2}(?:\s*[AaPp][Mm])?)/i)
    || text.match(/(\d{1,2})\s+([A-Za-z]{3,9})(?:,\s*)?(\d{1,2}:\d{2}(?:\s*[AaPp][Mm])?)/i);

  if (explicitDateMatch) {
    const [, monthRaw, dayRaw, timeRaw] = explicitDateMatch;
    const day = Number.parseInt(dayRaw, 10);
    const monthIndex = toMonthIndex(monthRaw);
    const time = parseResetTime(timeRaw);
    if (!Number.isNaN(day) && monthIndex !== null && time) {
      const candidate = new Date(now);
      candidate.setMonth(monthIndex);
      candidate.setDate(day);
      candidate.setHours(time.hour, time.minute, 0, 0);
      if (candidate.getTime() <= now.getTime()) {
        candidate.setFullYear(now.getFullYear() + 1);
      }
      return candidate.toISOString();
    }
  }

  const timeMatch = text.match(/(\d{1,2}:\d{2}(?:\s*[AaPp][Mm])?)/i)
    || text.match(/(\d{1,2})(?:\s*([AaPp][Mm]))/i);
  const time = timeMatch?.[1] ? parseResetTime(timeMatch[1]) : null;
  if (time) {
    const candidate = new Date(now);
    candidate.setHours(time.hour, time.minute, 0, 0);
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.toISOString();
  }

  return null;
}

function initSnapshot(raw: string): ProviderUsageSnapshot {
  return {
    currentModel: null,
    allTimeInputTokens: null,
    allTimeOutputTokens: null,
    todayInputTokens: null,
    todayOutputTokens: null,
    thisWeekInputTokens: null,
    thisWeekOutputTokens: null,
    last5HoursInputTokens: null,
    last5HoursOutputTokens: null,
    allTimeSessions: null,
    todaySessions: null,
    thisWeekSessions: null,
    last5HoursSessions: null,
    weeklyLimitEstimate: null,
    weeklyPercentUsed: null,
    resetInfo: null,
    nextResetAt: null,
    version: null,
    plan: null,
    account: null,
    effort: null,
    sessionPercentUsed: null,
    sessionResetInfo: null,
    rateLimits: [],
    raw,
  };
}

/** Wait until the accumulated output matches a pattern, or timeout. */
function waitForOutput(
  getOutput: () => string,
  pattern: RegExp,
  timeoutMs: number,
  pollMs = 100,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const check = () => {
      if (pattern.test(getOutput())) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(check, pollMs);
    };
    check();
  });
}

// Patterns that indicate a trust/confirmation prompt we should auto-accept
const TRUST_PROMPT_RE = /trust this folder|trust this project|safety check|Do you trust/i;
// Patterns that indicate the interactive CLI is ready for slash commands.
// We check against raw (unstripped) output, so non-ASCII prompt chars (❯ › ▶) are preserved.
const CLI_READY_RE = /[❯›▶>]\s|Type your message|for shortcuts|\/model to change/;

export async function collectProviderStatusText(
  command: string,
  args: string[],
  statusCommand: string,
): Promise<string | null> {
  try {
    const ptyProcess = await createPtyProcess(command, args);
    if (!ptyProcess) return null;

    let output = "";
    ptyProcess.onData((data) => {
      output += data;
    });

    // Phase 1: wait up to 5s for either the CLI prompt or a trust prompt
    const gotPrompt = await waitForOutput(
      () => output,
      new RegExp(`${TRUST_PROMPT_RE.source}|${CLI_READY_RE.source}`, "i"),
      5000,
      100,
    );

    // If a trust prompt appeared, accept it and wait for the actual CLI prompt
    if (gotPrompt && TRUST_PROMPT_RE.test(output)) {
      logger.debug(`Trust prompt detected for ${command}, auto-accepting`);
      ptyProcess.write("\r"); // press Enter → selects default "Yes, I trust"
      await waitForOutput(() => output, CLI_READY_RE, 5000, 100);
    } else if (!gotPrompt) {
      logger.debug(`PTY prompt not detected for ${command}, sending command after fallback wait`);
      await sleep(3000);
    }

    // Wait for output to stabilize (some CLIs show prompt while still loading)
    let prevLen = output.length;
    await sleep(800);
    if (output.length !== prevLen) {
      // Still receiving data — wait a bit more
      await sleep(1200);
    }

    // Phase 2: send the slash command
    ptyProcess.write(`${statusCommand}\r`);
    await sleep(3000);

    // Phase 3: clean exit
    ptyProcess.write("\x1b");  // Esc (dismiss any menu)
    await sleep(200);
    ptyProcess.write("\u0003"); // Ctrl-C
    await sleep(200);

    try {
      ptyProcess.kill();
    } catch {}

    return stripTerminalEscapes(output).trim();
  } catch (error) {
    logger.debug(`Failed collecting status via pty for ${command}: ${String(error)}`);
    return null;
  }
}

type ClaudeUsageSection = "current-week-all" | "current-week-model" | "current-session";

function parseClaudeUsageHeading(line: string): { section: ClaudeUsageSection; modelScope?: string } | null {
  if (/current week.*all models/i.test(line)) return { section: "current-week-all" };
  // "Current week (Sonnet only)", "Current week (Opus only)", etc.
  const modelWeekMatch = line.match(/current week\s*\((\w+)\s+only\)/i);
  if (modelWeekMatch) return { section: "current-week-model", modelScope: modelWeekMatch[1].toLowerCase() };
  if (/current session/i.test(line)) return { section: "current-session" };
  return null;
}

/** Convert banner label like "Opus 4.6" → CLI model id "claude-opus-4-6" */
function formatClaudeModelFromLabel(label: string): string {
  const normalized = label.trim().toLowerCase();
  // Replace spaces and dots with dashes to match CLI --model format: claude-opus-4-6
  const compact = normalized.replace(/[\s.]+/g, "-");
  if (compact.includes("opus")) return `claude-${compact}`;
  if (compact.includes("sonnet")) return `claude-${compact}`;
  if (compact.includes("haiku")) return `claude-${compact}`;
  if (compact.startsWith("claude-")) return compact;
  return label.trim().toLowerCase();
}

export function parseClaudeUsageFromStatus(raw: string): ProviderUsageSnapshot {
  const base = initSnapshot(raw);
  base.weeklyPercentUsed = null;

  const lines = raw
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter(Boolean);

  let currentHeading: { section: ClaudeUsageSection; modelScope?: string } | null = null;
  let lastPercentSection: typeof currentHeading = null;
  let lastPercentUsed: number | null = null;

  for (const line of lines) {
    const normalized = line.toLowerCase();
    // Skip noise lines (but don't break — "Esc to cancel" appears in loading AND final state)
    if (/^esc to cancel/i.test(normalized)) continue;
    if (/^loading/i.test(normalized)) continue;
    if (/^status dialog/i.test(normalized)) continue;

    // ── Startup banner parsing ──────────────────────────────────────────
    // "Claude Code v2.1.81" (after stripping non-ASCII art chars)
    const versionMatch = line.match(/Claude Code v(\d+\.\d+\.\d+)/i);
    if (versionMatch?.[1]) {
      base.version = versionMatch[1];
      continue;
    }

    // "Opus 4.6 (1M context) with high effort  Claude Max"
    // After strip: non-ASCII glyphs removed, · removed → "Opus 4.6 (1M context) with high effort  Claude Max"
    const effortMatch = line.match(/with\s+(high|medium|low|extra\s*high)\s+effort/i);
    if (effortMatch?.[1]) {
      base.effort = effortMatch[1].toLowerCase();
      // Plan comes after the effort text (was separated by · which got stripped)
      const afterEffort = line.slice(line.indexOf(effortMatch[0]) + effortMatch[0].length).trim();
      if (afterEffort && /^[A-Z]/.test(afterEffort)) {
        base.plan = afterEffort;
      }
    }

    // ── /usage sections ─────────────────────────────────────────────────
    const heading = parseClaudeUsageHeading(line);
    if (heading) {
      currentHeading = heading;
      continue;
    }

    const modelMatch = line.match(/\b(opus|sonnet|haiku)\s*\d+(?:\.\d+)?(?:\s*-\d+)?/i);
    if (modelMatch?.[0]) {
      base.currentModel = formatClaudeModelFromLabel(modelMatch[0]);
    }

    // "X% used" — may be on same line as heading or separate line
    const percentMatch = normalized.match(/(\d+)%\s*used/i);
    if (percentMatch?.[1] && currentHeading) {
      const used = parseInt(percentMatch[1], 10);
      lastPercentSection = currentHeading;
      lastPercentUsed = used;

      if (currentHeading.section === "current-week-all") {
        base.weeklyPercentUsed = keepLargest(base.weeklyPercentUsed, used);
      }
      if (currentHeading.section === "current-session") {
        base.sessionPercentUsed = used;
        base.currentModel = base.currentModel || "claude";
      }

      // Push rate limit entry immediately (resetInfo will be patched if a Resets line follows)
      const scope = currentHeading.section === "current-session"
        ? "session"
        : currentHeading.section === "current-week-model"
          ? (currentHeading.modelScope || "unknown")
          : "global";
      const period = currentHeading.section === "current-session" ? "session" : "weekly";
      base.rateLimits.push({ scope, period, percentUsed: used, resetInfo: null, nextResetAt: null });
    }

    // "Resets Mar 27, 3am (...)" — may be on same line as "% used" or separate
    // Tolerate slight strip corruption: "Rese s" → Rese\w*
    const resetMatch = line.match(/Rese\w*\s+(.+?)$/i);
    if (resetMatch?.[1] && lastPercentSection) {
      const resetText = resetMatch[1].trim();
      const nextResetAt = parseResetDateFromText(resetText);

      if (lastPercentSection.section === "current-week-all") {
        base.resetInfo = `Current week resets ${resetText}`;
        base.nextResetAt = nextResetAt || base.nextResetAt;
      }
      if (lastPercentSection.section === "current-session") {
        base.sessionResetInfo = `Resets ${resetText}`;
      }

      // Patch the last-pushed rate limit entry with reset info
      const last = base.rateLimits[base.rateLimits.length - 1];
      if (last) {
        last.resetInfo = `Resets ${resetText}`;
        last.nextResetAt = nextResetAt;
      }

      lastPercentSection = null;
      lastPercentUsed = null;
    }
  }

  const allModelsLine = lines.find((line) => parseClaudeUsageHeading(line)?.section === "current-week-all");
  if (!base.currentModel && allModelsLine) {
    const modelName = allModelsLine.match(/\b(opus|sonnet|haiku)\s*\d+(?:\.\d+)?(?:\s*-\d+)?/i)?.[0];
    if (modelName) base.currentModel = formatClaudeModelFromLabel(modelName);
  }

  return base;
}

export function parseCodexUsageFromStatus(raw: string): ProviderUsageSnapshot {
  const base = initSnapshot(raw);
  base.weeklyPercentUsed = null;
  base.weeklyLimitEstimate = null;

  const lines = raw
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter(Boolean);

  // Current scope for limit lines — "global" until a "MODEL limit:" header appears
  let limitScope = "global";

  for (const line of lines) {
    const normalizedLine = line.replace(/[│]/g, " ").trim();
    if (!normalizedLine) continue;
    if (/^[─╭╰]+$/.test(normalizedLine) || /^╮|^╯/.test(normalizedLine)) continue;

    // ── Startup banner ──────────────────────────────────────────────────
    // "OpenAI Codex (v0.116.0)" or ">_ OpenAI Codex (v0.116.0)"
    const versionMatch = normalizedLine.match(/(?:OpenAI\s+)?Codex\s+\(v([^)]+)\)/i);
    if (versionMatch?.[1] && !base.version) {
      base.version = versionMatch[1];
      continue;
    }

    // ── /status fields ──────────────────────────────────────────────────
    // "Model: gpt-5.3-codex-spark (reasoning high, summaries auto)" — REQUIRES parens
    const modelDetailMatch = normalizedLine.match(
      /^Model:\s+([a-z0-9][a-z0-9._\-\/]+)\s+\(([^)]+)\)/i,
    );
    if (modelDetailMatch?.[1]) {
      base.currentModel = modelDetailMatch[1];
      const reasoningMatch = modelDetailMatch[2].match(/reasoning\s+(\w+)/i);
      if (reasoningMatch?.[1]) {
        base.effort = reasoningMatch[1].toLowerCase();
      }
      continue;
    }

    // "model: gpt-5.3-codex-spark high /model to change" (banner or status)
    const modelLineMatch = normalizedLine.match(/^model:\s+([a-z0-9][a-z0-9._\-\/]+)(?:\s+(high|medium|low|extra\s*high))?/i);
    if (modelLineMatch?.[1]) {
      base.currentModel = modelLineMatch[1];
      if (modelLineMatch[2]) {
        base.effort = modelLineMatch[2].toLowerCase();
      }
      continue;
    }

    // "Account: filipeforattini1@gmail.com (Pro)"
    const accountMatch = normalizedLine.match(/^Account:\s+(\S+@\S+)\s+\((\w+)\)/i);
    if (accountMatch) {
      base.account = accountMatch[1];
      base.plan = accountMatch[2];
      continue;
    }

    if (/context window:/i.test(normalizedLine)) continue;

    // "Weekly limit: [...] 84% left (resets 15:50 on 25 Mar)"
    // Check BEFORE modelLimitHeader — otherwise "5h" matches as a model name.
    if (/weekly limit:/i.test(normalizedLine)) {
      const leftMatch = normalizedLine.match(/(\d+(?:\.\d+)?)\s*%\s*left/i);
      const leftPct = leftMatch?.[1] ? parsePercent(leftMatch[1]) : null;
      const used = leftPct !== null ? Math.floor(100 - leftPct) : null;

      const resetMatch = normalizedLine.match(/resets\s+([0-9]{1,2}:\d{2})(?:\s+on\s+(.+))?/i);
      const resetTime = resetMatch?.[1] || "";
      const resetDate = resetMatch?.[2]?.trim() || "";
      const resetText = resetTime ? `${resetTime}${resetDate ? ` on ${resetDate}` : ""}` : null;
      const nextResetAt = resetText ? parseResetDateFromText(resetText) : null;

      if (used !== null) {
        // Only set the global weekly percent from the "global" scope (first one encountered)
        if (limitScope === "global") {
          base.weeklyPercentUsed = keepLargest(base.weeklyPercentUsed, used);
          if (resetText) {
            base.resetInfo = `Weekly reset: ${resetText}`;
            base.nextResetAt = nextResetAt || base.nextResetAt;
          }
        }

        base.rateLimits.push({
          scope: limitScope,
          period: "weekly",
          percentUsed: used,
          resetInfo: resetText ? `Resets ${resetText}` : null,
          nextResetAt,
        });
      }
      continue;
    }

    // "5h limit: [...] 100% left (resets 18:41)" or "5h limit: [...] 46% left (resets 14:17)"
    if (/5h limit:/i.test(normalizedLine)) {
      const leftMatch = normalizedLine.match(/(\d+(?:\.\d+)?)\s*%\s*left/i);
      const leftPct = leftMatch?.[1] ? parsePercent(leftMatch[1]) : null;
      const used = leftPct !== null ? Math.floor(100 - leftPct) : null;

      const resetMatch = normalizedLine.match(/resets\s+([0-9]{1,2}:\d{2})/i);
      const resetText = resetMatch?.[1] || null;
      const nextResetAt = resetText ? parseResetDateFromText(resetText) : null;

      // Legacy: old parser extracted token count from "X used", keep that path
      const usedTokenMatch = normalizedLine.match(/([0-9]+(?:\.[0-9]+)?[kKmMbBtT]?)\s+used/i);
      if (usedTokenMatch?.[1]) {
        const tokens = parseTokenQuantity(usedTokenMatch[1]);
        base.last5HoursInputTokens = keepLargest(base.last5HoursInputTokens, tokens);
      }

      if (used !== null) {
        base.rateLimits.push({
          scope: limitScope,
          period: "5h",
          percentUsed: used,
          resetInfo: resetText ? `Resets ${resetText}` : null,
          nextResetAt,
        });
      }
      continue;
    }

    // "GPT-5.3-Codex-Spark limit:" — switches scope for subsequent limit lines
    // Must come AFTER "Weekly limit:" and "5h limit:" checks to avoid false matches.
    const modelLimitHeader = normalizedLine.match(/^([a-z0-9][a-z0-9._\-\/]+)\s+limit:/i);
    if (modelLimitHeader?.[1] && !/^(5h|weekly)\b/i.test(normalizedLine)) {
      limitScope = modelLimitHeader[1].toLowerCase();
      if (!base.currentModel) base.currentModel = limitScope;
      continue;
    }

    // Fallback: "X used" with "5h" context (status bar at bottom)
    const usedMatch = normalizedLine.match(/([0-9]+(?:\.[0-9]+)?[kKmMbBtT]?)\s+used/i);
    if (usedMatch?.[1] && /\b5h\b/i.test(normalizedLine)) {
      const tokens = parseTokenQuantity(usedMatch[1]);
      if (tokens > 0) {
        base.last5HoursInputTokens = keepLargest(base.last5HoursInputTokens, tokens);
        if (!base.currentModel && limitScope !== "global") {
          base.currentModel = limitScope;
        }
      }
    }

    // Status bar fallback: "100% left" / "0% used" / "5h 100%" anywhere in a long line
    // The Codex status bar may appear as a single concatenated line after strip.
    if (normalizedLine.length > 80) {
      if (base.weeklyPercentUsed === null) {
        const statusLeftMatch = normalizedLine.match(/(\d+)%\s*left/i);
        if (statusLeftMatch?.[1]) {
          const leftPct = parsePercent(statusLeftMatch[1]);
          if (leftPct !== null) {
            base.weeklyPercentUsed = Math.floor(100 - leftPct);
          }
        }
      }
      const fiveHMatch = normalizedLine.match(/5h\s+(\d+)%/i);
      if (fiveHMatch?.[1] && base.rateLimits.length === 0) {
        const leftPct = parsePercent(fiveHMatch[1]);
        if (leftPct !== null) {
          base.rateLimits.push({
            scope: "global",
            period: "5h",
            percentUsed: Math.floor(100 - leftPct),
            resetInfo: null,
            nextResetAt: null,
          });
        }
      }
    }
  }

  return base;
}

function parseGeminiModelUsageLine(
  line: string,
): {
  model: string | null;
  percentUsed: number | null;
  resetAt: string | null;
} {
  const match = line.match(
    /\b(gemini-[a-z0-9][a-z0-9._-]*)\b.*?(\d{1,3})\s*%\s+([0-9]{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?)\s*(?:\(([^)]+)\))?/,
  );
  if (!match) {
    return { model: null, percentUsed: null, resetAt: null };
  }

  const model = match[1];
  const percentUsed = parsePercent(match[2]);
  if (percentUsed === null) return { model: null, percentUsed: null, resetAt: null };

  const resetTime = match[3]?.trim() ?? "";
  const resetIn = match[4]?.trim() ?? "";
  const resetAt = resetIn ? `${resetTime} (${resetIn})` : resetTime;

  return { model, percentUsed, resetAt: resetAt || null };
}

export function parseGeminiUsageFromStatus(raw: string): ProviderUsageSnapshot {
  const base = initSnapshot(raw);
  base.weeklyPercentUsed = null;
  base.weeklyLimitEstimate = null;
  if (!raw) return base;

  const lines = raw
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const normalizedLine = line.replace(/[│]/g, " ").trim();
    if (!normalizedLine) continue;
    if (/^[─╭╰]+$/.test(normalizedLine) || /^╮|^╯/.test(normalizedLine)) {
      continue;
    }

    // ── Startup banner ──────────────────────────────────────────────────
    // "Gemini CLI v0.34.0"
    const versionMatch = normalizedLine.match(/Gemini CLI v(\d+\.\d+\.\d+)/i);
    if (versionMatch?.[1] && !base.version) {
      base.version = versionMatch[1];
      continue;
    }

    // "Signed in with Google: filipeforattini1@gmail.com /auth"
    const accountMatch = normalizedLine.match(/Signed in with Google:\s+(\S+@\S+)/i);
    if (accountMatch?.[1]) {
      base.account = accountMatch[1].replace(/\s*\/auth$/, "");
      continue;
    }

    // "Plan: Gemini Code Assist in Google One AI Pro /upgrade"
    const planMatch = normalizedLine.match(/^Plan:\s+(.+?)(?:\s+\/\w+)?$/i);
    if (planMatch?.[1]) {
      base.plan = planMatch[1].trim();
      continue;
    }

    // ── /stats session fields ───────────────────────────────────────────
    // "Tier: Gemini Code Assist in Google One AI Pro"
    const tierMatch = normalizedLine.match(/^Tier:\s+(.+)/i);
    if (tierMatch?.[1] && !base.plan) {
      base.plan = tierMatch[1].trim();
      continue;
    }

    if (normalizedLine.startsWith("Model")) continue;

    // Per-model usage lines:
    // "gemini-2.5-flash  -  13%  11:51 AM (22h 8m)"
    const modelUsage = parseGeminiModelUsageLine(normalizedLine);
    if (modelUsage.model && modelUsage.percentUsed !== null) {
      if (!base.currentModel) {
        base.currentModel = modelUsage.model;
      }
      base.weeklyPercentUsed = keepLargest(base.weeklyPercentUsed, modelUsage.percentUsed);

      const nextResetAt = modelUsage.resetAt ? parseResetDateFromText(modelUsage.resetAt) : null;
      if (modelUsage.resetAt) {
        base.resetInfo = `Usage reset: ${modelUsage.resetAt}`;
        base.nextResetAt = nextResetAt || base.nextResetAt;
      }

      base.rateLimits.push({
        scope: modelUsage.model,
        period: "daily",
        percentUsed: modelUsage.percentUsed,
        resetInfo: modelUsage.resetAt ? `Resets ${modelUsage.resetAt}` : null,
        nextResetAt,
      });
      continue;
    }

    if (/Session Stats/i.test(normalizedLine)) {
      base.resetInfo = base.resetInfo || "Gemini session stats unavailable";
    }
  }

  return base;
}

export function collectProviderUsageSnapshotFromCli(
  command: string,
  usageCommand: string,
  parseSnapshot: (raw: string) => ProviderUsageSnapshot,
  args: string[] = [],
): Promise<ProviderUsageSnapshot | null> {
  return collectProviderStatusText(command, args, usageCommand).then((raw) => {
    if (!raw) return null;
    return parseSnapshot(raw);
  });
}
