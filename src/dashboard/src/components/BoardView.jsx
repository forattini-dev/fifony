import { useMemo } from "react";
import { IssueCard } from "./IssueCard.jsx";
import { EmptyState } from "./EmptyState.jsx";
import { Plus, Play, Eye, AlertTriangle, CheckCircle, XCircle } from "lucide-react";

const STATES = ["Todo", "In Progress", "In Review", "Blocked", "Done", "Cancelled"];


const STATE_BADGE = {
  Todo: "badge-warning",
  "In Progress": "badge-primary",
  "In Review": "badge-secondary",
  Blocked: "badge-error",
  Done: "badge-success",
  Cancelled: "badge-neutral",
};

const EMPTY_CONFIG = {
  Todo: { icon: Plus, desc: "Create an issue to get started" },
  "In Progress": { icon: Play, desc: "Issues move here when agents start" },
  "In Review": { icon: Eye, desc: "Completed work awaiting review" },
  Blocked: { icon: AlertTriangle, desc: "Issues needing attention" },
  Done: { icon: CheckCircle, desc: "Completed issues land here" },
  Cancelled: { icon: XCircle, desc: "Cancelled issues" },
};

export function BoardView({ issues, onStateChange, onRetry, onCancel, onSelect }) {
  const grouped = useMemo(() => {
    const buckets = Object.fromEntries(STATES.map((s) => [s, []]));
    for (const issue of issues) {
      (buckets[issue.state] || buckets.Todo).push(issue);
    }
    for (const s of STATES) {
      buckets[s].sort((a, b) => a.priority - b.priority);
    }
    return buckets;
  }, [issues]);

  const visibleStates = STATES;

  return (
    <div className="overflow-x-auto pb-2 flex-1 flex flex-col min-h-0">
      <div
        className="grid gap-3 flex-1"
        style={{
          gridTemplateColumns: `repeat(${visibleStates.length}, minmax(0, 1fr))`,
          minWidth: `${visibleStates.length * 180}px`,
        }}
      >
        {visibleStates.map((state) => {
          const empty = EMPTY_CONFIG[state] || EMPTY_CONFIG.Todo;
          return (
            <div key={state} className="bg-base-200 rounded-box p-3 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-wide opacity-70">
                  {state}
                </h3>
                <span className={`badge badge-xs ${STATE_BADGE[state]}`}>
                  {grouped[state].length}
                </span>
              </div>

              <div className="space-y-2 flex-1 overflow-y-auto">
                {grouped[state].length === 0 ? (
                  <EmptyState
                    icon={empty.icon}
                    title="No issues"
                    description={empty.desc}
                  />
                ) : (
                  grouped[state].map((issue) => (
                    <IssueCard
                      key={issue.id}
                      issue={issue}
                      onStateChange={onStateChange}
                      onRetry={onRetry}
                      onCancel={onCancel}
                      onSelect={onSelect}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default BoardView;
