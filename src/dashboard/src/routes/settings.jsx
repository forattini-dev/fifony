import { createFileRoute } from "@tanstack/react-router";
import { useDashboard } from "../context/DashboardContext";
import SettingsView from "../components/SettingsView";
import ProvidersView from "../components/ProvidersView";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const ctx = useDashboard();
  return (
    <div className="space-y-6">
      <SettingsView
        theme={ctx.theme}
        onThemeChange={ctx.setTheme}
        concurrency={ctx.concurrency}
        setConcurrency={ctx.setConcurrency}
        saveConcurrency={ctx.saveConcurrency}
        savePending={ctx.saveConcPending}
        status={ctx.status}
        wsStatus={ctx.wsStatus}
        pwa={ctx.pwa}
        notifications={ctx.notifications}
      />
      <ProvidersView providersUsage={ctx.providersUsage} />
    </div>
  );
}
