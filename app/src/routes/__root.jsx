import { createRootRoute, Outlet, useRouterState, useNavigate } from "@tanstack/react-router";
import { DashboardProvider, useDashboard } from "../context/DashboardContext";
import { useSettings, getSettingsList, getSettingValue } from "../hooks";
import { lazy, Suspense, useState, useCallback, useEffect, useMemo, useRef } from "react";
import Header from "../components/Header";
import Fab from "../components/Fab";
import MobileDock from "../components/MobileDock";
import CreateIssueDrawer from "../components/CreateIssueForm";
import IssueDetailDrawer from "../components/IssueDetailDrawer";
import PwaBanner from "../components/PwaBanner";
import Confetti from "../components/Confetti";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { CheckCircle, AlertTriangle, Info, Music, RotateCcw, ChevronDown } from "lucide-react";
import OnboardingParticles from "../components/OnboardingParticles";

const KeyboardShortcutsHelp = lazy(() => import("../components/KeyboardShortcutsHelp"));

function ViewTransition({ children }) {
  const routerState = useRouterState();
  const key = routerState.location.pathname;
  return (
    <div key={key} className="flex-1 flex flex-col min-h-0 animate-view-enter">
      {children}
    </div>
  );
}

function RootLayout() {
  const ctx = useDashboard();
  const navigate = useNavigate();
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);

  const closeAllDrawers = useCallback(() => {
    ctx.setIsCreateOpen(false);
    ctx.setSelectedIssue(null);
    setShortcutsHelpOpen(false);
  }, [ctx]);

  const shortcuts = useMemo(() => ({
    n: () => ctx.setIsCreateOpen(true),
    Escape: closeAllDrawers,
    "?": () => setShortcutsHelpOpen((v) => !v),
    k: () => navigate({ to: "/kanban" }),
    i: () => navigate({ to: "/issues" }),
    a: () => navigate({ to: "/agents" }),
    t: () => navigate({ to: "/analytics" }),
    s: () => navigate({ to: "/settings" }),
    1: () => {}, // column nav – wired for future use
    2: () => {},
    3: () => {},
    4: () => {},
    5: () => {},
    6: () => {},
  }), [ctx, navigate, closeAllDrawers]);

  useKeyboardShortcuts(shortcuts);

  // Only show skeleton on very first load (no data yet, not errored)
  if (ctx.runtime.isLoading && !ctx.runtime.data && !ctx.runtime.isError) {
    return <LoadingHero />;
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
        <Confetti x={ctx.confetti.x} y={ctx.confetti.y} count={ctx.confetti.count} active onDone={() => ctx.clearConfetti?.()} />
      )}

      <Header
        issueCount={ctx.issues.length}
        sourceRepo={ctx.data.sourceRepoUrl}
        updatedAt={ctx.data.updatedAt}
        wsStatus={ctx.wsStatus}
        notifications={ctx.notifications}
        issues={ctx.issues}
      />
      <PwaBanner pwa={ctx.pwa} />

      <div className="flex-1 flex flex-col min-h-0">
        <ViewTransition>
          <Outlet />
        </ViewTransition>

        {ctx.runtime.isError && (
          <div className="px-4 pb-4">
            <div className="alert alert-error">{String(ctx.runtime.error?.message || "Runtime unavailable")}</div>
          </div>
        )}
      </div>

      <Fab onClick={() => ctx.setIsCreateOpen(true)} />
      <MobileDock />
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
        mergeMode={ctx.data?.config?.mergeMode ?? "local"}
      />
      {shortcutsHelpOpen && (
        <Suspense fallback={null}>
          <KeyboardShortcutsHelp
            open={shortcutsHelpOpen}
            onClose={() => setShortcutsHelpOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

function LoadingHero() {
  return (
    <div className="fixed inset-0 z-50 bg-base-100 flex flex-col items-center justify-center overflow-hidden">
      <OnboardingParticles />
      <div className="relative z-10 flex flex-col items-center gap-6 animate-fade-in">
        <div className="relative">
          <Music className="size-16 sm:size-20 text-primary animate-bounce-in" />
          <span className="absolute -bottom-1 -right-1 size-5 bg-primary rounded-full animate-ping opacity-50" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          <span className="text-primary">fifony</span>
        </h1>
        <div className="flex items-center gap-3 text-base-content/50">
          <span className="loading loading-dots loading-md" />
          <span className="text-sm">Warming up the orchestra...</span>
        </div>
      </div>
    </div>
  );
}

function OnboardingGate({ children }) {
  const settingsQuery = useSettings();

  const settingsList = getSettingsList(settingsQuery.data);
  const completed = getSettingValue(settingsList, "ui.onboarding.completed", null);

  // Still loading settings (first fetch) — show hero briefly
  if (settingsQuery.isLoading && !settingsQuery.data) {
    return <LoadingHero />;
  }

  // If settings failed to load (backend down), skip the gate — don't block the app
  if (settingsQuery.isError) {
    return children;
  }

  // Onboarding not completed — redirect to /onboarding
  if (completed !== true) {
    return (
      <Suspense fallback={<LoadingHero />}>
        <OnboardingRedirect />
      </Suspense>
    );
  }

  return children;
}

function OnboardingRedirect() {
  const navigate = useNavigate();
  const didRedirect = useRef(false);

  useEffect(() => {
    if (!didRedirect.current) {
      didRedirect.current = true;
      navigate({ to: "/onboarding", replace: true });
    }
  }, [navigate]);

  return <LoadingHero />;
}

function RootComponent() {
  const routerState = useRouterState();
  const isOnboarding = routerState.location.pathname === "/onboarding";

  if (isOnboarding) {
    return <Outlet />;
  }

  return (
    <OnboardingGate>
      <DashboardProvider>
        <RootLayout />
      </DashboardProvider>
    </OnboardingGate>
  );
}

// Parse a stack trace into structured frames for display
function parseStack(stack) {
  if (!stack) return [];
  return stack
    .split("\n")
    .slice(1) // skip the first line (it's the error message repeated)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .map((line) => {
      // "at Component (http://localhost:5173/src/foo.jsx:12:34)"
      // "at http://localhost:5173/src/foo.jsx:12:34"
      const namedMatch = line.match(/^at (.+?) \((.+):(\d+):(\d+)\)$/);
      const anonMatch = line.match(/^at (.+):(\d+):(\d+)$/);
      if (namedMatch) {
        return { fn: namedMatch[1], file: namedMatch[2], line: namedMatch[3], col: namedMatch[4] };
      }
      if (anonMatch) {
        return { fn: null, file: anonMatch[1], line: anonMatch[2], col: anonMatch[3] };
      }
      return { fn: null, file: line, line: null, col: null };
    });
}

function shortenPath(file) {
  if (!file) return file;
  // Strip origin (http://localhost:5173) and keep path
  try {
    const url = new URL(file);
    return url.pathname + (url.searchParams.toString() ? "?" + url.searchParams : "");
  } catch {
    return file;
  }
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={`btn btn-xs btn-ghost gap-1 font-mono ${copied ? "text-success" : "opacity-50 hover:opacity-100"}`}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? "✓ copied" : "copy"}
    </button>
  );
}

function RootErrorComponent({ error, reset }) {
  const [showStack, setShowStack] = useState(true);
  const [showRaw, setShowRaw] = useState(false);

  const name = error?.name || "Error";
  const message = error?.message || String(error) || "An unexpected error occurred.";
  const stack = error?.stack || "";
  const frames = parseStack(stack);
  const route = window.location.pathname;
  const ts = new Date().toLocaleTimeString();
  const userAgent = navigator.userAgent;

  const fullReport = `${name}: ${message}\n\nRoute: ${route}\nTime: ${new Date().toISOString()}\n\n${stack}`;

  // Find the first app frame (not vendor/node_modules)
  const appFrames = frames.filter(
    (f) => f.file && !f.file.includes("node_modules") && !f.file.includes("chunk-") && !f.file.includes("vendor-"),
  );
  const firstAppFrame = appFrames[0] || frames[0];

  return (
    <div className="min-h-screen bg-base-200 flex flex-col">
      {/* Top bar */}
      <div className="bg-error text-error-content px-4 py-2.5 flex items-center gap-3 shrink-0">
        <AlertTriangle className="size-4 shrink-0" />
        <span className="font-mono text-sm font-semibold flex-1 truncate">{name}: {message}</span>
        <span className="text-xs opacity-60 shrink-0">{ts}</span>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-0 min-h-0 overflow-auto">
        {/* Left: main error info */}
        <div className="flex-1 p-6 space-y-5 min-w-0">

          {/* Error card */}
          <div className="bg-base-100 rounded-2xl border border-base-300 overflow-hidden">
            <div className="px-5 py-3 border-b border-base-300 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider opacity-40">Error</span>
              <CopyBtn text={fullReport} />
            </div>
            <div className="p-5 space-y-3">
              <div className="flex items-start gap-3">
                <span className="badge badge-error badge-sm mt-0.5 shrink-0 font-mono">{name}</span>
                <p className="font-mono text-sm text-error leading-relaxed break-all">{message}</p>
              </div>

              {firstAppFrame && (
                <div className="flex items-center gap-2 text-xs text-base-content/50">
                  <span className="opacity-40">at</span>
                  <span className="font-mono font-semibold text-base-content/70">{firstAppFrame.fn || "<anonymous>"}</span>
                  <span className="opacity-30">—</span>
                  <span className="font-mono">{shortenPath(firstAppFrame.file)}</span>
                  {firstAppFrame.line && (
                    <span className="badge badge-xs badge-ghost font-mono">:{firstAppFrame.line}:{firstAppFrame.col}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Context */}
          <div className="bg-base-100 rounded-2xl border border-base-300 overflow-hidden">
            <div className="px-5 py-3 border-b border-base-300">
              <span className="text-xs font-semibold uppercase tracking-wider opacity-40">Context</span>
            </div>
            <div className="divide-y divide-base-200">
              {[
                { label: "Route", value: route },
                { label: "Time", value: new Date().toISOString() },
                { label: "User Agent", value: userAgent },
              ].map(({ label, value }) => (
                <div key={label} className="px-5 py-2.5 flex items-start gap-4">
                  <span className="text-xs font-semibold opacity-40 w-24 shrink-0 pt-0.5">{label}</span>
                  <span className="font-mono text-xs break-all text-base-content/70">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Stack trace */}
          {frames.length > 0 && (
            <div className="bg-base-100 rounded-2xl border border-base-300 overflow-hidden">
              <div className="px-5 py-3 border-b border-base-300 flex items-center justify-between gap-3">
                <button
                  className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider opacity-40 hover:opacity-70 transition-opacity"
                  onClick={() => setShowStack((v) => !v)}
                >
                  <ChevronDown className={`size-3.5 transition-transform ${showStack ? "rotate-180" : ""}`} />
                  Stack trace
                  <span className="badge badge-xs badge-ghost normal-case tracking-normal font-mono">{frames.length} frames</span>
                </button>
                <div className="flex items-center gap-1">
                  <button
                    className={`btn btn-xs btn-ghost opacity-50 hover:opacity-100 ${showRaw ? "btn-active" : ""}`}
                    onClick={() => setShowRaw((v) => !v)}
                  >
                    raw
                  </button>
                  <CopyBtn text={stack} />
                </div>
              </div>

              {showStack && (
                showRaw ? (
                  <pre className="px-5 py-4 text-[11px] font-mono leading-relaxed text-base-content/60 overflow-x-auto whitespace-pre-wrap">
                    {stack}
                  </pre>
                ) : (
                  <div className="divide-y divide-base-200">
                    {frames.map((frame, i) => {
                      const isApp = frame.file && !frame.file.includes("node_modules") && !frame.file.includes("chunk-") && !frame.file.includes("vendor-");
                      const shortFile = shortenPath(frame.file);
                      return (
                        <div
                          key={i}
                          className={`px-5 py-2 flex items-start gap-3 ${isApp ? "bg-warning/5" : "opacity-40"}`}
                        >
                          <span className="font-mono text-[10px] opacity-30 w-5 shrink-0 text-right pt-0.5">{i}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              {frame.fn && (
                                <span className={`font-mono text-xs font-semibold ${isApp ? "text-warning" : "text-base-content/60"}`}>
                                  {frame.fn}
                                </span>
                              )}
                              {isApp && <span className="badge badge-xs badge-warning badge-soft">app</span>}
                            </div>
                            <div className="font-mono text-[10px] text-base-content/40 truncate">
                              {shortFile}
                              {frame.line && <span className="text-base-content/60 ml-0.5">:{frame.line}:{frame.col}</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>
          )}
        </div>

        {/* Right: actions sidebar */}
        <div className="lg:w-64 p-6 space-y-4 shrink-0">
          <div className="space-y-2">
            <button
              className="btn btn-primary w-full gap-2"
              onClick={() => window.location.reload()}
            >
              <RotateCcw className="size-4" /> Reload page
            </button>
            {reset && (
              <button
                className="btn btn-ghost w-full gap-2"
                onClick={reset}
              >
                Try to recover
              </button>
            )}
            <button
              className="btn btn-ghost w-full gap-2"
              onClick={() => { window.location.href = "/"; }}
            >
              Go home
            </button>
          </div>

          <div className="divider text-xs opacity-30">about</div>

          <div className="space-y-1 text-xs text-base-content/40">
            <p>This error was caught by the app's error boundary. The details above will help you identify the root cause.</p>
            <p className="mt-2">App frames are <span className="text-warning font-semibold">highlighted</span>.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: RootErrorComponent,
});
