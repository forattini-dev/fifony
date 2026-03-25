import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api.js";
import { useSettings, getSettingsList, getSettingValue, SETTINGS_QUERY_KEY, upsertSettingPayload } from "../../hooks.js";
import {
  Lightbulb,
  Play,
  Eye,
  RotateCcw,
  Loader2,
  Check,
  ArrowDown,
  Container,
  AlertTriangle,
} from "lucide-react";

const STAGES = [
  {
    key: "plan",
    label: "Plan",
    icon: Lightbulb,
    description: "Generate the execution plan",
    accent: "info",
  },
  {
    key: "execute",
    label: "Execute",
    icon: Play,
    description: "Implement the changes",
    accent: "primary",
  },
  {
    key: "review",
    label: "Review",
    icon: Eye,
    description: "Review the implementation",
    accent: "secondary",
  },
];

const EFFORTS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "extra-high", label: "Extra High" },
];

const ACCENT_MAP = {
  info: {
    border: "border-info/30",
    bg: "bg-info/10",
    text: "text-info",
    step: "step-info",
    badge: "badge-info",
  },
  primary: {
    border: "border-primary/30",
    bg: "bg-primary/10",
    text: "text-primary",
    step: "step-primary",
    badge: "badge-primary",
  },
  secondary: {
    border: "border-secondary/30",
    bg: "bg-secondary/10",
    text: "text-secondary",
    step: "step-secondary",
    badge: "badge-secondary",
  },
};

function StageBlock({ stage, config, providers, modelsByProvider, onChange, isLast, saving }) {
  const Icon = stage.icon;
  const models = modelsByProvider[config.provider] || [];
  const availableProviders = (providers || []).filter((p) => p.available);
  const colors = ACCENT_MAP[stage.accent];

  return (
    <>
      <div className={`card bg-base-200 border-l-4 ${colors.border} animate-fade-in`}>
        <div className="card-body p-4 gap-3">
          <div className="flex items-center gap-3">
            <div className={`flex items-center justify-center size-9 rounded-lg ${colors.bg}`}>
              <Icon className={`size-4.5 ${colors.text}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm">{stage.label}</h3>
                <span className={`badge badge-xs ${colors.badge} badge-outline`}>
                  {config.provider}
                </span>
                {saving === stage.key && (
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
                  onChange({
                    ...config,
                    provider: newProvider,
                    model: newModels[0]?.id || "",
                    effort: newEffort,
                  });
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
                <span className="label-text text-xs opacity-60">Effort</span>
              </div>
              <select
                className="select select-bordered select-sm w-full"
                value={config.effort}
                onChange={(e) => onChange({ ...config, effort: e.target.value })}
              >
                {EFFORTS.filter(
                  (e) => config.provider !== "gemini" || e.value !== "extra-high"
                ).map((e) => (
                  <option key={e.value} value={e.value}>{e.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      {!isLast && (
        <div className="flex justify-center py-0.5">
          <ArrowDown className="size-4 opacity-20" />
        </div>
      )}
    </>
  );
}

export const Route = createFileRoute("/settings/workflow")({
  component: WorkflowSettings,
});

function WorkflowSettings() {
  const qc = useQueryClient();
  const settingsQuery = useSettings();
  const [workflow, setWorkflow] = useState(null);
  const [providers, setProviders] = useState([]);
  const [modelsByProvider, setModelsByProvider] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingStage, setSavingStage] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const saveTimer = useRef(null);

  // Docker execution settings
  const [dockerExecution, setDockerExecution] = useState(false);
  const [dockerImage, setDockerImage] = useState("fifony-agent:latest");
  const [savingDocker, setSavingDocker] = useState(false);

  const syncWorkflowSettingCache = useCallback((nextWorkflow) => {
    qc.setQueryData(SETTINGS_QUERY_KEY, (current) => upsertSettingPayload(current, {
      id: "runtime.workflowConfig",
      scope: "runtime",
      value: nextWorkflow,
      source: "user",
      updatedAt: new Date().toISOString(),
    }));
    qc.setQueryData(["workflow-config"], {
      ok: true,
      workflow: nextWorkflow,
      isDefault: false,
    });
  }, [qc]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/config/workflow?details=1");
      setWorkflow(res.workflow);
      setProviders(res.providers || []);
      // Models come from the same endpoint (discovered server-side, never hardcoded)
      setModelsByProvider(res.models || {});
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  // Auto-save with debounce
  const autoSave = useCallback((newWorkflow, changedStage) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.post("/config/workflow", { workflow: newWorkflow });
        syncWorkflowSettingCache(newWorkflow);
        setSavingStage(changedStage);
        setTimeout(() => setSavingStage(null), 1500);
      } catch {
        // silent fail — the user will see the stale state on next load
      }
    }, 600);
  }, [syncWorkflowSettingCache]);

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
      // Fetch fresh defaults from the server (server discovers models, builds defaults — never hardcoded)
      const res = await api.get("/config/workflow?details=1");
      // The server returns isDefault=true defaults with discovered models
      // We need to get the default config by asking the server
      const freshProviders = res.providers || [];
      const freshModels = res.models || {};
      setProviders(freshProviders);
      setModelsByProvider(freshModels);

      // Build defaults using first discovered model per provider
      const available = freshProviders.filter((p) => p.available);
      const hasClaude = available.some((p) => p.name === "claude");
      const hasCodex = available.some((p) => p.name === "codex");
      const claudeModel = freshModels.claude?.[0]?.id || "";
      const codexModel = freshModels.codex?.[0]?.id || "";

      const defaults = {
        plan: { provider: hasClaude ? "claude" : "codex", model: hasClaude ? claudeModel : codexModel, effort: "high" },
        execute: { provider: hasCodex ? "codex" : "claude", model: hasCodex ? codexModel : claudeModel, effort: "medium" },
        review: { provider: hasClaude ? "claude" : "codex", model: hasClaude ? claudeModel : codexModel, effort: "medium" },
      };

      setWorkflow(defaults);
      await api.post("/config/workflow", { workflow: defaults });
      syncWorkflowSettingCache(defaults);
      setSavingStage("all");
      setTimeout(() => setSavingStage(null), 1500);
    } catch {}
    setRestoring(false);
  }, [syncWorkflowSettingCache]);

  // Cleanup timer on unmount
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  // Load Docker settings from settings query
  useEffect(() => {
    const settings = getSettingsList(settingsQuery.data);
    if (!settings?.length) return;
    const nextDockerExecution = getSettingValue(settings, "runtime.dockerExecution", false);
    if (typeof nextDockerExecution === "boolean") setDockerExecution(nextDockerExecution);
    const nextDockerImage = getSettingValue(settings, "runtime.dockerImage", "fifony-agent:latest");
    if (typeof nextDockerImage === "string" && nextDockerImage) setDockerImage(nextDockerImage);
  }, [settingsQuery.data]);

  const saveDockerSettings = useCallback(async () => {
    setSavingDocker(true);
    try {
      await api.post(`/settings/${encodeURIComponent("runtime.dockerExecution")}`, { scope: "runtime", value: dockerExecution, source: "user" });
      await api.post(`/settings/${encodeURIComponent("runtime.dockerImage")}`, { scope: "runtime", value: dockerImage || "fifony-agent:latest", source: "user" });
      qc.setQueryData(SETTINGS_QUERY_KEY, (current) => {
        let next = upsertSettingPayload(current, { id: "runtime.dockerExecution", scope: "runtime", value: dockerExecution, source: "user", updatedAt: new Date().toISOString() });
        next = upsertSettingPayload(next, { id: "runtime.dockerImage", scope: "runtime", value: dockerImage || "fifony-agent:latest", source: "user", updatedAt: new Date().toISOString() });
        return next;
      });
    } catch {}
    setSavingDocker(false);
  }, [dockerExecution, dockerImage, qc]);

  if (loading || !workflow) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin opacity-30" />
      </div>
    );
  }

  return (
    <div className="space-y-4 stagger-children">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold">Pipeline Workflow</h2>
          <p className="text-xs opacity-50 mt-0.5">
            Changes are saved automatically.
          </p>
        </div>
        <button
          className="btn btn-ghost btn-sm gap-1 shrink-0"
          onClick={handleRestoreDefaults}
          disabled={restoring}
        >
          {restoring ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
          Restore defaults
        </button>
      </div>

      <div className="card bg-base-200">
        <div className="card-body gap-3 p-4">
          <h3 className="card-title text-sm">Pipeline</h3>
          <p className="text-xs opacity-50">
            Configure providers/models/effort by stage and persist directly to workflow settings.
          </p>
        </div>
      </div>

      {/* Pipeline steps indicator */}
      <ul className="steps steps-horizontal w-full text-xs">
        {STAGES.map((stage) => {
          const colors = ACCENT_MAP[stage.accent];
          return (
            <li key={stage.key} className={`step ${colors.step}`}>
              {stage.label}
            </li>
          );
        })}
      </ul>

      {/* Stage cards */}
      <div className="flex flex-col">
        {STAGES.map((stage, i) => (
          <StageBlock
            key={stage.key}
            stage={stage}
            config={workflow[stage.key]}
            providers={providers}
            modelsByProvider={modelsByProvider}
            onChange={(newConfig) => handleStageChange(stage.key, newConfig)}
            isLast={i === STAGES.length - 1}
            saving={savingStage === stage.key || savingStage === "all" ? stage.key : null}
          />
        ))}
      </div>

      {/* Execution Sandbox */}
      <div className="card bg-base-200 border-l-4 border-warning/30 animate-fade-in">
        <div className="card-body p-4 gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-9 rounded-lg bg-warning/10">
              <Container className="size-4.5 text-warning" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Execution Sandbox</h3>
              <p className="text-xs opacity-50">Isolate agent execution inside a Docker container.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${!dockerExecution ? "border-base-content/30 bg-base-300" : "border-base-content/10 bg-base-100/50 opacity-60"}`}>
              <input
                type="radio"
                className="radio radio-sm mt-0.5"
                checked={!dockerExecution}
                onChange={() => setDockerExecution(false)}
              />
              <div className="space-y-1.5">
                <p className="text-xs font-medium">Script (host)</p>
                <p className="text-xs opacity-50 leading-relaxed">
                  The agent runs directly on your system with the same user and permissions as fifony.
                  Full filesystem and network access. No setup required —
                  but code generated by the agent can read or modify any file accessible to your user.
                </p>
              </div>
            </label>

            <label className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${dockerExecution ? "border-warning/40 bg-warning/5" : "border-base-content/10 bg-base-100/50 opacity-60"}`}>
              <input
                type="radio"
                className="radio radio-sm radio-warning mt-0.5"
                checked={dockerExecution}
                onChange={() => setDockerExecution(true)}
              />
              <div className="space-y-1.5">
                <p className="text-xs font-medium">Docker container</p>
                <p className="text-xs opacity-50 leading-relaxed">
                  Each execution runs in an isolated container. The agent only sees the issue workspace
                  and the project <code className="font-mono">.git</code> — nothing else on the host filesystem.
                  Linux capabilities dropped, privilege escalation blocked.
                  Requires Docker installed and the <code className="font-mono">fifony-agent</code> image built.
                </p>
              </div>
            </label>
          </div>

          {dockerExecution && (
            <div className="space-y-3">
              <label className="form-control w-full">
                <div className="label py-0.5">
                  <span className="label-text text-xs">Docker image</span>
                </div>
                <input
                  type="text"
                  className="input input-bordered input-sm w-full font-mono text-xs"
                  placeholder="fifony-agent:latest"
                  value={dockerImage}
                  onChange={(e) => setDockerImage(e.target.value)}
                />
              </label>

              <div className="flex items-start gap-2 text-xs opacity-60">
                <AlertTriangle className="size-3 shrink-0 mt-0.5 text-warning" />
                <span>
                  Requires Docker installed and image built: <code className="font-mono">docker build -f Dockerfile.agent -t fifony-agent:latest .</code>
                  <br />
                  Agents will not survive API restarts in this mode.
                </span>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              className="btn btn-sm btn-warning btn-outline gap-1"
              onClick={saveDockerSettings}
              disabled={savingDocker}
            >
              {savingDocker ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
              Save sandbox settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
