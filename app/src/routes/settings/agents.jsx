import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api.js";
import { SETTINGS_QUERY_KEY, upsertSettingPayload } from "../../hooks.js";
import { Sparkles, MessageSquare, Lightbulb, Play, Eye, Activity, RotateCcw, Loader2, Check } from "lucide-react";

const STAGES = [
  { key: "enhance",  label: "Enhance",  icon: Sparkles,      description: "Improve issue title and description",   accent: "warning" },
  { key: "chat",     label: "Chat",     icon: MessageSquare, description: "Conversational AI for issue discussion", accent: "info" },
  { key: "plan",     label: "Plan",     icon: Lightbulb,     description: "Generate the execution plan",            accent: "info" },
  { key: "execute",  label: "Execute",  icon: Play,          description: "Implement the changes",                  accent: "primary" },
  { key: "review",   label: "Review",   icon: Eye,           description: "Review the implementation",              accent: "secondary" },
  { key: "services", label: "Services", icon: Activity,      description: "AI-powered service log analysis",        accent: "success" },
];

const EFFORTS = [
  { value: "low",        label: "Low",        hint: "Faster, cheaper — best for simple tasks" },
  { value: "medium",     label: "Medium",     hint: "Balanced — good default for most work" },
  { value: "high",       label: "High",       hint: "Deep reasoning — for complex or risky changes" },
  { value: "extra-high", label: "Extra High", hint: "Maximum budget — slowest, most expensive" },
];

const ACCENT_MAP = {
  info:      { border: "border-info/30",      bg: "bg-info/10",      text: "text-info",      badge: "badge-info" },
  primary:   { border: "border-primary/30",   bg: "bg-primary/10",   text: "text-primary",   badge: "badge-primary" },
  secondary: { border: "border-secondary/30", bg: "bg-secondary/10", text: "text-secondary", badge: "badge-secondary" },
  warning:   { border: "border-warning/30",   bg: "bg-warning/10",   text: "text-warning",   badge: "badge-warning" },
  success:   { border: "border-success/30",   bg: "bg-success/10",   text: "text-success",   badge: "badge-success" },
};

function StageBlock({ stage, config, providers, modelsByProvider, onChange, saving }) {
  const Icon = stage.icon;
  const models = modelsByProvider[config.provider] || [];
  const availableProviders = (providers || []).filter((p) => p.available);
  const colors = ACCENT_MAP[stage.accent];
  const selectedEffort = EFFORTS.find((e) => e.value === config.effort);

  return (
    <div className={`card bg-base-200 border-l-4 ${colors.border} animate-fade-in`}>
      <div className="card-body p-4 gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex items-center justify-center size-9 rounded-lg ${colors.bg}`}>
            <Icon className={`size-4.5 ${colors.text}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm">{stage.label}</h3>
              <span className={`badge badge-xs ${colors.badge} badge-outline`}>{config.provider}</span>
              {saving && (
                <span className="text-xs text-success flex items-center gap-1 animate-fade-in">
                  <Check className="size-3" /> saved
                </span>
              )}
            </div>
            <p className="text-xs opacity-50">{stage.description}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="form-control">
            <div className="label py-0.5">
              <span className="label-text text-xs opacity-60">Provider</span>
            </div>
            <select
              className="select select-bordered select-sm w-full"
              value={config.provider}
              onChange={(e) => {
                const newProvider = e.target.value;
                const newModels = modelsByProvider[newProvider] || [];
                const newEffort = newProvider !== "codex" && config.effort === "extra-high" ? "high" : config.effort;
                onChange({ ...config, provider: newProvider, model: newModels[0]?.id || "", effort: newEffort });
              }}
            >
              {availableProviders.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </label>

          <label className="form-control">
            <div className="label py-0.5">
              <span className="label-text text-xs opacity-60">Model</span>
            </div>
            <select
              className="select select-bordered select-sm w-full"
              value={config.model}
              onChange={(e) => onChange({ ...config, model: e.target.value })}
            >
              {models.length === 0 && (
                <option value={config.model}>{config.model || "(detecting...)"}</option>
              )}
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}{m.tier ? ` — ${m.tier}` : ""}</option>
              ))}
            </select>
          </label>

          <label className="form-control">
            <div className="label py-0.5">
              <span className="label-text text-xs opacity-60">Thinking depth</span>
            </div>
            <select
              className="select select-bordered select-sm w-full"
              value={config.effort}
              onChange={(e) => onChange({ ...config, effort: e.target.value })}
            >
              {EFFORTS.filter((e) => config.provider !== "gemini" || e.value !== "extra-high").map((e) => (
                <option key={e.value} value={e.value}>{e.label}</option>
              ))}
            </select>
            {selectedEffort && (
              <p className="text-[11px] opacity-40 mt-1 leading-snug">{selectedEffort.hint}</p>
            )}
          </label>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/agents")({
  component: PipelineSettings,
});

function PipelineSettings() {
  const qc = useQueryClient();
  const [workflow, setWorkflow] = useState(null);
  const [providers, setProviders] = useState([]);
  const [modelsByProvider, setModelsByProvider] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingStage, setSavingStage] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const saveTimer = useRef(null);

  const syncCache = useCallback((nextWorkflow) => {
    qc.setQueryData(SETTINGS_QUERY_KEY, (current) => upsertSettingPayload(current, {
      id: "runtime.workflowConfig",
      scope: "runtime",
      value: nextWorkflow,
      source: "user",
      updatedAt: new Date().toISOString(),
    }));
    qc.setQueryData(["workflow-config"], { ok: true, workflow: nextWorkflow, isDefault: false });
  }, [qc]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/config/workflow?details=1");
      setWorkflow(res.workflow);
      setProviders(res.providers || []);
      setModelsByProvider(res.models || {});
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const autoSave = useCallback((newWorkflow, changedStage) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.post("/config/workflow", { workflow: newWorkflow });
        syncCache(newWorkflow);
        setSavingStage(changedStage);
        setTimeout(() => setSavingStage(null), 1500);
      } catch {}
    }, 600);
  }, [syncCache]);

  const handleStageChange = useCallback((stageKey, newConfig) => {
    setWorkflow((prev) => {
      const next = { ...prev, [stageKey]: newConfig };
      autoSave(next, stageKey);
      return next;
    });
  }, [autoSave]);

  const handleRestoreDefaults = useCallback(async () => {
    setRestoring(true);
    try {
      const res = await api.get("/config/workflow?details=1");
      const freshProviders = res.providers || [];
      const freshModels = res.models || {};
      setProviders(freshProviders);
      setModelsByProvider(freshModels);
      const available = freshProviders.filter((p) => p.available);
      const hasClaude = available.some((p) => p.name === "claude");
      const hasCodex = available.some((p) => p.name === "codex");
      const claudeModel = freshModels.claude?.[0]?.id || "";
      const codexModel = freshModels.codex?.[0]?.id || "";
      const planProvider = hasClaude ? "claude" : "codex";
      const planModel    = hasClaude ? claudeModel : codexModel;
      const execProvider = hasCodex  ? "codex"  : "claude";
      const execModel    = hasCodex  ? codexModel  : claudeModel;
      const defaults = {
        enhance:  { provider: planProvider, model: planModel, effort: "medium" },
        chat:     { provider: planProvider, model: planModel, effort: "medium" },
        plan:     { provider: planProvider, model: planModel, effort: "high" },
        execute:  { provider: execProvider, model: execModel, effort: "medium" },
        review:   { provider: planProvider, model: planModel, effort: "medium" },
        services: { provider: planProvider, model: planModel, effort: "medium" },
      };
      setWorkflow(defaults);
      await api.post("/config/workflow", { workflow: defaults });
      syncCache(defaults);
      setSavingStage("all");
      setTimeout(() => setSavingStage(null), 1500);
    } catch {}
    setRestoring(false);
  }, [syncCache]);

  if (loading || !workflow) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin opacity-30" />
      </div>
    );
  }

  return (
    <div className="space-y-4 stagger-children">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Pipeline</h2>
          <p className="text-xs opacity-50 mt-0.5">Provider, model, and thinking depth per stage. Changes are saved automatically.</p>
        </div>
        <button
          className="btn btn-ghost btn-sm gap-1 shrink-0"
          title="Reset to auto-detected provider defaults"
          onClick={handleRestoreDefaults}
          disabled={restoring}
        >
          {restoring ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
          Restore defaults
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {STAGES.map((stage) => (
          <StageBlock
            key={stage.key}
            stage={stage}
            config={workflow[stage.key] || workflow.plan}
            providers={providers}
            modelsByProvider={modelsByProvider}
            onChange={(newConfig) => handleStageChange(stage.key, newConfig)}
            saving={savingStage === stage.key || savingStage === "all"}
          />
        ))}
      </div>
    </div>
  );
}
