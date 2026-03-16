import React from "react";
import { LayoutList, Clock, Play, AlertTriangle, CheckCircle } from "lucide-react";

export function StatsBar({ metrics, total }) {
  const totalCount = total ?? metrics.total ?? 0;
  const queued = metrics.queued ?? 0;
  const running = metrics.inProgress ?? 0;
  const blocked = metrics.blocked ?? 0;
  const done = metrics.done ?? 0;

  return (
    <div className="stats stats-horizontal bg-base-200 rounded-box w-full mb-4 overflow-x-auto">
      <div className="stat">
        <div className="stat-figure text-secondary hidden sm:inline">
          <LayoutList className="size-8" />
        </div>
        <div className="stat-title">Total</div>
        <div className="stat-value">{totalCount}</div>
        <div className="stat-desc">All issues</div>
      </div>

      <div className="stat">
        <div className="stat-figure text-secondary hidden sm:inline">
          <Clock className="size-8" />
        </div>
        <div className="stat-title">Queued</div>
        <div className="stat-value">{queued}</div>
        <div className="stat-desc">Waiting to start</div>
      </div>

      <div className="stat">
        <div className="stat-figure text-primary hidden sm:inline">
          <Play className="size-8" />
        </div>
        <div className="stat-title">Running</div>
        <div className="stat-value text-primary">{running}</div>
        <div className="stat-desc">In progress now</div>
      </div>

      <div className="stat">
        <div className="stat-figure text-error hidden sm:inline">
          <AlertTriangle className="size-8" />
        </div>
        <div className="stat-title">Blocked</div>
        <div className="stat-value text-error">{blocked}</div>
        <div className="stat-desc">Needs attention</div>
      </div>

      <div className="stat">
        <div className="stat-figure text-success hidden sm:inline">
          <CheckCircle className="size-8" />
        </div>
        <div className="stat-title">Done</div>
        <div className="stat-value text-success">{done}</div>
        <div className="stat-desc">Completed</div>
      </div>
    </div>
  );
}

export default StatsBar;
