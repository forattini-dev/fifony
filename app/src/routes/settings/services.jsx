import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useEffect } from "react";
import { api } from "../../api.js";
import { useServices } from "../../hooks/useServices.js";
import { useVariables, getVariablesList, useVariableMutations, VARIABLES_QUERY_KEY } from "../../hooks/useVariables.js";
import { SettingsSection } from "../../components/SettingsSection.jsx";
import {
  Globe, Server, Play, Square, Loader2, Plus, Trash2, Pencil, Check, X, Sparkles, Circle,
} from "lucide-react";

export const Route = createFileRoute("/settings/services")({
  component: ServicesSettings,
});

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ── Variable row editor ────────────────────────────────────────────────────────

function VariableRow({ variable, onDelete, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [draftKey, setDraftKey] = useState(variable.key);
  const [draftValue, setDraftValue] = useState(variable.value);
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    if (!draftKey.trim() || !ENV_KEY_PATTERN.test(draftKey.trim())) return;
    setBusy(true);
    try {
      await onUpdate(variable.key, draftKey.trim(), draftValue, variable.scope);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try { await onDelete(variable.id); } finally { setBusy(false); }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 py-1.5">
        <input
          className="input input-xs input-bordered font-mono w-36"
          value={draftKey}
          onChange={(e) => setDraftKey(e.target.value)}
          placeholder="KEY"
        />
        <span className="text-xs opacity-30">=</span>
        <input
          className="input input-xs input-bordered font-mono flex-1 min-w-0"
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          placeholder="value"
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
        />
        <button className="btn btn-xs btn-success btn-square" onClick={handleSave} disabled={busy}>
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
        </button>
        <button className="btn btn-xs btn-ghost btn-square" onClick={() => setEditing(false)}>
          <X className="size-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-1.5 group">
      <span className="font-mono text-xs text-primary w-36 truncate">{variable.key}</span>
      <span className="text-xs opacity-30">=</span>
      <span className="font-mono text-xs flex-1 min-w-0 truncate opacity-70">{variable.value || <span className="opacity-30 italic">empty</span>}</span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button className="btn btn-xs btn-ghost btn-square" onClick={() => setEditing(true)} title="Edit">
          <Pencil className="size-3" />
        </button>
        <button className="btn btn-xs btn-ghost btn-square text-error" onClick={handleDelete} disabled={busy} title="Delete">
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
        </button>
      </div>
    </div>
  );
}

// ── Add variable row ───────────────────────────────────────────────────────────

function AddVariableRow({ scope, onAdd }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    const trimKey = key.trim();
    if (!trimKey) { setError("Key is required."); return; }
    if (!ENV_KEY_PATTERN.test(trimKey)) { setError(`Invalid key "${trimKey}".`); return; }
    setError("");
    setBusy(true);
    try {
      await onAdd(trimKey, value, scope);
      setKey("");
      setValue("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="btn btn-xs btn-ghost gap-1 opacity-50 hover:opacity-100" onClick={() => setOpen(true)}>
        <Plus className="size-3" /> Add variable
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          className="input input-xs input-bordered font-mono w-36"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="KEY"
        />
        <span className="text-xs opacity-30">=</span>
        <input
          className="input input-xs input-bordered font-mono flex-1 min-w-0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="value"
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") { setOpen(false); setKey(""); setValue(""); } }}
        />
        <button className="btn btn-xs btn-primary btn-square" onClick={handleSave} disabled={busy}>
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
        </button>
        <button className="btn btn-xs btn-ghost btn-square" onClick={() => { setOpen(false); setKey(""); setValue(""); setError(""); }}>
          <X className="size-3" />
        </button>
      </div>
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}

// ── Variables list section ─────────────────────────────────────────────────────

function VariablesList({ scope, variables, onUpdate, onDelete, onAdd }) {
  const scoped = variables.filter((v) => v.scope === scope);

  return (
    <div className="space-y-0.5">
      {scoped.length === 0 && (
        <p className="text-xs opacity-30 py-1">No variables set.</p>
      )}
      {scoped.map((v) => (
        <VariableRow
          key={v.id}
          variable={v}
          onDelete={onDelete}
          onUpdate={onUpdate}
        />
      ))}
      <div className="pt-1">
        <AddVariableRow scope={scope} onAdd={onAdd} />
      </div>
    </div>
  );
}

// ── Service config card ────────────────────────────────────────────────────────

const SERVICE_STATUS_DOT = {
  running:  "text-success fill-success",
  starting: "text-warning fill-warning",
  stopping: "text-warning fill-warning",
  crashed:  "text-error fill-error",
  stopped:  "text-base-content/20 fill-base-content/20",
};

function ServiceConfigCard({ service, variables, onSave, onDelete, onVariableUpdate, onVariableDelete, onVariableAdd }) {
  const [editing, setEditing] = useState(false);
  const [varsOpen, setVarsOpen] = useState(false);
  const [draft, setDraft] = useState({ name: service.name, command: service.command, cwd: service.cwd || "", autoStart: !!service.autoStart });
  const [busy, setBusy] = useState(false);

  const state = service.state ?? (service.running ? "running" : "stopped");
  const dotColor = SERVICE_STATUS_DOT[state] ?? "text-base-content/20 fill-base-content/20";
  const serviceVars = variables.filter((v) => v.scope === service.id);

  useEffect(() => {
    if (!editing) {
      setDraft({ name: service.name, command: service.command, cwd: service.cwd || "", autoStart: !!service.autoStart });
    }
  }, [service, editing]);

  const handleSave = async () => {
    if (!draft.name.trim() || !draft.command.trim()) return;
    setBusy(true);
    try {
      await onSave({ ...service, ...draft, name: draft.name.trim(), command: draft.command.trim(), cwd: draft.cwd.trim() || undefined });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Remove service "${service.name}"?`)) return;
    await onDelete(service.id);
  };

  return (
    <div className="card bg-base-200">
      <div className="card-body p-4 gap-2">
        {/* Header row */}
        <div className="flex items-center gap-3">
          <Circle className={`size-2.5 shrink-0 ${dotColor}`} />
          <div className="flex-1 min-w-0">
            <span className="font-semibold text-sm">{service.name}</span>
            {service.cwd && <span className="text-xs opacity-30 font-mono ml-2">{service.cwd}</span>}
            <div className="font-mono text-xs opacity-40 truncate mt-0.5">{service.command}</div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              className={`btn btn-xs btn-ghost gap-1 ${varsOpen ? "text-primary" : "opacity-50 hover:opacity-100"}`}
              onClick={() => setVarsOpen((v) => !v)}
            >
              Variables{serviceVars.length > 0 && <span className="badge badge-xs badge-primary">{serviceVars.length}</span>}
            </button>
            <button
              className={`btn btn-xs btn-ghost ${editing ? "text-primary" : "opacity-50 hover:opacity-100"}`}
              onClick={() => setEditing((v) => !v)}
              title="Edit service"
            >
              <Pencil className="size-3" />
            </button>
            <button
              className="btn btn-xs btn-ghost text-error opacity-50 hover:opacity-100"
              onClick={handleDelete}
              title="Delete service"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        </div>

        {/* Per-service variables */}
        {varsOpen && (
          <div className="pl-5 border-l border-base-content/10 ml-1">
            <p className="text-xs opacity-40 mb-1.5">These override global variables for this service.</p>
            <VariablesList
              scope={service.id}
              variables={variables}
              onUpdate={onVariableUpdate}
              onDelete={onVariableDelete}
              onAdd={onVariableAdd}
            />
          </div>
        )}

        {/* Edit form */}
        {editing && (
          <div className="pl-5 border-l border-base-content/10 ml-1 space-y-2 pt-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="form-control">
                <div className="label py-0.5"><span className="label-text text-xs">Name</span></div>
                <input className="input input-bordered input-sm" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              </label>
              <label className="form-control">
                <div className="label py-0.5"><span className="label-text text-xs">Working directory</span></div>
                <input className="input input-bordered input-sm font-mono text-xs" value={draft.cwd} onChange={(e) => setDraft((d) => ({ ...d, cwd: e.target.value }))} placeholder="(project root)" />
              </label>
            </div>
            <label className="form-control">
              <div className="label py-0.5"><span className="label-text text-xs">Command</span></div>
              <input className="input input-bordered input-sm font-mono text-xs" value={draft.command} onChange={(e) => setDraft((d) => ({ ...d, command: e.target.value }))} placeholder="pnpm dev" />
            </label>
            <label className="label cursor-pointer justify-start gap-2 p-0">
              <input type="checkbox" className="checkbox checkbox-sm checkbox-primary" checked={draft.autoStart} onChange={(e) => setDraft((d) => ({ ...d, autoStart: e.target.checked }))} />
              <span className="label-text text-xs">Auto-start on boot</span>
            </label>
            <div className="flex gap-2 pt-1">
              <button className="btn btn-xs btn-primary gap-1" onClick={handleSave} disabled={busy}>
                {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Save
              </button>
              <button className="btn btn-xs btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Add service card ───────────────────────────────────────────────────────────

function AddServiceForm({ onAdd, onCancel }) {
  const [draft, setDraft] = useState({ name: "", command: "", cwd: "", autoStart: false });
  const [detecting, setDetecting] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [busy, setBusy] = useState(false);

  const handleDetect = async () => {
    setDetecting(true);
    try {
      const res = await api.get("/services/detect");
      setSuggestions(res?.suggestions ?? []);
    } finally {
      setDetecting(false);
    }
  };

  const handleSuggestion = (sug) => {
    setDraft((d) => ({ ...d, name: sug.label, command: sug.command, cwd: sug.cwd || "" }));
    setSuggestions([]);
  };

  const handleSave = async () => {
    const name = draft.name.trim();
    const command = draft.command.trim();
    if (!name || !command) return;
    const slug = command.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
    const id = `${slug}-${Date.now()}`;
    setBusy(true);
    try {
      await onAdd({ id, name, command, cwd: draft.cwd.trim() || undefined, autoStart: draft.autoStart });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card bg-base-200 border border-primary/20">
      <div className="card-body p-4 gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold opacity-60 uppercase tracking-wider">New service</span>
          <button className="btn btn-xs btn-ghost gap-1 opacity-60 hover:opacity-100" onClick={handleDetect} disabled={detecting}>
            {detecting ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
            Detect
          </button>
        </div>

        {suggestions.length > 0 && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5 space-y-2">
            <span className="text-xs opacity-60">Click to use a detected command:</span>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s, i) => (
                <button key={i} className="btn btn-xs btn-outline btn-primary gap-1" onClick={() => handleSuggestion(s)}>
                  <Plus className="size-3" />{s.label}
                </button>
              ))}
            </div>
            <button className="text-xs opacity-40 hover:opacity-70" onClick={() => setSuggestions([])}>dismiss</button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="form-control">
            <div className="label py-0.5"><span className="label-text text-xs">Name *</span></div>
            <input className="input input-bordered input-sm" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="API server" />
          </label>
          <label className="form-control">
            <div className="label py-0.5"><span className="label-text text-xs">Working directory</span></div>
            <input className="input input-bordered input-sm font-mono text-xs" value={draft.cwd} onChange={(e) => setDraft((d) => ({ ...d, cwd: e.target.value }))} placeholder="(project root)" />
          </label>
        </div>
        <label className="form-control">
          <div className="label py-0.5"><span className="label-text text-xs">Command *</span></div>
          <input className="input input-bordered input-sm font-mono text-xs" value={draft.command} onChange={(e) => setDraft((d) => ({ ...d, command: e.target.value }))} placeholder="pnpm dev" />
        </label>
        <label className="label cursor-pointer justify-start gap-2 p-0">
          <input type="checkbox" className="checkbox checkbox-sm checkbox-primary" checked={draft.autoStart} onChange={(e) => setDraft((d) => ({ ...d, autoStart: e.target.checked }))} />
          <span className="label-text text-xs">Auto-start on boot</span>
        </label>

        <div className="flex gap-2">
          <button className="btn btn-xs btn-primary gap-1" onClick={handleSave} disabled={busy || !draft.name.trim() || !draft.command.trim()}>
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />} Add
          </button>
          <button className="btn btn-xs btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

function ServicesSettings() {
  const { services, loading: servicesLoading, refresh } = useServices();
  const variablesQuery = useVariables();
  const variables = getVariablesList(variablesQuery.data);
  const { upsert, remove } = useVariableMutations();
  const [addingNew, setAddingNew] = useState(false);

  const handleVariableUpdate = useCallback(async (oldKey, newKey, value, scope) => {
    if (oldKey !== newKey) {
      await remove(`${scope}:${oldKey}`);
    }
    await upsert(newKey, value, scope);
  }, [upsert, remove]);

  const handleServiceSave = useCallback(async (entry) => {
    await api.put(`/services/${entry.id}`, entry);
    await refresh();
  }, [refresh]);

  const handleServiceDelete = useCallback(async (id) => {
    await api.delete(`/services/${id}`);
    await refresh();
  }, [refresh]);

  const handleServiceAdd = useCallback(async (entry) => {
    await api.put(`/services/${entry.id}`, entry);
    await refresh();
    setAddingNew(false);
  }, [refresh]);

  return (
    <div className="space-y-4">

      {/* Global variables */}
      <SettingsSection
        icon={Globe}
        title="Global variables"
        description="Environment variables injected into every service on start. Per-service variables below take precedence."
      >
        {variablesQuery.isLoading ? (
          <div className="flex items-center gap-2 opacity-40"><Loader2 className="size-3 animate-spin" /><span className="text-xs">Loading…</span></div>
        ) : (
          <VariablesList
            scope="global"
            variables={variables}
            onUpdate={handleVariableUpdate}
            onDelete={remove}
            onAdd={upsert}
          />
        )}
      </SettingsSection>

      {/* Services */}
      <SettingsSection
        icon={Server}
        title="Services"
        description="Dev servers and background processes managed by fifony. Start and view logs from the Services page."
      >
        {servicesLoading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-12 rounded-lg bg-base-300 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {services.length === 0 && !addingNew && (
              <p className="text-xs opacity-40">No services configured yet.</p>
            )}
            {services.map((svc) => (
              <ServiceConfigCard
                key={svc.id}
                service={svc}
                variables={variables}
                onSave={handleServiceSave}
                onDelete={handleServiceDelete}
                onVariableUpdate={handleVariableUpdate}
                onVariableDelete={remove}
                onVariableAdd={upsert}
              />
            ))}
            {addingNew
              ? <AddServiceForm onAdd={handleServiceAdd} onCancel={() => setAddingNew(false)} />
              : (
                <button className="btn btn-xs btn-ghost gap-1 opacity-60 hover:opacity-100" onClick={() => setAddingNew(true)}>
                  <Plus className="size-3" /> Add service
                </button>
              )
            }
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
