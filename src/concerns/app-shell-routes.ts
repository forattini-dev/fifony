export const APP_SHELL_ROUTES = [
  "/onboarding",
  "/kanban",
  "/milestones",
  "/workspace",
  "/issues",
  "/analytics",
  "/agents",
  "/settings",
  "/settings/project",
  "/settings/general",
  "/settings/agents",
  "/settings/notifications",
  "/settings/workflow",
  "/settings/hotkeys",
  "/settings/providers",
] as const;

export type AppShellRoute = (typeof APP_SHELL_ROUTES)[number];
