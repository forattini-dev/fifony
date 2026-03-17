import React, { useState, useEffect, useRef } from "react";
import { Zap, Circle, Activity, Lightbulb, Loader } from "lucide-react";
import { timeAgo } from "../utils.js";

const STATE_BADGE = {
  Planning: "badge-info",
  Todo: "badge-warning",
  Queued: "badge-info",
  Running: "badge-primary",
  Interrupted: "badge-accent",
  "In Review": "badge-secondary",
  Blocked: "badge-error",
  Done: "badge-success",
  Cancelled: "badge-neutral",
};

const STATE_BORDER_LEFT = {
  Planning: "border-l-info",
  Todo: "border-l-warning",
  Queued: "border-l-info",
  Running: "border-l-primary",
  Interrupted: "border-l-accent",
  "In Review": "border-l-secondary",
  Blocked: "border-l-error",
  Done: "border-l-success",
  Cancelled: "border-l-neutral",
};

function formatTokens(count) {
  if (count == null || count === 0) return null;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function derivePhase(tokensByPhase) {
  if (!tokensByPhase) return null;
  if (tokensByPhase.reviewer?.totalTokens > 0) return "Reviewing";
  if (tokensByPhase.executor?.totalTokens > 0) return "Executing";
  if (tokensByPhase.planner?.totalTokens > 0) return "Planning";
  return null;
}

export function IssueCard({ issue, onSelect, dragHandlers, isDragging }) {
  const isRunning = issue.state === "Running";
  const isInReview = issue.state === "In Review";
  const isPlanning = issue.state === "Planning";
  const isDone = issue.state === "Done";
  const isCancelled = issue.state === "Cancelled";
  const isBlocked = issue.state === "Blocked";
  const isPlanBusy = issue.planningStatus === "planning" || issue.planningStatus === "refining";
  const showTokens = isRunning || isInReview;

  // Track previous token count for bump animation
  const prevTokensRef = useRef(issue.tokenUsage?.totalTokens);
  const [tokenBump, setTokenBump] = useState(false);

  // Track completion flash
  const prevStateRef = useRef(issue.state);
  const [completionFlash, setCompletionFlash] = useState(false);

  useEffect(() => {
    const currentTokens = issue.tokenUsage?.totalTokens;
    if (currentTokens != null && currentTokens !== prevTokensRef.current) {
      setTokenBump(true);
      const timer = setTimeout(() => setTokenBump(false), 300);
      prevTokensRef.current = currentTokens;
      return () => clearTimeout(timer);
    }
  }, [issue.tokenUsage?.totalTokens]);

  useEffect(() => {
    if (prevStateRef.current !== "Done" && issue.state === "Done") {
      setCompletionFlash(true);
      const timer = setTimeout(() => setCompletionFlash(false), 800);
      prevStateRef.current = issue.state;
      return () => clearTimeout(timer);
    }
    prevStateRef.current = issue.state;
  }, [issue.state]);

  const formattedTokens = showTokens ? formatTokens(issue.tokenUsage?.totalTokens) : null;
  const phase = isRunning ? derivePhase(issue.tokensByPhase) : null;
  const outputTail = isRunning && issue.commandOutputTail
    ? issue.commandOutputTail.trim().split("\n").pop()?.slice(-60) || null
    : null;

  return (
    <div
      data-issue-id={issue.id}
      className={[
        "card card-compact bg-base-100 border border-base-300 border-l-[3px]",
        STATE_BORDER_LEFT[issue.state] || "",
        // State-differentiated visual weight
        isPlanning ? "animate-pulse-soft-border" : "",
        isRunning ? "animate-pulse-border" : "",
        isDone ? "opacity-80" : "",
        isCancelled ? "opacity-60" : "",
        isBlocked ? "issue-card-blocked" : "",
        // Only allow hover-lift for non-terminal states
        (!isDone && !isCancelled) ? "card-interactive" : "",
        "cursor-pointer",
        isDragging ? "kanban-card-source-opacity" : "",
        completionFlash ? "issue-card-done-flash" : "",
      ].filter(Boolean).join(" ")}
      style={{ overflow: "hidden" }}
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(issue)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect?.(issue);
        }
      }}
      aria-label={`Open issue ${issue.identifier}`}
      {...(dragHandlers || {})}
    >
      <div className="card-body gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="font-mono text-xs opacity-50">{issue.identifier}</span>
            <h3 className={`font-semibold text-sm truncate ${isCancelled ? "line-through opacity-60" : ""}`}>{issue.title}</h3>
          </div>
          <span className={`badge badge-xs ${STATE_BADGE[issue.state] || "badge-ghost"} shrink-0`}>
            {issue.state}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-xs opacity-50">
          <span>P{issue.priority}</span>
          <span>·</span>
          <span>{timeAgo(issue.updatedAt)}</span>
          {issue.capabilityCategory && (
            <>
              <span>·</span>
              <span>{issue.capabilityCategory}</span>
            </>
          )}

          {/* Live token counter */}
          {formattedTokens && (
            <>
              <span>·</span>
              <span className={`inline-flex items-center gap-0.5 ${tokenBump ? "animate-count-bump" : ""}`}>
                <Zap size={10} />
                {formattedTokens} tokens
              </span>
            </>
          )}

          {/* Phase indicator */}
          {phase && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1 text-primary font-medium">
                <span className="issue-phase-dot" />
                {phase}
              </span>
            </>
          )}

          {/* Planning in progress indicator */}
          {isPlanBusy && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1 text-info font-medium">
                <Loader size={10} className="animate-spin" />
                {issue.planningStatus === "refining" ? "Refining" : "Planning"}
              </span>
            </>
          )}
        </div>

        {/* Recent command output preview */}
        {outputTail && (
          <div
            className="font-mono text-[10px] leading-tight opacity-40 truncate mt-0.5"
            title={issue.commandOutputTail}
          >
            {outputTail}
          </div>
        )}
      </div>

      {/* Progress heartbeat bar for Running issues */}
      {isRunning && (
        <div className="issue-heartbeat-bar animate-pulse-soft" />
      )}

      {/* Planning progress bar */}
      {isPlanBusy && (
        <div className="h-[3px] rounded-b-[var(--rounded-box,1rem)] bg-info animate-pulse-soft" />
      )}
    </div>
  );
}

export default IssueCard;
