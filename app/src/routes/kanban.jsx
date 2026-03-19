import { createFileRoute } from "@tanstack/react-router";
import { useDashboard } from "../context/DashboardContext";
import BoardView from "../components/BoardView";
import StatsBar from "../components/StatsBar";
import { useTokenAnalytics } from "../hooks.js";

export const Route = createFileRoute("/kanban")({
  component: KanbanPage,
});

function KanbanPage() {
  const ctx = useDashboard();
  const { data: analytics } = useTokenAnalytics();
  const totalTokens = analytics?.overall?.totalTokens || 0;
  const hasData = totalTokens > 0 || ctx.issues.length > 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 px-3 pb-2 gap-2">
      {hasData && (
        <StatsBar metrics={ctx.metrics} total={ctx.issues.length} issues={ctx.issues} compact defaultBranch={ctx.data?.config?.defaultBranch} />
      )}
      <BoardView
        issues={ctx.filtered}
        onStateChange={ctx.updateState}
        onRetry={ctx.retryIssue}
        onCancel={ctx.cancelIssue}
        onSelect={ctx.setSelectedIssue}
        onCreateIssue={() => ctx.setIsCreateOpen(true)}
      />
    </div>
  );
}
