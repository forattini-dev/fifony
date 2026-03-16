import { createFileRoute } from "@tanstack/react-router";
import { useDashboard } from "../context/DashboardContext";
import BoardView from "../components/BoardView";
import StatsBar from "../components/StatsBar";

export const Route = createFileRoute("/kanban")({
  component: KanbanPage,
});

function KanbanPage() {
  const ctx = useDashboard();
  return (
    <>
      <StatsBar metrics={ctx.metrics} total={ctx.issues.length} issues={ctx.issues} />
      <BoardView
        issues={ctx.filtered}
        onStateChange={ctx.updateState}
        onRetry={ctx.retryIssue}
        onCancel={ctx.cancelIssue}
        onSelect={ctx.setSelectedIssue}
      />
    </>
  );
}
