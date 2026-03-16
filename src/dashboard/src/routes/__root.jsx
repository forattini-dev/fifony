import { createRootRoute, Outlet } from "@tanstack/react-router";
import { DashboardProvider, useDashboard } from "../context/DashboardContext";
import Header from "../components/Header";
import Fab from "../components/Fab";
import MobileDock from "../components/MobileDock";
import EventsDrawer from "../components/EventsDrawer";
import CreateIssueDrawer from "../components/CreateIssueForm";
import IssueDetailDrawer from "../components/IssueDetailDrawer";
import PwaBanner from "../components/PwaBanner";
import Confetti from "../components/Confetti";
import { CheckCircle, AlertTriangle, Info } from "lucide-react";

function RootLayout() {
  const ctx = useDashboard();

  if (ctx.runtime.isLoading && !ctx.runtime.data) {
    return (
      <div className="min-h-screen flex flex-col">
        <div className="navbar bg-base-100 shadow-sm px-4">
          <div className="flex-1"><div className="skeleton-line h-6 w-32" /></div>
          <div className="flex gap-2">
            <div className="skeleton-line h-8 w-20 rounded-btn" />
            <div className="skeleton-line h-8 w-20 rounded-btn" />
            <div className="skeleton-line h-8 w-20 rounded-btn" />
          </div>
        </div>
        <div className="container mx-auto px-4 py-6 space-y-4">
          <div className="skeleton-card h-24 w-full" />
          <div className="grid grid-cols-6 gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="skeleton-card h-64 w-full" style={{ animationDelay: `${i * 100}ms` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const toastType = ctx.toast?.type || "info";
  const toastMessage = typeof ctx.toast === "string" ? ctx.toast : ctx.toast?.message;

  return (
    <div className="min-h-screen flex flex-col">
      {ctx.toast && (
        <div className="toast toast-end toast-top z-50">
          <div className={`alert text-sm shadow-lg ${toastType === "success" ? "alert-success" : toastType === "error" ? "alert-error" : "alert-info"} ${ctx.toastExiting ? "animate-toast-out" : "animate-toast-in"}`}>
            {toastType === "success" ? <CheckCircle className="size-4" /> : toastType === "error" ? <AlertTriangle className="size-4" /> : <Info className="size-4" />}
            <span>{toastMessage}</span>
            <div className="toast-progress" />
          </div>
        </div>
      )}
      {ctx.confetti && (
        <Confetti x={ctx.confetti.x} y={ctx.confetti.y} active onDone={() => ctx.clearConfetti?.()} />
      )}

      <Header
        issueCount={ctx.issues.length}
        sourceRepo={ctx.data.sourceRepoUrl}
        updatedAt={ctx.data.updatedAt}
        onToggleEvents={ctx.toggleEvents}
        eventsOpen={ctx.isEventsOpen}
        wsStatus={ctx.wsStatus}
      />
      <PwaBanner pwa={ctx.pwa} />

      <div className="container mx-auto px-4 pb-8 flex-1 flex flex-col gap-4">
        <div className="flex-1 flex flex-col min-h-0">
          <Outlet />
        </div>

        {ctx.runtime.isError && (
          <div className="alert alert-error">{String(ctx.runtime.error?.message || "Runtime unavailable")}</div>
        )}
      </div>

      <Fab onClick={() => ctx.setIsCreateOpen(true)} />
      <MobileDock onToggleEvents={ctx.toggleEvents} eventsOpen={ctx.isEventsOpen} />
      <EventsDrawer
        open={ctx.isEventsOpen}
        onClose={() => ctx.setIsEventsOpen(false)}
        events={ctx.eventsData}
        kind={ctx.eventKind}
        setKind={ctx.setEventKind}
        issueId={ctx.eventIssueId}
        setIssueId={ctx.setEventIssueId}
        issueOptions={ctx.issueOptions}
      />
      <CreateIssueDrawer
        open={ctx.isCreateOpen}
        onClose={() => ctx.setIsCreateOpen(false)}
        onSubmit={(p) => ctx.createIssue.mutate(p)}
        isLoading={ctx.createIssue.isPending}
        onToast={ctx.showToast}
      />
      <IssueDetailDrawer
        issue={ctx.selectedIssue}
        onClose={() => ctx.setSelectedIssue(null)}
        onStateChange={ctx.updateState}
        onRetry={ctx.retryIssue}
        onCancel={ctx.cancelIssue}
      />
    </div>
  );
}

export const Route = createRootRoute({
  component: () => (
    <DashboardProvider>
      <RootLayout />
    </DashboardProvider>
  ),
});
