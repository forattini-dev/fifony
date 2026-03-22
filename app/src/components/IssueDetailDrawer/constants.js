import {
  Lightbulb, Circle, ListOrdered, PlayCircle, Eye, CheckCircle2,
  AlertTriangle, XCircle, Info, Terminal, Code, Route, Activity, ClipboardCheck,
  GitMerge, History,
} from "lucide-react";

// ── State maps ───────────────────────────────────────────────────────────────

export const STATE_ICON = {
  Planning: Lightbulb, PendingApproval: Circle, Queued: ListOrdered, Running: PlayCircle,
  Reviewing: Eye, PendingDecision: CheckCircle2, Blocked: AlertTriangle, Approved: CheckCircle2, Merged: GitMerge, Cancelled: XCircle, Archived: XCircle,
};

export const STATE_COLOR = {
  Planning: "text-info", PendingApproval: "text-warning", Queued: "text-info", Running: "text-primary",
  Reviewing: "text-secondary", PendingDecision: "text-success", Blocked: "text-error", Approved: "text-success", Merged: "text-success", Cancelled: "text-neutral", Archived: "text-neutral",
};

export const STATE_BTN = {
  Planning: "btn-info", PendingApproval: "btn-warning", Queued: "btn-info", Running: "btn-primary",
  Reviewing: "btn-secondary", PendingDecision: "btn-success", Blocked: "btn-error", Approved: "btn-success", Merged: "btn-success", Cancelled: "btn-neutral", Archived: "btn-neutral",
};

export const STATE_BADGE = {
  Planning: "badge-info", PendingApproval: "badge-warning", Queued: "badge-info", Running: "badge-primary",
  Reviewing: "badge-secondary", PendingDecision: "badge-success", Blocked: "badge-error", Approved: "badge-success", Merged: "badge-success", Cancelled: "badge-neutral", Archived: "badge-neutral",
};

export const STATE_BG = {
  Planning: "bg-info/10 border-info/30", PendingApproval: "bg-warning/10 border-warning/30", Queued: "bg-info/10 border-info/30",
  Running: "bg-primary/10 border-primary/30",
  Reviewing: "bg-secondary/10 border-secondary/30", PendingDecision: "bg-success/10 border-success/30",
  Blocked: "bg-error/10 border-error/30",
  Approved: "bg-success/10 border-success/30", Merged: "bg-success/10 border-success/30", Cancelled: "bg-neutral/10 border-neutral/30", Archived: "bg-neutral/10 border-neutral/30",
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

export const ISSUE_DRAWER_TABS = [
  { id: "overview", label: "Overview", icon: Info },
  { id: "planning", label: "Plan", icon: Lightbulb },
  { id: "review", label: "Review", icon: ClipboardCheck },
  { id: "execution", label: "Execution", icon: Terminal },
  { id: "diff", label: "Diff", icon: Code },
  { id: "routing", label: "Routing", icon: Route },
  { id: "history", label: "History", icon: History },
  { id: "events", label: "Events", icon: Activity },
];

export function getDefaultIssueDrawerTab(issueState) {
  if (issueState === "Planning" || issueState === "PendingApproval") return "planning";
  if (issueState === "Reviewing" || issueState === "PendingDecision") return "review";
  return "overview";
}

// ── State machine helpers ────────────────────────────────────────────────────

export function getStateMachineOrder(state) {
  return { PendingApproval: 0, Queued: 1, Running: 2, Reviewing: 2, PendingDecision: 3, Blocked: 3, Approved: 4, Merged: 5, Cancelled: 4 }[state] ?? 0;
}
