import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  ChevronDown, PlayCircle, RotateCcw, XCircle, CheckCircle2,
  AlertTriangle, GitMerge, ListOrdered, Eye, Archive, Circle,
} from "lucide-react";
import { getIssueTransitions } from "../../utils.js";
import { STATE_ICON, STATE_BADGE } from "./constants.js";

// ── Transition metadata ──────────────────────────────────────────────────────
// Maps (fromState→toState) to human label, icon, keyboard shortcut, and handler.
// handler: "state" (generic), "replan", "retry", "cancel", "execute"

const TRANSITION_META = {
  // Planning
  "Planning→PendingApproval":   { label: "Submit Plan",     icon: CheckCircle2 },
  "Planning→Cancelled":         { label: "Cancel",          icon: XCircle, danger: true, handler: "cancel" },

  // PendingApproval
  "PendingApproval→Queued":     { label: "Execute",         icon: PlayCircle,   shortcut: "⌃↵", handler: "execute" },
  "PendingApproval→Planning":   { label: "Replan",          icon: RotateCcw,    shortcut: "⌃P", handler: "replan" },
  "PendingApproval→Cancelled":  { label: "Cancel",          icon: XCircle, danger: true, handler: "cancel" },

  // Running (manual overrides — rarely used)
  "Running→Reviewing":          { label: "Force Complete",   icon: Eye },
  "Running→Queued":             { label: "Re-queue",         icon: ListOrdered },
  "Running→Blocked":            { label: "Mark Blocked",     icon: AlertTriangle, warning: true },

  // Reviewing (manual overrides)
  "Reviewing→PendingDecision":  { label: "Force Complete",   icon: Eye },
  "Reviewing→Queued":           { label: "Re-queue",         icon: ListOrdered },
  "Reviewing→Blocked":          { label: "Mark Blocked",     icon: AlertTriangle, warning: true },

  // PendingDecision
  "PendingDecision→Approved":   { label: "Approve",          icon: CheckCircle2, shortcut: "⌃A" },
  "PendingDecision→Queued":     { label: "Request Rework",   icon: RotateCcw,    shortcut: "⌃W", handler: "retry" },
  "PendingDecision→Planning":   { label: "Replan",           icon: RotateCcw,    shortcut: "⌃P", handler: "replan" },
  "PendingDecision→Cancelled":  { label: "Cancel",           icon: XCircle, danger: true, handler: "cancel" },

  // Blocked
  "Blocked→Queued":             { label: "Retry",            icon: RotateCcw,    shortcut: "⌃↵", handler: "retry" },
  "Blocked→Reviewing":          { label: "Force Review",     icon: Eye },
  "Blocked→Planning":           { label: "Replan",           icon: RotateCcw,    shortcut: "⌃P", handler: "replan" },
  "Blocked→Cancelled":          { label: "Cancel",           icon: XCircle, danger: true, handler: "cancel" },

  // Approved
  "Approved→Merged":            { label: "Merge",            icon: GitMerge,     shortcut: "⌃M" },
  "Approved→Planning":          { label: "Replan",           icon: RotateCcw,    shortcut: "⌃P", handler: "replan" },

  // Terminal
  "Merged→Archived":            { label: "Archive",          icon: Archive },
  "Merged→Planning":            { label: "Reopen",           icon: RotateCcw },
  "Cancelled→Archived":         { label: "Archive",          icon: Archive },
  "Cancelled→Planning":         { label: "Reopen",           icon: RotateCcw },
};

function getMeta(from, to) {
  return TRANSITION_META[`${from}→${to}`] || { label: to, icon: STATE_ICON[to] || Circle };
}

// ── Component ────────────────────────────────────────────────────────────────

export function StateActionMenu({ issue, onStateChange, onRetry, onCancel, onReplan, onExecute }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const transitions = getIssueTransitions(issue.state);
  const nextStates = transitions.filter((s) => s !== issue.state);
  const hasActions = nextStates.length > 0;

  const Icon = STATE_ICON[issue.state] || Circle;
  const badgeClass = STATE_BADGE[issue.state] || "badge-ghost";

  const handleAction = useCallback((targetState, handler) => {
    setOpen(false);
    switch (handler) {
      case "cancel":  onCancel?.(issue.id); break;
      case "replan":  onReplan?.(issue.id); break;
      case "retry":   onRetry?.(issue.id); break;
      case "execute": onExecute?.(issue.id); break;
      default:        onStateChange?.(issue.id, targetState);
    }
  }, [issue.id, onStateChange, onRetry, onCancel, onReplan, onExecute]);

  // Split into normal + danger actions
  const normal = [];
  const danger = [];
  for (const target of nextStates) {
    const meta = getMeta(issue.state, target);
    const item = { target, ...meta };
    if (meta.danger) danger.push(item);
    else normal.push(item);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        className={`badge ${badgeClass} badge-soft badge-sm gap-1 ${hasActions ? "cursor-pointer hover:brightness-90 active:scale-95" : ""} transition-all select-none`}
        onClick={() => hasActions && setOpen((p) => !p)}
        aria-haspopup={hasActions ? "menu" : undefined}
        aria-expanded={open}
      >
        <Icon className="size-3" />
        <span>{issue.state}</span>
        {hasActions && (
          <ChevronDown className={`size-2.5 opacity-50 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
        )}
      </button>

      {open && hasActions && (
        <div
          role="menu"
          className="absolute top-full left-0 mt-1.5 z-[60] min-w-[210px] bg-base-100 border border-base-300 rounded-box shadow-xl py-1 animate-fade-in"
        >
          <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider opacity-35">
            Move to
          </div>

          {normal.map(({ target, label, icon: ItemIcon, shortcut, warning, handler }) => (
            <button
              key={target}
              role="menuitem"
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] hover:bg-base-200 transition-colors text-left ${warning ? "text-warning" : ""}`}
              onClick={() => handleAction(target, handler)}
            >
              <ItemIcon className="size-3.5 opacity-50 shrink-0" />
              <span className="flex-1">{label}</span>
              {shortcut && <kbd className="kbd kbd-xs text-[10px] opacity-30">{shortcut}</kbd>}
            </button>
          ))}

          {danger.length > 0 && (
            <>
              <div className="border-t border-base-300 my-1" />
              {danger.map(({ target, label, icon: ItemIcon, shortcut, handler }) => (
                <button
                  key={target}
                  role="menuitem"
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] hover:bg-error/10 transition-colors text-left text-error/80 hover:text-error"
                  onClick={() => handleAction(target, handler)}
                >
                  <ItemIcon className="size-3.5 shrink-0" />
                  <span className="flex-1">{label}</span>
                  {shortcut && <kbd className="kbd kbd-xs text-[10px] opacity-30">{shortcut}</kbd>}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
