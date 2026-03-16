/** Parse JSON safely, returning null on failure. */
export function safeJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/** Split a comma-separated string into trimmed, non-empty tokens. */
export function normalizeCsv(str) {
  return typeof str === "string"
    ? str.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
}

/** Format a date value as a locale string, or "-" if invalid. */
export function formatDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
}

/** Human-readable relative time ("2s ago", "3m ago", "1h ago", "2d ago") or "-". */
export function timeAgo(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export const STATES = ["Todo", "In Progress", "In Review", "Blocked", "Done", "Cancelled"];
export const ISSUE_STATE_MACHINE = {
  Todo: ["In Progress", "Cancelled"],
  "In Progress": ["In Review", "Blocked", "Cancelled"],
  "In Review": ["In Progress", "Done", "Blocked", "Cancelled"],
  Blocked: ["In Review", "In Progress", "Cancelled"],
  Done: ["Cancelled", "Todo"],
  Cancelled: ["Todo", "In Progress"],
};

export function getIssueTransitions(state) {
  if (!Array.isArray(ISSUE_STATE_MACHINE[state])) return STATES;
  const next = ISSUE_STATE_MACHINE[state];
  return [state, ...next.filter((s) => s !== state)];
}
