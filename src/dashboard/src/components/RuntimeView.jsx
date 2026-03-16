import React, { useState, useEffect, useCallback } from "react";
import { Cpu, Circle, Clock, Terminal, CheckCircle2, XCircle, AlertTriangle, Pause, ListOrdered } from "lucide-react";
import { timeAgo, formatDuration } from "../utils.js";
import { api } from "../api.js";

const STATE_BADGE = {
  Queued: "badge-info", Running: "badge-primary", Interrupted: "badge-accent",
  "In Review": "badge-secondary", Blocked: "badge-error", Done: "badge-success", Cancelled: "badge-neutral",
};

const STATE_ICON = {
  Queued: ListOrdered, Running: Circle, Interrupted: Pause,
  "In Review": Circle, Blocked: AlertTriangle, Done: CheckCircle2, Cancelled: XCircle,
};

// ── Slot live output ────────────────────────────────────────────────────────

function SlotLiveInfo({ issueId }) {
  const [live, setLive] = useState(null);

  const fetchLive = useCallback(async () => {
    try {
      const res = await api.get(`/live/${encodeURIComponent(issueId)}`);
      setLive(res);
    } catch { /* ignore */ }
  }, [issueId]);

  useEffect(() => {
    fetchLive();
    const interval = setInterval(fetchLive, 4000);
    return () => clearInterval(interval);
  }, [fetchLive]);

  if (!live) return null;

  const elapsed = Number.isFinite(Number(live.elapsed))
    ? Number(live.elapsed)
    : live.startedAt ? Math.max(Date.now() - new Date(live.startedAt).getTime(), 0) : 0;
  const logKb = live.logSize ? (live.logSize / 1024).toFixed(1) : "0";

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center gap-3 text-xs opacity-60">
        <span className="flex items-center gap-1"><Clock className="size-3" />{formatDuration(elapsed)}</span>
        <span>Log: {logKb} KB</span>
        {live.agentPid && <span>PID {live.agentPid}</span>}
        {live.agentAlive === false && live.agentPid && <span className="text-error">dead</span>}
      </div>
      {live.logTail && (
        <pre className="text-[10px] bg-base-300 rounded-box p-2 overflow-x-auto whitespace-pre-wrap max-h-28 overflow-y-auto font-mono opacity-70 leading-relaxed">
          {live.logTail.slice(-1200)}
        </pre>
      )}
    </div>
  );
}

// ── Active agent slot ───────────────────────────────────────────────────────

function AgentSlot({ index, issue }) {
  if (!issue) {
    return (
      <div className="slot-idle rounded-box p-4 flex items-center justify-center opacity-30 transition-opacity duration-300 hover:opacity-40">
        <div className="flex items-center gap-2 text-sm">
          <Circle className="size-4 animate-pulse-soft" />
          Slot {index + 1} — idle
        </div>
      </div>
    );
  }

  const isRunning = issue.state === "Running";
  const borderClass = issue.state === "In Review"
    ? "border-secondary/40 bg-secondary/5"
    : "border-primary/40 bg-primary/5";

  return (
    <div className={`border rounded-box p-4 space-y-2 animate-fade-in-scale ${borderClass} ${isRunning ? "slot-active" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="loading loading-spinner loading-xs text-primary" />
          <span className="font-mono text-sm font-semibold">{issue.identifier}</span>
          <span className={`badge badge-xs ${STATE_BADGE[issue.state] || "badge-ghost"}`}>{issue.state}</span>
        </div>
        <span className="text-xs opacity-40">Slot {index + 1}</span>
      </div>

      <div className="text-sm truncate">{issue.title}</div>

      <div className="flex flex-wrap gap-2 text-xs opacity-50">
        {issue.capabilityCategory && <span className="badge badge-xs badge-ghost">{issue.capabilityCategory}</span>}
        <span>P{issue.priority}</span>
        <span>Attempt {(issue.attempts || 0) + 1}/{issue.maxAttempts}</span>
        {issue.startedAt && <span>started {timeAgo(issue.startedAt)}</span>}
      </div>

      <SlotLiveInfo issueId={issue.id} />
    </div>
  );
}

// ── Queue item ──────────────────────────────────────────────────────────────

function QueueItem({ issue }) {
  const Icon = STATE_ICON[issue.state] || Circle;
  return (
    <div className="flex items-center gap-2 text-xs py-1.5 px-3 rounded-lg bg-base-200">
      <Icon className="size-3 opacity-40 shrink-0" />
      <span className="font-mono opacity-60 shrink-0">{issue.identifier}</span>
      <span className="truncate flex-1">{issue.title}</span>
      <span className={`badge badge-xs ${STATE_BADGE[issue.state] || "badge-ghost"}`}>{issue.state}</span>
      {issue.state === "Blocked" && issue.nextRetryAt && (
        <span className="opacity-40 shrink-0">retry {timeAgo(issue.nextRetryAt)}</span>
      )}
    </div>
  );
}

// ── Recently completed ──────────────────────────────────────────────────────

function CompletedItem({ issue }) {
  const Icon = issue.state === "Done" ? CheckCircle2 : XCircle;
  const color = issue.state === "Done" ? "text-success" : "text-neutral";
  return (
    <div className="flex items-center gap-2 text-xs py-1.5 px-3 rounded-lg bg-base-200">
      <Icon className={`size-3 shrink-0 ${color}`} />
      <span className="font-mono opacity-60 shrink-0">{issue.identifier}</span>
      <span className="truncate flex-1 opacity-70">{issue.title}</span>
      {issue.durationMs && <span className="opacity-40 shrink-0">{formatDuration(issue.durationMs)}</span>}
      {issue.completedAt && <span className="opacity-40 shrink-0">{timeAgo(issue.completedAt)}</span>}
    </div>
  );
}

// ── Main view ───────────────────────────────────────────────────────────────

export function RuntimeView({ state, providers, parallelism, onRefresh }) {
  const issues = Array.isArray(state.issues) ? state.issues : [];
  const concurrency = Number(state.config?.workerConcurrency) || 2;

  const running = issues.filter((i) => i.state === "Running" || i.state === "In Review");
  const queued = issues.filter((i) =>
    i.state === "Todo" || i.state === "Queued" || i.state === "Interrupted"
    || (i.state === "Blocked" && i.nextRetryAt),
  );
  const completed = issues
    .filter((i) => i.state === "Done" || i.state === "Cancelled")
    .sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""))
    .slice(0, 10);

  // Build slot array
  const slots = [];
  for (let i = 0; i < concurrency; i++) {
    slots.push(running[i] || null);
  }

  return (
    <div className="space-y-6">
      {/* Active agents */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-1.5">
            <Cpu className="size-4 opacity-50" />
            Active Agents
          </h3>
          <span className="text-xs opacity-50">{running.length}/{concurrency} slots</span>
        </div>
        <div className="grid gap-3">
          {slots.map((issue, i) => (
            <AgentSlot key={i} index={i} issue={issue} />
          ))}
        </div>
      </div>

      {/* Queue */}
      {queued.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold text-sm opacity-70 flex items-center gap-1.5">
            <ListOrdered className="size-4 opacity-50" />
            Queue
            <span className="badge badge-xs badge-ghost">{queued.length}</span>
          </h3>
          <div className="space-y-1 stagger-children">
            {queued.slice(0, 12).map((issue) => (
              <QueueItem key={issue.id} issue={issue} />
            ))}
            {queued.length > 12 && <div className="text-xs opacity-40 pl-3">+{queued.length - 12} more</div>}
          </div>
        </div>
      )}

      {/* Recently completed */}
      {completed.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold text-sm opacity-70 flex items-center gap-1.5">
            <CheckCircle2 className="size-4 opacity-50" />
            Recently Completed
            <span className="badge badge-xs badge-ghost">{completed.length}</span>
          </h3>
          <div className="space-y-1 stagger-children">
            {completed.map((issue) => (
              <CompletedItem key={issue.id} issue={issue} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {running.length === 0 && queued.length === 0 && completed.length === 0 && (
        <div className="text-sm opacity-40 text-center py-12">
          No agents running. Create an issue to get started.
        </div>
      )}
    </div>
  );
}

export default RuntimeView;
