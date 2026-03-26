import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Server, Play, Square, Terminal, Circle, Loader2,
  Plus, ChevronUp, Trash2, Pencil, Sparkles, Check, X, FlaskConical,
} from "lucide-react";
import { api } from "../api.js";
import { useServices, useServiceLog } from "../hooks/useServices.js";
import {
  SETTINGS_QUERY_KEY,
  getSettingValue,
  getSettingsList,
  upsertSettingPayload,
  useRuntimeDoctor,
  useRuntimeProbe,
  useRuntimeStatus,
  useSettings,
} from "../hooks.js";
import { formatDuration } from "../utils.js";

const SERVICE_ENV_SETTING_ID = "runtime.serviceEnv";
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function envMapToText(env) {
  if (!env || typeof env !== "object") return "";
  return Object.entries(env)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value ?? ""}`)
    .join("\n");
}

function normalizeEnvMap(env) {
  const next = {};
  if (!env || typeof env !== "object") return next;
  for (const [key, value] of Object.entries(env)) {
    const trimmedKey = key.trim();
    if (!trimmedKey || !ENV_KEY_PATTERN.test(trimmedKey)) continue;
    next[trimmedKey] = value == null ? "" : String(value);
  }
  return next;
}

function parseEnvText(text) {
  const env = {};
  const errors = [];
  const lines = String(text ?? "").split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = rawLine.indexOf("=");
    if (eqIndex <= 0) {
      errors.push(`Line ${index + 1}: expected KEY=value`);
      continue;
    }

    const key = rawLine.slice(0, eqIndex).trim();
    const value = rawLine.slice(eqIndex + 1);
    if (!ENV_KEY_PATTERN.test(key)) {
      errors.push(`Line ${index + 1}: invalid variable name "${key}"`);
      continue;
    }
    env[key] = value;
  }

  return { env, errors };
}

export const Route = createFileRoute("/workspace")({
  component: WorkspacePage,
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

// ── Inline edit form ───────────────────────────────────────────────────────────

function ServiceEditForm({ initial, onSave, onCancel, onDelete, isNew = false, onDetect }) {
  const [draft, setDraft] = useState({
    name: initial?.name ?? "",
    command: initial?.command ?? "",
    cwd: initial?.cwd ?? "",
    envText: envMapToText(initial?.env),
    autoStart: initial?.autoStart ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [envError, setEnvError] = useState("");

  const set = (field, val) => setDraft(d => ({ ...d, [field]: val }));

  const handleSave = async () => {
    const parsedEnv = parseEnvText(draft.envText);
    if (parsedEnv.errors.length > 0) {
      setEnvError(parsedEnv.errors[0]);
      return;
    }
    setEnvError("");
    const trimmed = {
      ...draft,
      name: draft.name.trim(),
      command: draft.command.trim(),
      cwd: draft.cwd.trim() || undefined,
      env: Object.keys(parsedEnv.env).length > 0 ? parsedEnv.env : undefined,
    };
    delete trimmed.envText;
    if (!trimmed.name || !trimmed.command) return;
    setBusy(true);
    try { await onSave(trimmed); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-2.5 pt-3 mt-3 border-t border-base-300">
      <input
        className="input input-bordered input-sm w-full"
        placeholder="Name"
        value={draft.name}
        autoFocus={isNew}
        onChange={e => set("name", e.target.value)}
        onKeyDown={e => e.key === "Enter" && handleSave()}
      />
      <input
        className="input input-bordered input-sm w-full font-mono text-xs"
        placeholder="Command (e.g. pnpm dev)"
        value={draft.command}
        onChange={e => set("command", e.target.value)}
        onKeyDown={e => e.key === "Enter" && handleSave()}
      />
      <div className="flex items-center gap-2">
        <input
          className="input input-bordered input-sm flex-1 font-mono text-xs"
          placeholder="Working dir (optional)"
          value={draft.cwd}
          onChange={e => set("cwd", e.target.value)}
        />
        <label className="flex items-center gap-1.5 cursor-pointer select-none shrink-0">
          <input
            type="checkbox"
            className="toggle toggle-xs toggle-primary"
            checked={!!draft.autoStart}
            onChange={e => set("autoStart", e.target.checked)}
          />
          <span className="text-xs opacity-70">Auto-start</span>
        </label>
      </div>
      <textarea
        className="textarea textarea-bordered min-h-28 w-full font-mono text-xs leading-relaxed"
        placeholder={"Environment variables\nAPI_URL=https://localhost:3000\nFEATURE_FLAG=true"}
        value={draft.envText}
        onChange={(e) => set("envText", e.target.value)}
      />
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="opacity-50">One `KEY=value` per line. Service values override global service env keys.</span>
        {envError ? <span className="text-error">{envError}</span> : null}
      </div>

      <div className="flex items-center gap-1.5">
        {isNew && (
          <button className="btn btn-xs btn-ghost opacity-60 gap-1" onClick={onDetect}>
            <Sparkles className="size-3" />Detect
          </button>
        )}
        <div className="flex-1" />
        {onDelete && (
          <button className="btn btn-xs btn-ghost text-error gap-1" onClick={onDelete}>
            <Trash2 className="size-3" />Delete
          </button>
        )}
        <button className="btn btn-xs btn-ghost" onClick={onCancel}>
          <X className="size-3" />Cancel
        </button>
        <button
          className="btn btn-xs btn-primary gap-1"
          onClick={handleSave}
          disabled={busy || !draft.name.trim() || !draft.command.trim()}
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          {isNew ? "Add" : "Save"}
        </button>
      </div>
    </div>
  );
}

function GlobalServiceEnvCard() {
  const qc = useQueryClient();
  const settingsQuery = useSettings();
  const settings = getSettingsList(settingsQuery.data);
  const persistedEnv = useMemo(
    () => normalizeEnvMap(getSettingValue(settings, SERVICE_ENV_SETTING_ID, {})),
    [settings],
  );
  const persistedText = useMemo(() => envMapToText(persistedEnv), [persistedEnv]);
  const [envText, setEnvText] = useState(persistedText);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setEnvText((current) => current === persistedText ? current : persistedText);
  }, [persistedText]);

  const handleSave = useCallback(async () => {
    const parsed = parseEnvText(envText);
    if (parsed.errors.length > 0) {
      setMessage(parsed.errors[0]);
      return;
    }

    setSaving(true);
    setMessage("");
    const setting = {
      id: SERVICE_ENV_SETTING_ID,
      scope: "runtime",
      value: parsed.env,
      source: "user",
      updatedAt: new Date().toISOString(),
    };

    try {
      qc.setQueryData(SETTINGS_QUERY_KEY, (current) => upsertSettingPayload(current, setting));
      const response = await api.post(`/settings/${encodeURIComponent(SERVICE_ENV_SETTING_ID)}`, {
        scope: "runtime",
        value: parsed.env,
        source: "user",
      });
      if (response?.setting) {
        qc.setQueryData(SETTINGS_QUERY_KEY, (current) => upsertSettingPayload(current, response.setting));
      }
      setMessage("Global service environment updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      qc.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
    } finally {
      setSaving(false);
    }
  }, [envText, qc]);

  return (
    <div className="card bg-base-200 border border-base-300">
      <div className="card-body p-4 gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider opacity-60">Global service environment</div>
            <p className="mt-1 text-xs opacity-50">Applied to every service at launch time. Per-service env overrides keys with the same name.</p>
          </div>
          <button className="btn btn-xs btn-primary gap-1" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            Save env
          </button>
        </div>
        <textarea
          className="textarea textarea-bordered min-h-28 w-full font-mono text-xs leading-relaxed"
          placeholder={"NODE_ENV=development\nAPI_ORIGIN=http://localhost:3000"}
          value={envText}
          onChange={(e) => setEnvText(e.target.value)}
        />
        <div className="text-xs">
          {message
            ? <span className={message.includes("updated") ? "text-success" : "text-error"}>{message}</span>
            : <span className="opacity-50">Format: one `KEY=value` per line.</span>}
        </div>
      </div>
    </div>
  );
}

function useDevProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await api.get("/dev-profile");
      setProfile(response?.profile ?? null);
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  const runAction = useCallback(async (path) => {
    setBusyAction(path);
    try {
      const response = await api.post(path, {});
      setProfile(response?.profile ?? null);
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyAction("");
    }
  }, []);

  return {
    profile,
    loading,
    error,
    busyAction,
    refresh,
    bootstrap: () => runAction("/dev-profile/bootstrap"),
    reset: () => runAction("/dev-profile/reset"),
  };
}

function DevProfileCard() {
  const { profile, loading, error, busyAction, bootstrap, reset } = useDevProfile();

  return (
    <div className="card bg-base-200 border border-base-300">
      <div className="card-body p-4 gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider opacity-60">Dev profile</div>
            <p className="mt-1 text-xs opacity-50">Isolated worktree + separate Fifony state for local harness experimentation.</p>
          </div>
          {loading ? <Loader2 className="size-4 animate-spin opacity-40" /> : null}
        </div>

        {profile ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-base-300 bg-base-100/70 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider opacity-45">Bootstrapped</div>
                <div className="mt-1 text-sm font-medium">{profile.bootstrapped ? "yes" : "no"}</div>
                <div className="text-xs opacity-50">{profile.worktreeAttached ? "worktree attached" : "worktree missing"}</div>
              </div>
              <div className="rounded-xl border border-base-300 bg-base-100/70 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider opacity-45">Workspace</div>
                <div className="mt-1 text-sm font-medium">{profile.workspaceExists ? "present" : "missing"}</div>
                <div className="text-xs opacity-50 break-all">{profile.workspaceRoot}</div>
              </div>
              <div className="rounded-xl border border-base-300 bg-base-100/70 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider opacity-45">State</div>
                <div className="mt-1 text-sm font-medium">{profile.persistenceExists ? "present" : "empty"}</div>
                <div className="text-xs opacity-50 break-all">{profile.persistenceRoot}</div>
              </div>
              <div className="rounded-xl border border-base-300 bg-base-100/70 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider opacity-45">Runbooks</div>
                <div className="mt-1 text-sm font-medium">{profile.bootstrapFiles?.runbooks?.length || 0}</div>
                <div className="text-xs opacity-50">{profile.trashEntries?.length || 0} reset snapshot(s)</div>
              </div>
            </div>

            <div className="rounded-xl border border-base-300 bg-base-100/70 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider opacity-45">Launch command</div>
              <div className="mt-1 font-mono text-xs break-all opacity-75">{profile.launchCommand}</div>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-base-300 bg-base-100/70 px-3 py-2.5 text-xs opacity-50">
            Dev profile data is not available yet.
          </div>
        )}

        {error ? (
          <div className="rounded-xl border border-error/20 bg-error/5 px-3 py-2.5 text-xs text-error">{error}</div>
        ) : null}

        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn btn-xs btn-primary gap-1" onClick={bootstrap} disabled={busyAction !== ""}>
            {busyAction === "/dev-profile/bootstrap" ? <Loader2 className="size-3 animate-spin" /> : <FlaskConical className="size-3" />}
            Bootstrap
          </button>
          <button className="btn btn-xs btn-ghost text-error gap-1" onClick={reset} disabled={busyAction !== ""}>
            {busyAction === "/dev-profile/reset" ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
            Reset to trash
          </button>
        </div>
      </div>
    </div>
  );
}

function RuntimeHealthCard() {
  const statusQuery = useRuntimeStatus();
  const probeQuery = useRuntimeProbe();
  const doctorQuery = useRuntimeDoctor();

  const snapshot = statusQuery.data?.snapshot ?? null;
  const probe = probeQuery.data ?? null;
  const checks = Array.isArray(doctorQuery.data?.checks) ? doctorQuery.data.checks : [];
  const failingChecks = checks.filter((check) => check.status === "fail").length;
  const warningChecks = checks.filter((check) => check.status === "warn").length;

  if (statusQuery.isLoading && doctorQuery.isLoading) {
    return (
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        {[0, 1].map((index) => (
          <div key={index} className="card bg-base-200 border border-base-300 animate-pulse">
            <div className="card-body p-4 gap-3">
              <div className="h-4 w-40 rounded bg-base-300" />
              <div className="h-3 w-full rounded bg-base-300" />
              <div className="h-3 w-3/4 rounded bg-base-300" />
              <div className="h-20 rounded bg-base-300" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="card bg-base-200 border border-base-300">
        <div className="card-body p-4 gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider opacity-60">Runtime health</div>
              <p className="mt-1 text-xs opacity-50">Operational snapshot for provider, agents, services, and memory flushes.</p>
            </div>
            <div className={`badge badge-sm ${snapshot?.ok ? "badge-success" : "badge-warning"}`}>
              {snapshot?.ok ? "healthy" : "attention"}
            </div>
          </div>

          {snapshot ? (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-xl border border-base-300 bg-base-100/70 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider opacity-45">Provider</div>
                <div className="mt-1 text-sm font-medium">{snapshot.providers.configuredProvider}</div>
                <div className="text-xs opacity-50">{snapshot.providers.available.filter((provider) => provider.available).length} detected</div>
              </div>
              <div className="rounded-xl border border-base-300 bg-base-100/70 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider opacity-45">Issues</div>
                <div className="mt-1 text-sm font-medium">{snapshot.issues.running} running · {snapshot.issues.reviewing} reviewing</div>
                <div className="text-xs opacity-50">{snapshot.issues.total} total issues</div>
              </div>
              <div className="rounded-xl border border-base-300 bg-base-100/70 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider opacity-45">Services</div>
                <div className="mt-1 text-sm font-medium">{snapshot.services.running}/{snapshot.services.total} running</div>
                <div className="text-xs opacity-50">{snapshot.services.crashed} crashed · {snapshot.services.starting} starting</div>
              </div>
              <div className="rounded-xl border border-base-300 bg-base-100/70 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider opacity-45">Agents</div>
                <div className="mt-1 text-sm font-medium">{snapshot.agents.active} active</div>
                <div className="text-xs opacity-50">{snapshot.agents.crashed} crashed · {snapshot.agents.idle} idle</div>
              </div>
              <div className="rounded-xl border border-base-300 bg-base-100/70 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider opacity-45">Memory</div>
                <div className="mt-1 text-sm font-medium">{snapshot.memory.totalFlushes} flushes</div>
                <div className="text-xs opacity-50">{snapshot.memory.issuesWithFlushes} issue workspaces seeded</div>
              </div>
              <div className="rounded-xl border border-base-300 bg-base-100/70 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider opacity-45">Probe</div>
                <div className="mt-1 text-sm font-medium">{probe?.ok ? "passing" : "degraded"}</div>
                <div className="text-xs opacity-50">{failingChecks} fail · {warningChecks} warn</div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-warning/20 bg-warning/5 px-3 py-2.5 text-xs text-warning">
              Runtime health data is not available right now.
            </div>
          )}
        </div>
      </div>

      <div className="card bg-base-200 border border-base-300">
        <div className="card-body p-4 gap-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider opacity-60">Doctor</div>
              <p className="mt-1 text-xs opacity-50">Detailed checks for workspace git, providers, services, agents, and memory.</p>
            </div>
            {doctorQuery.isFetching ? <Loader2 className="size-3.5 animate-spin opacity-40" /> : null}
          </div>

          {checks.length > 0 ? (
            <div className="space-y-2">
              {checks.map((check) => {
                const tone = check.status === "fail"
                  ? "border-error/20 bg-error/5 text-error"
                  : check.status === "warn"
                    ? "border-warning/20 bg-warning/5 text-warning"
                    : "border-success/20 bg-success/5 text-success";

                return (
                  <div key={check.id} className={`rounded-xl border px-3 py-2.5 ${tone}`}>
                    <div className="flex items-start gap-2">
                      <Circle className="mt-1 size-2.5 shrink-0 fill-current" />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold uppercase tracking-wider">{check.title}</div>
                        <p className="mt-1 text-xs leading-relaxed text-base-content/70">{check.summary}</p>
                        {check.suggestedAction ? (
                          <p className="mt-1 text-[11px] text-base-content/55">Action: {check.suggestedAction}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-base-300 bg-base-100/70 px-3 py-2.5 text-xs opacity-50">
              No doctor checks available yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Service card ───────────────────────────────────────────────────────────────

function ServiceCard({ service, onRefresh, onEdit, onDelete }) {
  const [busy, setBusy] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [editing, setEditing] = useState(false);

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

  const handleSave = async (updated) => {
    await onEdit({ ...updated, id: service.id });
    setEditing(false);
  };

  const handleDelete = async () => {
    if (!confirm(`Remove "${service.name}"?`)) return;
    await onDelete(service.id);
  };

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
              className={`btn btn-sm btn-ghost ${editing ? "opacity-100 text-primary" : "opacity-40 hover:opacity-100"}`}
              onClick={() => { setEditing(v => !v); if (!editing) setLogOpen(false); }}
              title="Edit"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              className={`btn btn-sm btn-ghost ${logOpen ? "opacity-100" : "opacity-40 hover:opacity-100"}`}
              onClick={() => { setLogOpen(v => !v); if (!logOpen) setEditing(false); }}
              title="Toggle log"
            >
              {logOpen ? <ChevronUp className="size-4" /> : <Terminal className="size-4" />}
            </button>
          </div>
        </div>

        {editing && (
          <ServiceEditForm
            initial={{
              name: service.name,
              command: service.command,
              cwd: service.cwd || "",
              env: service.env,
              autoStart: !!service.autoStart,
            }}
            onSave={handleSave}
            onCancel={() => setEditing(false)}
            onDelete={handleDelete}
          />
        )}

        {logOpen && <LogViewer id={service.id} running={service.running} />}
      </div>
    </div>
  );
}

// ── New service card ───────────────────────────────────────────────────────────

function AddServiceCard({ onAdd, onCancel }) {
  const [detecting, setDetecting] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

  const handleDetect = async () => {
    setDetecting(true);
    setSuggestions([]);
    try {
      const res = await api.get("/services/detect");
      setSuggestions(res?.suggestions || []);
    } finally {
      setDetecting(false);
    }
  };

  const handleAddSuggestion = async (sug) => {
    const slug = sug.command.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
    const id = `${slug}-${Date.now()}`;
    await onAdd({ id, name: sug.label, command: sug.command, cwd: sug.cwd || undefined, autoStart: false });
    setSuggestions(s => s.filter(x => x !== sug));
  };

  const handleSave = async (draft) => {
    const id = `custom-${Date.now()}`;
    await onAdd({ id, ...draft });
  };

  return (
    <div className="card bg-base-200 border border-primary/20">
      <div className="card-body p-4 gap-0">
        <div className="flex items-center gap-2 mb-1">
          <Plus className="size-3.5 opacity-40" />
          <span className="text-xs font-medium opacity-60 uppercase tracking-wider">New service</span>
        </div>

        {suggestions.length > 0 && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5 flex flex-col gap-2 mb-3">
            <span className="text-xs font-medium opacity-60">Detected commands — click to add:</span>
            <div className="flex flex-wrap gap-1.5">
              {detecting
                ? <Loader2 className="size-3 animate-spin opacity-40" />
                : suggestions.map((s, i) => (
                  <button key={i} className="btn btn-xs btn-outline btn-primary gap-1" onClick={() => handleAddSuggestion(s)}>
                    <Plus className="size-3" />{s.label}
                  </button>
                ))
              }
            </div>
            <button className="text-xs opacity-40 hover:opacity-70 self-start" onClick={() => setSuggestions([])}>dismiss</button>
          </div>
        )}

        <ServiceEditForm
          isNew
          onSave={handleSave}
          onCancel={onCancel}
          onDetect={handleDetect}
        />
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

function WorkspacePage() {
  const { services, loading, refresh } = useServices();
  const [addingNew, setAddingNew] = useState(false);

  const handleStartAll = useCallback(async () => {
    await Promise.all(services.filter((service) => !service.running).map((service) => api.post(`/services/${service.id}/start`, {})));
    await refresh();
  }, [services, refresh]);

  const handleStopAll = useCallback(async () => {
    await Promise.all(services.filter((service) => service.running).map((service) => api.post(`/services/${service.id}/stop`, {})));
    await refresh();
  }, [services, refresh]);

  const handleEdit = useCallback(async (entry) => {
    await api.put(`/services/${entry.id}`, entry);
    await refresh();
  }, [refresh]);

  const handleDelete = useCallback(async (id) => {
    await api.delete(`/services/${id}`);
    await refresh();
  }, [refresh]);

  const handleAdd = useCallback(async (entry) => {
    await api.put(`/services/${entry.id}`, entry);
    await refresh();
    setAddingNew(false);
  }, [refresh]);

  const anyRunning = services.some((service) => service.running);
  const allRunning = services.length > 0 && services.every((service) => service.running);

  return (
    <div className="flex-1 flex flex-col min-h-0 px-4 pb-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          <Server className="size-4 opacity-50" />
          <h1 className="text-sm font-semibold opacity-70 uppercase tracking-widest">Workspace</h1>
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
          {!addingNew && (
            <button className="btn btn-xs btn-ghost opacity-60 hover:opacity-100 gap-1" onClick={() => setAddingNew(true)}>
              <Plus className="size-3" />Add service
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
                    <div className="h-8 w-8 rounded-btn bg-base-300" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <GlobalServiceEnvCard />
      <DevProfileCard />
      <RuntimeHealthCard />

      {/* Empty state */}
      {!loading && services.length === 0 && !addingNew && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Server className="size-10 opacity-10" />
          <div className="text-center">
            <p className="text-sm font-medium opacity-70">No services configured</p>
            <p className="text-xs opacity-40 mt-1">Add your project's start commands to launch and monitor them here.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-sm btn-primary gap-2" onClick={() => setAddingNew(true)}>
              <Plus className="size-4" />Add service
            </button>
          </div>
        </div>
      )}

      {/* Service list */}
      {(services.length > 0 || addingNew) && (
        <div className="flex flex-col gap-3">
          {services.map((service) => (
            <ServiceCard
              key={service.id}
              service={service}
              onRefresh={refresh}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
          {addingNew && (
            <AddServiceCard
              onAdd={handleAdd}
              onCancel={() => setAddingNew(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
