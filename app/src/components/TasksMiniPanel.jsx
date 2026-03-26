import React, { useMemo } from "react";

const IN_PROGRESS_STATES = new Set(["Planning", "Queued", "Running", "Reviewing"]);
const NEEDS_ATTENTION_STATES = new Set(["PendingApproval", "PendingDecision", "Blocked"]);
const DONE_STATES = new Set(["Merged", "Approved", "Cancelled"]);

const STATE_DOT = {
  Planning: "bg-info",
  Queued: "bg-info",
  Running: "bg-primary animate-pulse",
  Reviewing: "bg-secondary animate-pulse",
  PendingApproval: "bg-warning",
  PendingDecision: "bg-warning",
  Blocked: "bg-error",
  Merged: "bg-success",
  Approved: "bg-success",
  Cancelled: "bg-neutral",
};

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function IssueChip({ issue, onSelect }) {
  return (
    <button
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-base-200 text-left transition-colors group"
      onClick={() => onSelect?.(issue)}
    >
      <span className={`size-1.5 rounded-full shrink-0 ${STATE_DOT[issue.state] || "bg-base-content/20"}`} />
      <span className="font-mono text-[10px] opacity-40 shrink-0">{issue.identifier}</span>
      <span className="text-xs truncate flex-1 opacity-60 group-hover:opacity-100 transition-opacity">
        {issue.title}
      </span>
    </button>
  );
}

function TaskGroup({ label, count, issues, onSelect, emptyText }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-2">
        <span className="text-[9px] font-bold uppercase tracking-widest opacity-30">{label}</span>
        <span className="text-[10px] opacity-30 font-mono">{count}</span>
      </div>
      {issues.length === 0 ? (
        <div className="text-xs opacity-20 px-2 py-1">{emptyText}</div>
      ) : (
        <div>
          {issues.map((issue) => (
            <IssueChip key={issue.id} issue={issue} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TasksMiniPanel({ issues = [], onSelect }) {
  const { inProgress, needsAttention, done } = useMemo(() => {
    const now = Date.now();
    return {
      inProgress: issues.filter((i) => IN_PROGRESS_STATES.has(i.state)),
      needsAttention: issues.filter((i) => NEEDS_ATTENTION_STATES.has(i.state)),
      done: issues
        .filter((i) => {
          if (!DONE_STATES.has(i.state)) return false;
          const ts = i.completedAt || i.updatedAt;
          return ts ? now - new Date(ts).getTime() < ONE_WEEK_MS : false;
        })
        .slice(0, 8),
    };
  }, [issues]);

  return (
    <div className="flex flex-col gap-5 pt-3 border-l border-base-300 pl-4">
      <div className="text-xs font-semibold opacity-50 uppercase tracking-widest px-2">Tasks</div>
      <TaskGroup
        label="In Progress"
        count={inProgress.length}
        issues={inProgress}
        onSelect={onSelect}
        emptyText="No agents running"
      />
      <TaskGroup
        label="Needs Attention"
        count={needsAttention.length}
        issues={needsAttention}
        onSelect={onSelect}
        emptyText="Nothing pending"
      />
      <TaskGroup
        label="Done This Week"
        count={done.length}
        issues={done}
        onSelect={onSelect}
        emptyText="Nothing completed yet"
      />
    </div>
  );
}

export default TasksMiniPanel;
