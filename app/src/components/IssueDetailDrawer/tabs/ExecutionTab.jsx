import React, { useState, useEffect, useCallback } from "react";
import { AlertTriangle, Terminal, SlidersHorizontal, Zap } from "lucide-react";
import { api } from "../../../api.js";
import { formatDate, formatDuration } from "../../../utils.js";
import { Section, Field, CopyButton, ConfigStrip, TokenPhaseBreakdown } from "../shared.jsx";

// ── LiveMonitor ───────────────────────────────────────────────────────────────

function LiveMonitor({ issueId, running, startedAt }) {
  const [live, setLive] = useState(null);

  const fetchLive = useCallback(async () => {
    try {
      const res = await api.get(`/live/${encodeURIComponent(issueId)}`);
      setLive(res);
    } catch { /* ignore */ }
  }, [issueId]);

  useEffect(() => {
    if (!running) { setLive(null); return; }
    fetchLive();
    const interval = setInterval(fetchLive, 3000);
    return () => clearInterval(interval);
  }, [running, fetchLive]);

  if (!running || !live) return null;

  const elapsed = Number.isFinite(Number(live.elapsed))
    ? Number(live.elapsed)
    : startedAt
      ? Math.max(Date.now() - new Date(startedAt).getTime(), 0)
      : 0;
  const mins = Math.floor(elapsed / 60000);
  const secs = Math.floor((elapsed % 60000) / 1000);
  const logKb = live.logSize ? (live.logSize / 1024).toFixed(1) : "0";

  return (
    <div className="rounded-box border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="loading loading-spinner loading-xs text-primary" />
        <span className="text-sm font-semibold text-primary">Agent running</span>
        <span className="text-xs opacity-50 ml-auto">{mins}m {secs}s elapsed</span>
      </div>
      <div className="flex gap-3 text-xs opacity-60">
        <span>Log: {logKb} KB</span>
        {live.agentPid && <span>PID: {live.agentPid}</span>}
        {live.agentAlive === false && live.agentPid && <span className="text-error">process dead</span>}
      </div>
      {live.logTail && (
        <pre className="text-xs bg-base-200 rounded-box p-2 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto font-mono opacity-80">
          {live.logTail}
        </pre>
      )}
    </div>
  );
}

// ── ExecutionTab ──────────────────────────────────────────────────────────────

export function ExecutionTab({ issue, workflowConfig }) {
  const isRunning = issue.state === "Running" || issue.state === "Reviewing";
  const executeConfig = workflowConfig?.workflow?.execute;

  return (
    <div className="space-y-5">
      {/* Live monitor */}
      <LiveMonitor issueId={issue.id} running={isRunning} startedAt={issue.startedAt} />

      {executeConfig && (
        <Section title="Execution Config" icon={SlidersHorizontal}>
          <ConfigStrip config={executeConfig} />
        </Section>
      )}

      <Section title="Run Info" icon={Terminal}>
        <div className="space-y-0.5">
          <Field label="Exit code" value={issue.commandExitCode ?? "-"} mono />
          <Field label="Duration" value={formatDuration(issue.durationMs)} />
          {issue.workspacePath && <Field label="Workspace meta" value={issue.workspacePath} mono />}
          {issue.worktreePath && <Field label="Code worktree" value={issue.worktreePath} mono />}
          {issue.workspacePreparedAt && <Field label="Workspace ready" value={formatDate(issue.workspacePreparedAt)} />}
        </div>
      </Section>

      {issue.lastError && (
        <Section title="Last Error" icon={AlertTriangle}>
          <pre className="text-xs bg-error/10 rounded-box p-3 overflow-x-auto whitespace-pre-wrap max-h-72 overflow-y-auto">
            {issue.lastError}
          </pre>
        </Section>
      )}

      {issue.commandOutputTail && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-sm flex items-center gap-1.5">
              <Terminal className="size-4 opacity-50" /> Command Output
            </div>
            <CopyButton text={issue.commandOutputTail} />
          </div>
          <pre className="text-xs bg-base-200 rounded-box p-3 overflow-x-auto whitespace-pre-wrap max-h-[50vh] overflow-y-auto">
            {issue.commandOutputTail}
          </pre>
        </div>
      )}

      {(issue.tokensByPhase || issue.tokensByModel) && (
        <Section title="Token Usage" icon={Zap}>
          <TokenPhaseBreakdown tokensByPhase={issue.tokensByPhase} tokensByModel={issue.tokensByModel} />
        </Section>
      )}

      {!issue.lastError && !issue.commandOutputTail && !issue.tokensByPhase && !issue.tokensByModel && (
        <div className="text-sm opacity-40 text-center py-8">No execution data yet.</div>
      )}
    </div>
  );
}
