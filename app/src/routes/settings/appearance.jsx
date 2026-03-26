import { createFileRoute } from "@tanstack/react-router";
import { useDashboard } from "../../context/DashboardContext";
import { ThemeSection } from "../../components/SettingsView";

export const Route = createFileRoute("/settings/appearance")({
  component: AppearanceSettings,
});

function AppearanceSettings() {
  const ctx = useDashboard();
  return <ThemeSection theme={ctx.theme} onThemeChange={ctx.setTheme} />;
}
