import { createFileRoute } from "@tanstack/react-router";
import { useDashboard } from "../context/DashboardContext";
import ListView from "../components/ListView";
import { Search, X } from "lucide-react";

const STATES = ["Todo", "Queued", "Running", "Interrupted", "In Review", "Blocked", "Done", "Cancelled"];

const STATE_COLOR = {
  Todo: "badge-warning", Queued: "badge-info", Running: "badge-primary", Interrupted: "badge-accent",
  "In Review": "badge-secondary", Blocked: "badge-error", Done: "badge-success", Cancelled: "badge-neutral",
};

const COMPLETION_OPTIONS = [
  { value: "recent", label: "Active + recent" },
  { value: "all", label: "All" },
];

export const Route = createFileRoute("/issues")({
  component: IssuesPage,
});

function IssuesPage() {
  const ctx = useDashboard();

  const hasFilters = ctx.stateFilter !== "all" || ctx.categoryFilter !== "all" || ctx.completionFilter !== "recent";
  const hiddenCount = (ctx.data._totalIssues ?? 0) - (ctx.issues.length ?? 0);

  const stateCounts = {};
  for (const issue of ctx.issues) {
    stateCounts[issue.state] = (stateCounts[issue.state] || 0) + 1;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-3">
      {/* Search */}
      <label className="input input-bordered flex items-center gap-2">
        <Search className="size-4 opacity-40" />
        <input
          type="text"
          className="grow"
          placeholder="Search issues by title, ID, or description..."
          value={ctx.query}
          onChange={(e) => ctx.setQuery(e.target.value)}
          aria-label="Search issues"
        />
        {ctx.query && (
          <button className="btn btn-xs btn-ghost btn-circle" onClick={() => ctx.setQuery("")}>
            <X className="size-3" />
          </button>
        )}
      </label>

      {/* Filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATES.map((s) => {
          const count = stateCounts[s] || 0;
          const isActive = ctx.stateFilter === s;
          if (count === 0 && !isActive) return null;
          return (
            <button
              key={s}
              className={`badge gap-1 cursor-pointer transition-all ${isActive ? STATE_COLOR[s] : "badge-ghost opacity-60 hover:opacity-100"}`}
              onClick={() => ctx.setStateFilter(isActive ? "all" : s)}
            >
              {s}
              <span className="font-mono text-[10px]">{count}</span>
            </button>
          );
        })}

        <div className="w-px h-4 bg-base-300" />

        {ctx.categoryOptions.length > 2 && (
          <select
            className="select select-bordered select-xs"
            value={ctx.categoryFilter}
            onChange={(e) => ctx.setCategoryFilter(e.target.value)}
          >
            {ctx.categoryOptions.map((c) => (
              <option key={c} value={c}>{c === "all" ? "All capabilities" : c}</option>
            ))}
          </select>
        )}

        <select
          className="select select-bordered select-xs"
          value={ctx.completionFilter}
          onChange={(e) => ctx.setCompletionFilter(e.target.value)}
        >
          {COMPLETION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {hiddenCount > 0 && ctx.completionFilter === "recent" && (
          <span className="text-xs opacity-40">+{hiddenCount} older</span>
        )}

        {hasFilters && (
          <button
            className="text-xs opacity-50 hover:opacity-100 underline"
            onClick={() => { ctx.setStateFilter("all"); ctx.setCategoryFilter("all"); ctx.setCompletionFilter("recent"); }}
          >
            clear filters
          </button>
        )}

        <span className="text-xs opacity-40 ml-auto">
          {ctx.filtered.length} issue{ctx.filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* List */}
      <div className="flex-1 flex flex-col min-h-0">
        <ListView
          issues={ctx.filtered}
          onStateChange={ctx.updateState}
          onRetry={ctx.retryIssue}
          onCancel={ctx.cancelIssue}
          onSelect={ctx.setSelectedIssue}
        />
      </div>
    </div>
  );
}
