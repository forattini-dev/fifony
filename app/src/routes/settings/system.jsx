import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useCallback, useEffect } from "react";
import { useHotkeysContext } from "react-hotkeys-hook";
import { useDashboard } from "../../context/DashboardContext";
import { ConnectionSection, PwaSection, SetupWizardSection } from "../../components/SettingsView";
import { Keyboard, Command, Globe, PanelRight, Columns3, List, FlaskConical, Trash2, Loader2 } from "lucide-react";
import { api } from "../../api.js";
import { useRuntimeDoctor, useRuntimeProbe, useRuntimeStatus } from "../../hooks.js";

export const Route = createFileRoute("/settings/system")({
  component: SystemSettings,
});

// ── Hotkeys reference (inline) ────────────────────────────────────────────────

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const GROUP_ORDER = ["palette", "navigation", "global", "drawer", "kanban", "issues"];
const GROUP_CONFIG = {
  palette:    { label: "Command Palette", icon: Command,    color: "text-primary",   badge: "badge-primary" },
  navigation: { label: "Navigation",      icon: Globe,      color: "text-info",      badge: "badge-info" },
  global:     { label: "Global",          icon: Keyboard,   color: "text-secondary", badge: "badge-secondary" },
  drawer:     { label: "Issue Detail",    icon: PanelRight, color: "text-success",   badge: "badge-success" },
  kanban:     { label: "Kanban Board",    icon: Columns3,   color: "text-warning",   badge: "badge-warning" },
  issues:     { label: "Issues List",     icon: List,       color: "text-error",     badge: "badge-error" },
};

function formatHotkey(hotkey) {
  return (hotkey || "")
    .replace(/mod/gi, isMac ? "\u2318" : "Ctrl")
    .replace(/ctrl/gi, "Ctrl")
    .replace(/alt/gi, "Alt")
    .replace(/shift/gi, "Shift")
    .replace(/enter/gi, "\u21B5 Enter")
    .replace(/escape/gi, "Esc")
    .replace(/slash/gi, "/")
    .split("+");
}

function HotkeysReference() {
  const { hotkeys } = useHotkeysContext();

  const groups = useMemo(() => {
    const map = new Map();
    const seen = new Set();
    for (const hk of hotkeys) {
      const desc = hk.description;
      const group = hk.metadata?.group;
      if (!desc || !group) continue;
      const dedup = `${group}:${desc}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      if (!map.has(group)) map.set(group, []);
      map.get(group).push(hk);
    }
    const result = [];
    for (const g of GROUP_ORDER) {
      if (map.has(g)) result.push({ group: g, ...GROUP_CONFIG[g], shortcuts: map.get(g) });
    }
    return result;
  }, [hotkeys]);

  const totalCount = groups.reduce((sum, g) => sum + g.shortcuts.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Keyboard className="size-4 opacity-50" />
            Keyboard Shortcuts
          </h3>
          <p className="text-xs opacity-50 mt-0.5">
            {totalCount} shortcuts across {groups.length} contexts.
            Press <kbd className="kbd kbd-xs">Shift</kbd>+<kbd className="kbd kbd-xs">/</kbd> anywhere to see them.
            <span className="ml-2 badge badge-ghost badge-xs font-mono">{isMac ? "macOS" : "Linux / Windows"}</span>
          </p>
        </div>
      </div>

      {groups.map(({ group, label, icon: Icon, color, badge, shortcuts }) => (
        <div key={group} className="bg-base-300 rounded-box overflow-hidden">
          <div className="px-4 py-2.5 flex items-center gap-2 border-b border-base-content/10">
            <Icon className={`size-3.5 ${color}`} />
            <span className="text-xs font-semibold">{label}</span>
            <span className={`badge badge-xs ${badge}`}>{shortcuts.length}</span>
          </div>
          <div className="divide-y divide-base-content/5">
            {shortcuts.map((s, i) => {
              const keys = formatHotkey(s.hotkey);
              return (
                <div key={i} className="flex items-center justify-between px-4 py-2 hover:bg-base-100/30 transition-colors">
                  <span className="text-xs">{s.description}</span>
                  <div className="flex items-center gap-1">
                    {keys.map((k, j) => (
                      <span key={j} className="flex items-center">
                        {j > 0 && <span className="text-xs opacity-20 mx-0.5">+</span>}
                        <kbd className="kbd kbd-xs font-mono">{k.trim()}</kbd>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <p className="text-xs opacity-40">
        Shortcuts are context-aware. <strong>Drawer</strong> shortcuts only work when an issue detail is open.
        <strong> Kanban</strong> and <strong>Issues</strong> shortcuts work on their respective pages.
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function SystemSettings() {
  const ctx = useDashboard();

  return (
    <div className="space-y-5">
      <ConnectionSection status={ctx.status} wsStatus={ctx.wsStatus} />
      <PwaSection pwa={ctx.pwa} />
      <SetupWizardSection />

      <div className="card bg-base-200">
        <div className="card-body p-4 gap-4">
          <HotkeysReference />
        </div>
      </div>
    </div>
  );
}
