import {
  Lightbulb, Circle, ListOrdered, PlayCircle, Eye, CheckCircle2,
  AlertTriangle, XCircle, Info, Terminal, Code, Route, Activity, ClipboardCheck,
} from "lucide-react";

// ── State maps ───────────────────────────────────────────────────────────────

export const STATE_ICON = {
  Planning: Lightbulb, Planned: Circle, Queued: ListOrdered, Running: PlayCircle,
  Reviewing: Eye, Reviewed: CheckCircle2, Blocked: AlertTriangle, Done: CheckCircle2, Cancelled: XCircle,
};

export const STATE_COLOR = {
  Planning: "text-info", Planned: "text-warning", Queued: "text-info", Running: "text-primary",
  Reviewing: "text-secondary", Reviewed: "text-success", Blocked: "text-error", Done: "text-success", Cancelled: "text-neutral",
};

export const STATE_BTN = {
  Planning: "btn-info", Planned: "btn-warning", Queued: "btn-info", Running: "btn-primary",
  Reviewing: "btn-secondary", Reviewed: "btn-success", Blocked: "btn-error", Done: "btn-success", Cancelled: "btn-neutral",
};

export const STATE_BADGE = {
  Planning: "badge-info", Planned: "badge-warning", Queued: "badge-info", Running: "badge-primary",
  Reviewing: "badge-secondary", Reviewed: "badge-success", Blocked: "badge-error", Done: "badge-success", Cancelled: "badge-neutral",
};

export const STATE_BG = {
  Planning: "bg-info/10 border-info/30", Planned: "bg-warning/10 border-warning/30", Queued: "bg-info/10 border-info/30",
  Running: "bg-primary/10 border-primary/30",
  Reviewing: "bg-secondary/10 border-secondary/30", Reviewed: "bg-success/10 border-success/30",
  Blocked: "bg-error/10 border-error/30",
  Done: "bg-success/10 border-success/30", Cancelled: "bg-neutral/10 border-neutral/30",
};

// ── Issue type colors ────────────────────────────────────────────────────────

export const ISSUE_TYPE_COLORS = {
  bug:      "badge-error",
  feature:  "badge-primary",
  refactor: "badge-warning",
  docs:     "badge-info",
  chore:    "badge-secondary",
};

// ── Tabs ─────────────────────────────────────────────────────────────────────

export const BASE_TABS = [
  { id: "overview", label: "Overview", icon: Info },
  { id: "execution", label: "Execution", icon: Terminal },
  { id: "diff", label: "Diff", icon: Code },
  { id: "routing", label: "Routing", icon: Route },
  { id: "history", label: "Events", icon: Activity },
];

export const PLANNING_TAB = { id: "planning", label: "Plan", icon: Lightbulb };
export const REVIEW_TAB = { id: "review", label: "Review", icon: ClipboardCheck };

export function getTabs(issueState) {
  if (issueState === "Planning") {
    return [PLANNING_TAB, ...BASE_TABS];
  }
  if (issueState === "Reviewing" || issueState === "Reviewed" || issueState === "Done" || issueState === "Blocked") {
    return [BASE_TABS[0], REVIEW_TAB, ...BASE_TABS.slice(1)];
  }
  return [BASE_TABS[0], PLANNING_TAB, ...BASE_TABS.slice(1)];
}

// ── State machine helpers ────────────────────────────────────────────────────

export function getStateMachineOrder(state) {
  return { Planned: 0, Queued: 1, Running: 2, Reviewing: 2, Reviewed: 3, Blocked: 3, Done: 4, Cancelled: 4 }[state] ?? 0;
}
