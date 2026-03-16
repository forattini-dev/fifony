import React from "react";
import { RefreshCw } from "lucide-react";
import { formatDate } from "../utils.js";

export function RuntimeView({ state, providers, parallelism, onRefresh, concurrency, setConcurrency, saveConcurrency }) {
  return (
    <div className="space-y-4">
      {/* Runtime info card */}
      <div className="card bg-base-200">
        <div className="card-body">
          <h3 className="card-title text-sm">Runtime</h3>
          <div className="text-sm space-y-1">
            <p><span className="opacity-70">Source:</span> {state.sourceRepoUrl || "local"}</p>
            <p><span className="opacity-70">Tracker:</span> {state.trackerKind || "filesystem"}</p>
            <p><span className="opacity-70">Agent:</span> {state.config?.agentProvider || "auto"}</p>
            <p><span className="opacity-70">Started:</span> {formatDate(state.startedAt)}</p>
          </div>

          {/* Concurrency control */}
          <div className="flex items-center gap-2 mt-3">
            <label className="text-xs font-medium" htmlFor="concurrency-input">
              Concurrency:
            </label>
            <input
              id="concurrency-input"
              className="input input-bordered input-sm w-20"
              type="number"
              min={1}
              max={16}
              value={concurrency}
              onChange={(e) => setConcurrency(e.target.value)}
            />
            <button className="btn btn-sm btn-primary" onClick={saveConcurrency}>
              Set
            </button>
          </div>

          <div className="mt-2">
            <button className="btn btn-sm btn-soft gap-1" onClick={onRefresh}>
              <RefreshCw className="size-3.5" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Providers card */}
        <div className="card bg-base-200">
          <div className="card-body">
            <h3 className="card-title text-sm">Providers</h3>
            <div className="flex flex-wrap gap-2">
              {providers?.providers?.length ? (
                providers.providers.map((p) => (
                  <span
                    key={p.name}
                    className={`badge badge-sm ${p.available ? "badge-success" : "badge-warning"}`}
                  >
                    {p.name}
                  </span>
                ))
              ) : (
                <span className="text-sm opacity-50">None</span>
              )}
            </div>
          </div>
        </div>

        {/* Parallelism card */}
        <div className="card bg-base-200">
          <div className="card-body">
            <h3 className="card-title text-sm">Parallelism</h3>
            <p className="text-sm">
              {typeof parallelism?.maxSafeParallelism === "number"
                ? `Max safe: ${parallelism.maxSafeParallelism}`
                : "No data"}
            </p>
            {parallelism?.reason && (
              <p className="text-xs opacity-60">{parallelism.reason}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default RuntimeView;
