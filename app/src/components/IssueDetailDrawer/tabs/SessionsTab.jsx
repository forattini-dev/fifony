import React, { useState, useEffect } from "react";
import { Cpu, Clock, Zap, Wrench, Bot, Terminal, ChevronDown, ChevronRight, Loader } from "lucide-react";
import { api } from "../../../api.js";
import { Section } from "../shared.jsx";

function formatDuration(ms) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function getTurnDurationMs(turn) {
  const startedAt = turn?.startedAt ? Date.parse(turn.startedAt) : NaN;
  const completedAt = turn?.completedAt ? Date.parse(turn.completedAt) : NaN;
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) {
    return 0;
  }
  return completedAt - startedAt;
}

function summarizeSessions(sessions) {
  const summary = {
    sessionCount: sessions.length,
    turnCount: 0,
    totalTokens: 0,
    totalDurationMs: 0,
    byStatus: {},
    byProvider: {},
    byRole: {},
  };

  for (const entry of sessions) {
    const provider = entry?.provider || "unknown";
    const role = entry?.role || "unknown";
    const status = entry?.session?.status || "unknown";
    const turns = Array.isArray(entry?.session?.turns) ? entry.session.turns : [];

    summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;
    summary.byProvider[provider] = summary.byProvider[provider] || { sessions: 0, turns: 0, tokens: 0 };
    summary.byRole[role] = summary.byRole[role] || { sessions: 0, turns: 0, tokens: 0 };
    summary.byProvider[provider].sessions += 1;
    summary.byRole[role].sessions += 1;

    for (const turn of turns) {
      const totalTokens = turn?.tokenUsage?.totalTokens || 0;
      summary.turnCount += 1;
      summary.totalTokens += totalTokens;
      summary.totalDurationMs += getTurnDurationMs(turn);
      summary.byProvider[provider].turns += 1;
      summary.byProvider[provider].tokens += totalTokens;
      summary.byRole[role].turns += 1;
      summary.byRole[role].tokens += totalTokens;
    }
  }

  return summary;
}

function MetricCard({ label, value, icon: Icon, tone = "" }) {
  return (
    <div className="rounded-box border border-base-300 bg-base-200/20 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide opacity-45">
        {Icon && <Icon className="size-3" />}
        {label}
      </div>
      <div className={`mt-1 text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function DistributionStrip({ title, entries, formatter }) {
  if (!entries.length) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide opacity-40">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {entries.map(([key, value]) => (
          <span key={key} className="badge badge-sm badge-ghost gap-1.5">
            <span className="font-mono">{key}</span>
            <span className="opacity-60">{formatter(value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function TokenBadge({ usage }) {
  if (!usage?.totalTokens) return null;
  return (
    <span className="badge badge-xs badge-ghost font-mono">
      {usage.totalTokens.toLocaleString()} tok
    </span>
  );
}

function UsageList({ label, icon: Icon, items }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-1 items-center">
      <Icon className="size-3 opacity-40 shrink-0" />
      <span className="text-[10px] uppercase tracking-wide opacity-40">{label}:</span>
      {items.map((item, i) => (
        <span key={i} className="badge badge-xs badge-outline font-mono">{item}</span>
      ))}
    </div>
  );
}

function TurnCard({ turn }) {
  const [expanded, setExpanded] = useState(false);
  const statusColor = turn.success ? "text-success" : "text-error";

  return (
    <div className="border border-base-300 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-base-200/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="size-3 opacity-50" /> : <ChevronRight className="size-3 opacity-50" />}
        <span className={`text-xs font-semibold ${statusColor}`}>
          Turn {turn.turn}
        </span>
        {turn.role && <span className="badge badge-xs badge-primary">{turn.role}</span>}
        {turn.model && <span className="badge badge-xs badge-ghost font-mono">{turn.model}</span>}
        <span className="text-[10px] opacity-40 ml-auto">{turn.directiveStatus}</span>
        <TokenBadge usage={turn.tokenUsage} />
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-base-300 pt-2">
          {turn.directiveSummary && (
            <p className="text-xs opacity-70">{turn.directiveSummary}</p>
          )}

          <UsageList label="Tools" icon={Wrench} items={turn.toolsUsed} />
          <UsageList label="Skills" icon={Zap} items={turn.skillsUsed} />
          <UsageList label="Agents" icon={Bot} items={turn.agentsUsed} />
          <UsageList label="Commands" icon={Terminal} items={turn.commandsRun} />

          {turn.startedAt && (
            <div className="text-[10px] opacity-40">
              {new Date(turn.startedAt).toLocaleTimeString()} → {new Date(turn.completedAt).toLocaleTimeString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionCard({ entry }) {
  const { session, provider, role, cycle } = entry;
  const [expanded, setExpanded] = useState(true);
  const sessionDurationMs = (session.turns || []).reduce((sum, turn) => sum + getTurnDurationMs(turn), 0);

  return (
    <div className="border border-base-300 rounded-box overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left bg-base-200/30 hover:bg-base-200/50"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <Cpu className="size-3.5 text-primary" />
        <span className="text-sm font-semibold">{provider}</span>
        <span className="badge badge-xs badge-secondary">{role}</span>
        {cycle > 1 && <span className="badge badge-xs badge-warning">cycle {cycle}</span>}
        <span className={`badge badge-xs ${session.status === "done" ? "badge-success" : session.status === "failed" ? "badge-error" : "badge-info"}`}>
          {session.status}
        </span>
        {sessionDurationMs > 0 && (
          <span className="text-[10px] opacity-40 flex items-center gap-1">
            <Clock className="size-3" />
            {formatDuration(sessionDurationMs)}
          </span>
        )}
        <span className="text-[10px] opacity-40 ml-auto">{session.turns?.length || 0} turn(s)</span>
      </button>

      {expanded && session.turns?.length > 0 && (
        <div className="p-2 space-y-1.5">
          {session.turns.map((turn, i) => (
            <TurnCard key={i} turn={turn} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SessionsTab({ issueId }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get(`/issues/${encodeURIComponent(issueId)}/sessions`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [issueId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center opacity-50">
        <Loader className="size-4 animate-spin" /> Loading sessions...
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-error text-xs py-2">
        Failed to load sessions: {error}
      </div>
    );
  }

  const sessions = data?.sessions || [];
  const pipeline = data?.pipeline;
  const summary = summarizeSessions(sessions);
  const providerEntries = Object.entries(summary.byProvider)
    .sort((a, b) => b[1].tokens - a[1].tokens || b[1].sessions - a[1].sessions);
  const roleEntries = Object.entries(summary.byRole)
    .sort((a, b) => b[1].tokens - a[1].tokens || b[1].sessions - a[1].sessions);
  const statusEntries = Object.entries(summary.byStatus)
    .sort((a, b) => b[1] - a[1]);

  if (sessions.length === 0) {
    return (
      <div className="text-center py-8 opacity-40 text-sm">
        No execution sessions recorded yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Section title="Summary" icon={Clock}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricCard label="Sessions" icon={Cpu} value={summary.sessionCount} />
            <MetricCard label="Turns" icon={Terminal} value={summary.turnCount} />
            <MetricCard label="Tokens" icon={Zap} value={summary.totalTokens.toLocaleString()} />
            <MetricCard label="Runtime" icon={Clock} value={formatDuration(summary.totalDurationMs)} />
          </div>

          <DistributionStrip
            title="Status"
            entries={statusEntries}
            formatter={(count) => `${count} session${count === 1 ? "" : "s"}`}
          />
          <DistributionStrip
            title="Providers"
            entries={providerEntries}
            formatter={({ sessions: count, tokens }) => `${count}s • ${tokens.toLocaleString()} tok`}
          />
          <DistributionStrip
            title="Roles"
            entries={roleEntries}
            formatter={({ sessions: count, tokens }) => `${count}s • ${tokens.toLocaleString()} tok`}
          />
        </div>
      </Section>

      {pipeline && (
        <Section title="Pipeline" icon={Cpu}>
          <div className="flex items-center gap-2 text-xs">
            <span className="opacity-50">Attempt:</span>
            <span className="font-mono">{pipeline.attempt}</span>
            <span className="opacity-50 ml-2">Cycle:</span>
            <span className="font-mono">{pipeline.cycle}</span>
            {pipeline.history?.length > 0 && (
              <>
                <span className="opacity-50 ml-2">History:</span>
                <span className="font-mono">{pipeline.history.length} entries</span>
              </>
            )}
          </div>
        </Section>
      )}

      <Section title={`Sessions (${sessions.length})`} icon={Cpu}>
        <div className="space-y-2">
          {sessions.map((entry, i) => (
            <SessionCard key={entry.key || i} entry={entry} />
          ))}
        </div>
      </Section>
    </div>
  );
}
