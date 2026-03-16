import React from "react";
import { RotateCcw, X } from "lucide-react";
import { timeAgo } from "../utils.js";
import { STATES, getIssueTransitions } from "../utils.js";

const STATE_BADGE = {
  Todo: "badge-warning",
  "In Progress": "badge-primary",
  "In Review": "badge-secondary",
  Blocked: "badge-error",
  Done: "badge-success",
  Cancelled: "badge-neutral",
};

export function IssueCard({ issue, onStateChange, onRetry, onCancel, onSelect }) {
  const transitions = getIssueTransitions(issue.state);

  return (
    <div
      className="card card-compact bg-base-100 border border-base-300 transition-shadow hover:shadow-md cursor-pointer"
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
    >
      <div className="card-body gap-2">
        {/* Header: identifier + title + state badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="font-mono text-xs opacity-60">{issue.identifier}</span>
            <h3 className="font-semibold text-sm truncate">{issue.title}</h3>
          </div>
          <span className={`badge badge-sm ${STATE_BADGE[issue.state] || "badge-ghost"} shrink-0`}>
            {issue.state}
          </span>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-1">
          <span className="badge badge-xs badge-outline">P{issue.priority}</span>
          <span className="badge badge-xs badge-outline">
            {issue.attempts}/{issue.maxAttempts}
          </span>
          {issue.capabilityCategory && (
            <span className="badge badge-xs badge-outline">{issue.capabilityCategory}</span>
          )}
          <span className="badge badge-xs badge-ghost">{timeAgo(issue.updatedAt)}</span>
        </div>

        {/* Error */}
        {issue.lastError && (
          <p className="text-xs text-error truncate">{issue.lastError}</p>
        )}

        {/* Actions */}
        <div className="card-actions justify-end">
          <select
            className="select select-bordered select-xs"
            value={issue.state}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              event.stopPropagation();
              onStateChange(issue.id, event.target.value);
            }}
            aria-label={`Change state for ${issue.identifier}`}
          >
            {transitions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <button
            className="btn btn-xs btn-soft gap-1"
            onClick={(event) => {
              event.stopPropagation();
              onRetry(issue.id);
            }}
            disabled={issue.state === "In Progress" || issue.state === "In Review"}
            aria-label="Retry"
          >
            <RotateCcw className="size-3" />
            Retry
          </button>

          <button
            className="btn btn-xs btn-ghost gap-1"
            onClick={(event) => {
              event.stopPropagation();
              onCancel(issue.id);
            }}
            disabled={issue.state === "Done" || issue.state === "Cancelled"}
            aria-label="Cancel"
          >
            <X className="size-3" />
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default IssueCard;
