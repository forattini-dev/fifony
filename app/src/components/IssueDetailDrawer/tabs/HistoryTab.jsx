import React, { useState, useEffect, useRef } from "react";
import {
  Lightbulb, XCircle, CheckCircle2, PlayCircle, ListOrdered, Eye,
  AlertTriangle, RotateCcw, Route, ArrowRight, Pause, Circle,
  Info, Activity, GitBranch, UserCircle, Terminal, GitMerge,
} from "lucide-react";
import { api } from "../../../api.js";
import { timeAgo } from "../../../utils.js";

// ── classifyHistoryEntry ──────────────────────────────────────────────────────

export function classifyHistoryEntry(message) {
  const lower = message.toLowerCase();
  if (lower.includes("created")) return { icon: Lightbulb, color: "text-info" };
  if (lower.includes("cancel")) return { icon: XCircle, color: "text-neutral" };
  if (lower.includes("done") || lower.includes("completed") || lower.includes("merged")) return { icon: CheckCircle2, color: "text-success" };
  if (lower.includes("running") || lower.includes("started") || lower.includes("agent")) return { icon: PlayCircle, color: "text-primary" };
  if (lower.includes("queued")) return { icon: ListOrdered, color: "text-info" };
  if (lower.includes("review")) return { icon: Eye, color: "text-secondary" };
  if (lower.includes("blocked") || lower.includes("failed") || lower.includes("error")) return { icon: AlertTriangle, color: "text-error" };
  if (lower.includes("retry") || lower.includes("restart")) return { icon: RotateCcw, color: "text-warning" };
  if (lower.includes("plan")) return { icon: Route, color: "text-info" };
  if (lower.includes("state")) return { icon: ArrowRight, color: "text-primary" };
  if (lower.includes("interrupt") || lower.includes("pause")) return { icon: Pause, color: "text-accent" };
  return { icon: Circle, color: "text-base-content/50" };
}

// ── HistoryTab ────────────────────────────────────────────────────────────────

export function HistoryTab({ issue }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const listRef = useRef(null);

  useEffect(() => {
    let active = true;
    const fetchEvents = async () => {
      try {
        const data = await api.get(`/events/feed?issueId=${encodeURIComponent(issue.id)}`);
        if (active && Array.isArray(data?.events)) {
          setEvents([...data.events].reverse());
        }
      } catch {}
      if (active) setLoading(false);
    };
    fetchEvents();
    const interval = setInterval(fetchEvents, 3000);
    return () => { active = false; clearInterval(interval); };
  }, [issue.id]);

  if (loading && events.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 gap-2 opacity-40">
        <span className="loading loading-spinner loading-xs" />
        <span className="text-sm">Loading events...</span>
      </div>
    );
  }

  if (events.length === 0) {
    return <div className="text-sm opacity-40 text-center py-8">No events for this issue yet.</div>;
  }

  const KIND_STYLES = {
    info: { color: "text-info", icon: Info },
    error: { color: "text-error", icon: AlertTriangle },
    progress: { color: "text-primary", icon: Activity },
    state: { color: "text-secondary", icon: GitBranch },
    manual: { color: "text-warning", icon: UserCircle },
    runner: { color: "text-accent", icon: Terminal },
    merge: { color: "text-success", icon: GitMerge },
  };

  return (
    <div ref={listRef} className="space-y-2 -mx-6 -my-4 px-6 py-4 h-full overflow-y-auto">
      {events.map((ev, i) => {
        const style = KIND_STYLES[ev.kind] || KIND_STYLES.info;
        const EvIcon = style.icon;
        return (
          <div key={`${ev.id || ev.at}-${i}`} className="flex gap-2.5 items-start py-1.5">
            <EvIcon className={`size-3.5 mt-0.5 shrink-0 ${style.color}`} />
            <div className="flex-1 min-w-0">
              <div className="text-xs leading-relaxed">{ev.message}</div>
              <div className="text-[10px] font-mono opacity-30 mt-0.5">
                {ev.at ? timeAgo(ev.at) : ""}
                {ev.kind && <span className="ml-2 opacity-60">{ev.kind}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
