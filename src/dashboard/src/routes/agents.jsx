import { createFileRoute } from "@tanstack/react-router";
import { useDashboard } from "../context/DashboardContext";
import RuntimeView from "../components/RuntimeView";

export const Route = createFileRoute("/agents")({
  component: RuntimePage,
});

function RuntimePage() {
  const ctx = useDashboard();
  return (
    <RuntimeView
      state={ctx.data}
      providers={ctx.providers.data || {}}
      parallelism={ctx.parallelism.data || {}}
      onRefresh={ctx.refresh}
    />
  );
}
