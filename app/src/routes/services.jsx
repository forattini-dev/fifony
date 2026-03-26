import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  Server, Play, Square, Terminal, Circle, Loader2, ChevronUp,
} from "lucide-react";
import { api } from "../api.js";
import { useServices, useServiceLog } from "../hooks/useServices.js";
import { formatDuration } from "../utils.js";

export const Route = createFileRoute("/services")({
  component: ServicesPage,
});

// ── Uptime counter ─────────────────────────────────────────────────────────────

function UptimeCounter({ startedAt, running }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running || !startedAt) { setElapsed(0); return; }
    const tick = () => setElapsed(Date.now() - Date.parse(startedAt));
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [running, startedAt]);
  if (!running || !startedAt) return null;
  return <span className="tabular-nums text-xs opacity-50">{formatDuration(elapsed)}</span>;
}

// ── ANSI → HTML ────────────────────────────────────────────────────────────────

const ANSI_FG = ["#3d3d3d","#c0392b","#27ae60","#d4a017","#2980b9","#8e44ad","#16a085","#bdc3c7"];
const ANSI_FG_BRIGHT = ["#666","#e74c3c","#2ecc71","#f1c40f","#3498db","#9b59b6","#1abc9c","#ecf0f1"];
const ANSI_BG = ["#1a1a1a","#6b0000","#004d1a","#4d3800","#00234d","#3a0066","#004d40","#4a4a4a"];
const ANSI_BG_BRIGHT = ["#333","#c0392b","#27ae60","#b8860b","#1a5276","#6c3483","#0e6655","#7f8c8d"];

function ansiToHtml(text) {
  const ESC = /\x1b\[([0-9;]*)m/g;
  let fg = null, bg = null, bold = false, dim = false, italic = false;
  let out = "";
  let last = 0;

  const escapeHtml = (s) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  const flush = (raw) => {
    if (!raw) return;
    const safe = escapeHtml(raw);
    const styles = [];
    if (fg) styles.push(`color:${fg}`);
    if (bg) styles.push(`background:${bg}`);
    if (bold) styles.push("font-weight:700");
    if (dim) styles.push("opacity:0.5");
    if (italic) styles.push("font-style:italic");
    out += styles.length ? `<span style="${styles.join(";")}">${safe}</span>` : safe;
  };

  for (const m of text.matchAll(ESC)) {
    flush(text.slice(last, m.index));
    last = m.index + m[0].length;
    const codes = m[1] === "" ? [0] : m[1].split(";").map(Number);
    let i = 0;
    while (i < codes.length) {
      const c = codes[i++];
      if (c === 0) { fg = bg = null; bold = dim = italic = false; }
      else if (c === 1) bold = true;
      else if (c === 2) dim = true;
      else if (c === 3) italic = true;
      else if (c === 22) { bold = false; dim = false; }
      else if (c === 23) italic = false;
      else if (c >= 30 && c <= 37) fg = ANSI_FG[c - 30];
      else if (c === 38) {
        if (codes[i] === 5 && i + 1 < codes.length) { /* 256-color: skip */ i += 2; }
        else if (codes[i] === 2 && i + 3 < codes.length) { fg = `rgb(${codes[i+1]},${codes[i+2]},${codes[i+3]})`; i += 4; }
      }
      else if (c === 39) fg = null;
      else if (c >= 40 && c <= 47) bg = ANSI_BG[c - 40];
      else if (c === 49) bg = null;
      else if (c >= 90 && c <= 97) fg = ANSI_FG_BRIGHT[c - 90];
      else if (c >= 100 && c <= 107) bg = ANSI_BG_BRIGHT[c - 100];
    }
  }
  flush(text.slice(last));
  return out;
}

// ── Log viewer ─────────────────────────────────────────────────────────────────

function LogViewer({ id, running }) {
  const { log, connected } = useServiceLog(id, true);
  const logRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const html = useMemo(() => (log ? ansiToHtml(log) : ""), [log]);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [html, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!logRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logRef.current;
    setAutoScroll(scrollTop + clientHeight >= scrollHeight - 40);
  }, []);

  return (
    <div className="flex flex-col rounded-xl border border-base-300 overflow-hidden mt-3">
      <div className="flex items-center justify-between px-4 py-2 bg-base-200/60 border-b border-base-300 shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="size-3.5 opacity-40" />
          <span className="text-xs font-medium opacity-60">Output</span>
        </div>
        <div className="flex items-center gap-2">
          {connected
            ? <span className="flex items-center gap-1.5 text-xs text-success"><Circle className="size-2 fill-success" />live</span>
            : running
              ? <span className="flex items-center gap-1.5 text-xs opacity-40"><Loader2 className="size-2.5 animate-spin" />connecting</span>
              : <span className="text-xs opacity-30">idle</span>
          }
          {!autoScroll && (
            <button className="btn btn-xs btn-ghost opacity-50 hover:opacity-100" onClick={() => { setAutoScroll(true); logRef.current?.scrollTo(0, logRef.current.scrollHeight); }}>
              ↓ end
            </button>
          )}
        </div>
      </div>
      <pre
        ref={logRef}
        onScroll={handleScroll}
        className="overflow-y-auto p-4 text-xs font-mono whitespace-pre-wrap break-all leading-relaxed bg-base-100"
        style={{ minHeight: "12rem", maxHeight: "28rem" }}
        dangerouslySetInnerHTML={{ __html: html || '<span style="opacity:0.3">No output yet. Start the service to see logs here.</span>' }}
      />
    </div>
  );
}

// ── Service card ───────────────────────────────────────────────────────────────

function ServiceCard({ service, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const handleStart = useCallback(async () => {
    setBusy(true);
    try { await api.post(`/services/${service.id}/start`, {}); await onRefresh(); }
    finally { setBusy(false); }
  }, [service.id, onRefresh]);

  const handleStop = useCallback(async () => {
    setBusy(true);
    try { await api.post(`/services/${service.id}/stop`, {}); await onRefresh(); }
    finally { setBusy(false); }
  }, [service.id, onRefresh]);

  const state = service.state ?? (service.running ? "running" : "stopped");
  const dotColor = {
    running:  "text-success fill-success",
    starting: "text-warning fill-warning",
    stopping: "text-warning fill-warning",
    crashed:  "text-error fill-error",
    stopped:  "text-base-content/20 fill-base-content/20",
  }[state] ?? "text-base-content/20 fill-base-content/20";

  const stateLabel = {
    running:  <span className="text-success font-medium">Running</span>,
    starting: <span className="text-warning font-medium flex items-center gap-1"><Loader2 className="size-3 animate-spin" />Starting</span>,
    stopping: <span className="text-warning opacity-70 flex items-center gap-1"><Loader2 className="size-3 animate-spin" />Stopping</span>,
    crashed:  <span className="text-error font-medium">Crashed</span>,
    stopped:  <span className="opacity-30">Stopped</span>,
  }[state] ?? <span className="opacity-30">Stopped</span>;

  const canStart = state === "stopped" || state === "crashed";
  const canStop  = state === "running" || state === "starting";

  return (
    <div className="card bg-base-200">
      <div className="card-body p-4 gap-0">
        <div className="flex items-center gap-3">
          <Circle className={`size-2.5 shrink-0 ${dotColor}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-semibold text-sm">{service.name}</span>
              {service.cwd && <span className="text-xs opacity-30 font-mono">{service.cwd}</span>}
            </div>
            <div className="font-mono text-xs opacity-40 truncate mt-0.5">{service.command}</div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <div className="flex items-center gap-2 text-xs mr-1">
              {stateLabel}
              {service.pid && <span className="opacity-30 tabular-nums">PID {service.pid}</span>}
              <UptimeCounter startedAt={service.startedAt} running={service.running} />
              {state === "crashed" && service.crashCount > 0 && (
                <span className="text-error/60 tabular-nums">{service.crashCount}×</span>
              )}
            </div>
            {canStop ? (
              <button className="btn btn-sm btn-ghost text-error hover:bg-error/10" onClick={handleStop} disabled={busy} title="Stop">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" />}
              </button>
            ) : (
              <button className="btn btn-sm btn-ghost text-success hover:bg-success/10" onClick={handleStart} disabled={busy || state === "stopping"} title="Start">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              </button>
            )}
            <button
              className={`btn btn-sm btn-ghost ${logOpen ? "opacity-100" : "opacity-40 hover:opacity-100"}`}
              onClick={() => setLogOpen(v => !v)}
              title="Toggle log"
            >
              {logOpen ? <ChevronUp className="size-4" /> : <Terminal className="size-4" />}
            </button>
          </div>
        </div>

        {logOpen && <LogViewer id={service.id} running={service.running} />}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

function ServicesPage() {
  const { services, loading, refresh } = useServices();

  const handleStartAll = useCallback(async () => {
    await Promise.all(services.filter((service) => !service.running).map((service) => api.post(`/services/${service.id}/start`, {})));
    await refresh();
  }, [services, refresh]);

  const handleStopAll = useCallback(async () => {
    await Promise.all(services.filter((service) => service.running).map((service) => api.post(`/services/${service.id}/stop`, {})));
    await refresh();
  }, [services, refresh]);

  const anyRunning = services.some((service) => service.running);
  const allRunning = services.length > 0 && services.every((service) => service.running);

  return (
    <div className="flex-1 flex flex-col min-h-0 px-4 pb-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          <Server className="size-4 opacity-50" />
          <h1 className="text-sm font-semibold opacity-70 uppercase tracking-widest">Services</h1>
        </div>
        <div className="flex items-center gap-1.5">
          {services.length > 0 && !allRunning && (
            <button className="btn btn-xs btn-ghost opacity-60 hover:opacity-100" onClick={handleStartAll}>
              Start all
            </button>
          )}
          {anyRunning && (
            <button className="btn btn-xs btn-ghost text-error opacity-60 hover:opacity-100" onClick={handleStopAll}>
              Stop all
            </button>
          )}
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="flex flex-col gap-3">
          {[0, 1].map(i => (
            <div key={i} className="card bg-base-200 animate-pulse">
              <div className="card-body p-4 gap-0">
                <div className="flex items-center gap-3">
                  <div className="size-2.5 rounded-full bg-base-300 shrink-0" />
                  <div className="flex-1 flex flex-col gap-1.5">
                    <div className="h-3.5 w-32 rounded bg-base-300" />
                    <div className="h-2.5 w-48 rounded bg-base-300" />
                  </div>
                  <div className="flex gap-1.5">
                    <div className="h-8 w-8 rounded-btn bg-base-300" />
                    <div className="h-8 w-8 rounded-btn bg-base-300" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && services.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Server className="size-10 opacity-10" />
          <div className="text-center">
            <p className="text-sm font-medium opacity-70">No services configured</p>
            <p className="text-xs opacity-40 mt-1">Add services in Settings → Services to launch and monitor them here.</p>
          </div>
        </div>
      )}

      {/* Service list */}
      {services.length > 0 && (
        <div className="flex flex-col gap-3">
          {services.map((service) => (
            <ServiceCard
              key={service.id}
              service={service}
              onRefresh={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}
