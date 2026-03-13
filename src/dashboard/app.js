const subtitle = document.getElementById("subtitle");
const healthBadge = document.getElementById("health");
const refreshBadge = document.getElementById("lastRefresh");
const overviewEl = document.getElementById("overview");
const issueListEl = document.getElementById("issue-list");
const runtimeMeta = document.getElementById("runtime-meta");
const stateFilter = document.getElementById("state-filter");
const categoryFilter = document.getElementById("category-filter");
const queryInput = document.getElementById("query");
const eventsEl = document.getElementById("events");
const eventKindFilter = document.getElementById("event-kind-filter");
const eventIssueFilter = document.getElementById("event-issue-filter");
const rerunBtn = document.getElementById("rerun");
const clearEventsBtn = document.getElementById("clear-events");
const newIssueBtn = document.getElementById("new-issue-btn");
const createForm = document.getElementById("create-form");

let appState = {};
let lastEventTimestamp = "";
let lastStateHash = "";
let expandedSessions = new Set();
let activeSplitId = null;

// ── Toast notifications ─────────────────────────────────────────────────────

function getOrCreateToastContainer() {
  let container = document.querySelector(".toast");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast";
    document.body.appendChild(container);
  }
  return container;
}

function showToast(message, kind = "error", durationMs = 4000) {
  const container = getOrCreateToastContainer();
  const item = document.createElement("div");
  const cls = kind === "success" ? "toast-success" : kind === "warn" ? "toast-warn" : "";
  item.className = `toast-item ${cls}`.trim();
  item.textContent = message;
  container.appendChild(item);

  setTimeout(() => {
    item.classList.add("toast-out");
    item.addEventListener("animationend", () => item.remove());
  }, durationMs);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const stateOrder = ["Todo", "In Progress", "In Review", "Blocked", "Done", "Cancelled"];
const capabilityOrder = ["security", "bugfix", "backend", "devops", "frontend-ui", "architecture", "documentation", "default", "workflow-disabled"];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function timeAgo(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  const elapsed = Date.now() - parsed.getTime();
  if (elapsed < 0) return "just now";
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1000)}s ago`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}

function formatDuration(ms) {
  if (!ms || ms < 0) return "-";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return String(hash);
}

// ── Network ──────────────────────────────────────────────────────────────────

async function fetchJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

async function post(path, payload = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    throw new Error(errorPayload.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

// ── KPI Overview ─────────────────────────────────────────────────────────────

function kpiCard(label, value, { accent = "", desc = "" } = {}) {
  const cls = accent ? ` ${accent}` : "";
  return `
    <div class="kpi">
      <p class="label">${label}</p>
      <p class="value${cls}">${value}</p>
      ${desc ? `<p class="desc">${escapeHtml(desc)}</p>` : ""}
    </div>
  `;
}

function capabilityRank(value) {
  const normalized = String(value || "default");
  const index = capabilityOrder.indexOf(normalized);
  return index === -1 ? 999 : index;
}

function updateTabTitle(metrics) {
  if (!metrics) return;
  const parts = [];
  if (metrics.inProgress) parts.push(`${metrics.inProgress} running`);
  if (metrics.blocked) parts.push(`${metrics.blocked} blocked`);
  if (metrics.queued) parts.push(`${metrics.queued} queued`);
  document.title = parts.length
    ? `(${parts.join(", ")}) Symphifo`
    : "Symphifo";
}

function renderOverview(metrics, issues = []) {
  if (!metrics) return;

  updateTabTitle(metrics);

  const total = metrics.total || 0;
  const running = metrics.inProgress || 0;
  const blocked = metrics.blocked || 0;
  const done = metrics.done || 0;
  const queued = metrics.queued || 0;
  const cancelled = metrics.cancelled || 0;
  const pctDone = total > 0 ? `${Math.round((done / total) * 100)}% complete` : "";
  const byCapability = issues.reduce((accumulator, issue) => {
    const key = issue.capabilityCategory || "default";
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
  const topCapabilities = Object.entries(byCapability)
    .sort((a, b) => {
      const rankDiff = capabilityRank(a[0]) - capabilityRank(b[0]);
      if (rankDiff !== 0) return rankDiff;
      return b[1] - a[1];
    })
    .slice(0, 3);
  const criticalQueue = issues.filter((issue) => issue.capabilityCategory === "security" || issue.capabilityCategory === "bugfix").length;

  overviewEl.innerHTML = [
    kpiCard("Total", total),
    kpiCard("Queued", queued, { accent: queued > 0 ? "accent" : "" }),
    kpiCard("Running", running, { accent: running > 0 ? "accent" : "", desc: running > 0 ? "in progress" : "" }),
    kpiCard("Blocked", blocked, { accent: blocked > 0 ? "danger" : "", desc: blocked > 0 ? "needs attention" : "" }),
    kpiCard("Done", done, { desc: pctDone }),
    kpiCard("Cancelled", cancelled, { accent: cancelled > 0 ? "warn" : "" }),
    kpiCard("Critical", criticalQueue, { accent: criticalQueue > 0 ? "danger" : "", desc: "security + bugfix" }),
    ...topCapabilities.map(([category, count]) => kpiCard(category, count, { desc: "capability load" })),
  ].join("");

  // Progress bar
  if (total > 0) {
    const donePct = Math.round((done / total) * 100);
    const runningPct = Math.round((running / total) * 100);
    const blockedPct = Math.round((blocked / total) * 100);
    overviewEl.insertAdjacentHTML("afterend", "");
    const existing = document.getElementById("progress-bar");
    if (existing) existing.remove();
    overviewEl.insertAdjacentHTML("afterend", `
      <div id="progress-bar" class="progress-bar">
        <div class="progress-segment progress-done" style="width:${donePct}%" title="Done ${donePct}%"></div>
        <div class="progress-segment progress-running" style="width:${runningPct}%" title="Running ${runningPct}%"></div>
        <div class="progress-segment progress-blocked" style="width:${blockedPct}%" title="Blocked ${blockedPct}%"></div>
      </div>
    `);
  }
}

// ── Issue Actions ────────────────────────────────────────────────────────────

function actionButton(issueId, label, action, payload = "") {
  return `<button type="button" class="action-button" data-id="${escapeHtml(issueId)}" data-action="${action}" data-payload="${escapeHtml(payload)}">${label}</button>`;
}

function issueActions(issue) {
  const editBtn = actionButton(issue.id, "Edit", "edit");
  const deleteBtn = actionButton(issue.id, "Delete", "delete");
  if (issue.state === "Blocked") {
    return `${actionButton(issue.id, "Retry", "retry")} ${actionButton(issue.id, "Set Todo", "state", "Todo")} ${actionButton(issue.id, "Split", "split")} ${actionButton(issue.id, "Cancel", "cancel")} ${editBtn} ${deleteBtn}`;
  }
  if (issue.state === "Done" || issue.state === "Cancelled") {
    return `${actionButton(issue.id, "Retry", "retry")} ${editBtn} ${deleteBtn}`;
  }
  if (issue.state === "Todo") {
    return `${actionButton(issue.id, "Mark In Progress", "state", "In Progress")} ${actionButton(issue.id, "Split", "split")} ${actionButton(issue.id, "Cancel", "state", "Cancelled")} ${editBtn} ${deleteBtn}`;
  }
  // In Progress, In Review
  return `${actionButton(issue.id, "View Sessions", "sessions")} ${actionButton(issue.id, "Cancel", "cancel")} ${editBtn}`;
}

function stateClass(value) {
  return `state-badge state-${String(value).replace(/\s+/g, "_")}`;
}

// ── Issue Rendering ──────────────────────────────────────────────────────────

function renderIssues(issues = []) {
  const selectedState = stateFilter.value;
  const selectedCategory = categoryFilter?.value || "all";
  const search = queryInput.value.trim().toLowerCase();

  const filtered = issues.filter((issue) => {
    if (selectedState !== "all" && issue.state !== selectedState) return false;
    if (selectedCategory !== "all" && issue.capabilityCategory !== selectedCategory) return false;
    if (search) {
      const target = `${issue.identifier} ${issue.title} ${issue.description || ""} ${issue.id}`.toLowerCase();
      if (!target.includes(search)) return false;
    }
    return true;
  });

  // Populate category filter dynamically
  if (categoryFilter) {
    const categories = new Set(issues.map((i) => i.capabilityCategory).filter(Boolean));
    const currentOptions = new Set();
    for (const opt of categoryFilter.options) currentOptions.add(opt.value);
    for (const cat of categories) {
      if (!currentOptions.has(cat)) {
        const opt = document.createElement("option");
        opt.value = cat;
        opt.textContent = cat;
        categoryFilter.appendChild(opt);
      }
    }
  }

  // Issue count indicator
  const countEl = document.getElementById("issue-count");
  if (countEl) {
    countEl.textContent = filtered.length === issues.length
      ? `${issues.length} issues`
      : `${filtered.length} / ${issues.length} issues`;
  }

  if (!filtered.length) {
    issueListEl.innerHTML = '<p class="muted">No issues match this filter.</p>';
    return;
  }

  issueListEl.innerHTML = filtered
    .sort((a, b) => {
      const sa = stateOrder.indexOf(a.state);
      const sb = stateOrder.indexOf(b.state);
      if (sa !== sb) return sa - sb;
      const priorityDiff = (a.priority || 999) - (b.priority || 999);
      if (priorityDiff !== 0) return priorityDiff;
      const capabilityDiff = capabilityRank(a.capabilityCategory) - capabilityRank(b.capabilityCategory);
      if (capabilityDiff !== 0) return capabilityDiff;
      return String(a.identifier || "").localeCompare(String(b.identifier || ""));
    })
    .map((issue) => {
      const historyEntries = Array.isArray(issue.history) ? issue.history : [];
      const recentHistory = historyEntries.slice(-3).map((entry) => `<li class="mono">${escapeHtml(entry)}</li>`).join("");
      const olderHistory = historyEntries.slice(0, -3).map((entry) => `<li class="mono">${escapeHtml(entry)}</li>`).join("");
      const history = historyEntries.length > 3
        ? `<details class="history-detail"><summary>${historyEntries.length - 3} older entries</summary><ul class="history">${olderHistory}</ul></details>${recentHistory}`
        : recentHistory;
      const labels = Array.isArray(issue.labels)
        ? issue.labels.map((l) => `<span class="tag">${escapeHtml(l)}</span>`).join("")
        : "";
      const paths = Array.isArray(issue.paths) && issue.paths.length
        ? issue.paths.map((p) => `<span class="tag mono">${escapeHtml(p)}</span>`).join("")
        : "";
      const overlays = Array.isArray(issue.capabilityOverlays) && issue.capabilityOverlays.length
        ? issue.capabilityOverlays.map((o) => `<span class="tag">${escapeHtml(`overlay:${o}`)}</span>`).join("")
        : "";
      const category = issue.capabilityCategory
        ? `<span class="tag">${escapeHtml(`capability:${issue.capabilityCategory}`)}</span>`
        : "";

      const blockedByHtml = Array.isArray(issue.blockedBy) && issue.blockedBy.length
        ? issue.blockedBy.map((dep) => `<span class="blocked-by">${escapeHtml(dep)}</span>`).join("")
        : "";

      const errorHtml = issue.lastError
        ? `<details class="error-detail">
            <summary>Last error</summary>
            <pre class="mono">${escapeHtml(issue.lastError)}</pre>
          </details>`
        : "";

      const sessionHtml = expandedSessions.has(issue.id)
        ? `<div class="session-panel" id="session-${escapeHtml(issue.id)}"><div class="session-loading">Loading sessions...</div></div>`
        : "";

      const noteHtml = (issue.state === "Blocked" || issue.state === "Todo")
        ? `<div class="note-form">
            <input type="text" placeholder="Add note for next retry..." data-note-for="${escapeHtml(issue.id)}" />
            <button type="button" class="action-button" data-id="${escapeHtml(issue.id)}" data-action="note">Send</button>
          </div>`
        : "";

      const splitHtml = activeSplitId === issue.id
        ? `<div class="split-form">
            <label class="split-label">Sub-task titles (one per line)</label>
            <textarea data-split-for="${escapeHtml(issue.id)}" rows="3" placeholder="Fix the header layout\nUpdate the unit tests\nAdd error handling"></textarea>
            <div class="split-form-actions">
              <button type="button" class="action-button" data-id="${escapeHtml(issue.id)}" data-action="split-cancel">Cancel</button>
              <button type="button" class="action-button btn-accent" data-id="${escapeHtml(issue.id)}" data-action="split-submit">Create Sub-tasks</button>
            </div>
          </div>`
        : "";

      const editHtml = activeEditId === issue.id ? renderEditForm(issue) : "";

      const deleteHtml = pendingDeleteId === issue.id
        ? `<div class="delete-confirm">
            <span>Delete ${escapeHtml(issue.identifier)}? This cannot be undone.</span>
            <button type="button" class="action-button btn-danger" data-id="${escapeHtml(issue.id)}" data-action="delete-confirm">Confirm Delete</button>
            <button type="button" class="action-button" data-id="${escapeHtml(issue.id)}" data-action="delete-cancel">Cancel</button>
          </div>`
        : "";

      const isRunning = issue.state === "In Progress";

      return `
        <article class="issue-card${isRunning ? " issue-running" : ""}" data-issue-id="${escapeHtml(issue.id)}">
          <h3 class="issue-title">${escapeHtml(issue.identifier)} — ${escapeHtml(issue.title)}</h3>
          <p class="muted">${escapeHtml(issue.description || "No description")}</p>
          <div class="meta">
            <span class="${stateClass(issue.state)}">${escapeHtml(issue.state)}</span>
            ${blockedByHtml}
            <span>Priority ${escapeHtml(issue.priority)}</span>
            <span>Attempts ${escapeHtml(issue.attempts || 0)}/${escapeHtml(issue.maxAttempts || 1)}</span>
            ${issue.durationMs ? `<span>Duration ${formatDuration(issue.durationMs)}</span>` : ""}
          </div>
          <div class="meta">${labels}</div>
          ${(category || overlays) ? `<div class="meta">${category}${overlays}</div>` : ""}
          ${paths ? `<div class="meta">${paths}</div>` : ""}
          <div class="meta">
            <span title="${escapeHtml(formatDate(issue.updatedAt))}">Updated: ${timeAgo(issue.updatedAt)}</span>
            <span>Workspace: ${escapeHtml(issue.workspacePath || "pending")}</span>
          </div>
          ${errorHtml}
          <div class="actions">${issueActions(issue)}</div>
          ${noteHtml}
          ${splitHtml}
          ${editHtml}
          ${deleteHtml}
          ${sessionHtml}
          <ul class="history">${history}</ul>
        </article>
      `;
    })
    .join("");

  for (const issueId of expandedSessions) {
    loadSessionsForIssue(issueId);
  }
}

// ── Session/Pipeline Loading ─────────────────────────────────────────────────

async function loadSessionsForIssue(issueId) {
  const panel = document.getElementById(`session-${issueId}`);
  if (!panel) return;

  try {
    const data = await fetchJSON(`/api/issue/${encodeURIComponent(issueId)}/sessions`);
    let html = "";

    if (data.pipeline) {
      const pipeline = data.pipeline;
      html += '<div class="session-header">Pipeline</div>';
      html += `<div class="pipeline-step">
        <span class="step-provider">attempt ${escapeHtml(pipeline.attempt || "—")}</span>
        <span class="step-status">cycle ${escapeHtml(pipeline.cycle || "—")}</span>
        <span class="step-status">active index ${escapeHtml(pipeline.activeIndex || 0)}</span>
      </div>`;

      if (Array.isArray(pipeline.history) && pipeline.history.length) {
        html += `<details class="history-detail" open>
          <summary>${pipeline.history.length} pipeline events</summary>
          <ul class="history">${pipeline.history.map((entry) => `<li class="mono">${escapeHtml(entry)}</li>`).join("")}</ul>
        </details>`;
      }
    }

    if (data.sessions && Array.isArray(data.sessions) && data.sessions.length) {
      html += '<div class="session-header" style="margin-top:10px">Sessions</div>';
      for (const item of data.sessions.slice(-6)) {
        const session = item.session || {};
        const turns = Array.isArray(session.turns) ? session.turns : [];
        const lastTurn = turns.length ? turns[turns.length - 1] : null;
        html += `<div class="pipeline-step">
          <span class="step-provider">${escapeHtml(`${item.role || "agent"}:${item.provider || "unknown"}`)}</span>
          <span class="step-status">${escapeHtml(session.status || "—")}</span>
          <span class="step-status">cycle ${escapeHtml(item.cycle || "—")}</span>
          <span class="step-status">${escapeHtml(`${turns.length}/${session.maxTurns || "?"} turns`)}</span>
        </div>`;
        if (session.lastDirectiveStatus || session.lastDirectiveSummary) {
          html += `<div class="session-output">${escapeHtml(
            `${session.lastDirectiveStatus || "status"}${session.lastDirectiveSummary ? `: ${session.lastDirectiveSummary}` : ""}`,
          )}</div>`;
        }
        if (lastTurn?.output || session.lastOutput) {
          const output = lastTurn?.output || session.lastOutput || "";
          const truncated = output.length > 2000 ? `…${output.slice(-2000)}` : output;
          html += `<details class="history-detail">
            <summary>Latest output</summary>
            <div class="session-output">${escapeHtml(truncated)}</div>
          </details>`;
        }
        if (turns.length) {
          html += `<details class="history-detail">
            <summary>${turns.length} turns</summary>
            <ul class="history">${turns.map((turn) => `<li class="mono">#${escapeHtml(turn.turn)} ${escapeHtml(turn.directiveStatus || "—")} ${escapeHtml(turn.directiveSummary || "")}</li>`).join("")}</ul>
          </details>`;
        }
      }
    }

    panel.innerHTML = html || '<div class="session-loading">No session data available yet.</div>';
  } catch (error) {
    panel.innerHTML = `<div class="session-loading">Failed to load: ${escapeHtml(error.message)}</div>`;
  }
}

// ── Split Issue ──────────────────────────────────────────────────────────────

function toggleSplitForm(issueId) {
  const issue = (appState.issues || []).find((i) => i.id === issueId);
  if (!issue) return;

  // Close if already open for this issue
  if (activeSplitId === issueId) {
    activeSplitId = null;
    renderIssues(appState.issues || []);
    return;
  }

  activeSplitId = issueId;
  renderIssues(appState.issues || []);

  // Focus the textarea after render
  setTimeout(() => {
    const textarea = document.querySelector(`[data-split-for="${issueId}"]`);
    if (textarea) textarea.focus();
  }, 50);
}

async function submitSplit(issueId) {
  const textarea = document.querySelector(`[data-split-for="${issueId}"]`);
  if (!textarea || !textarea.value.trim()) {
    showToast("Enter at least one sub-task title", "warn");
    return;
  }

  const issue = (appState.issues || []).find((i) => i.id === issueId);
  if (!issue) return;

  const titles = textarea.value.split("\n").map((t) => t.trim()).filter(Boolean);
  if (!titles.length) return;

  try {
    const created = [];
    for (const title of titles) {
      const result = await post("/api/issues", {
        title,
        description: `Sub-task of ${issue.identifier}: ${issue.title}`,
        priority: issue.priority,
        labels: [...(issue.labels || []), `parent:${issue.identifier}`],
        paths: issue.paths || [],
        maxAttempts: issue.maxAttempts || 3,
      });
      if (result.ok && result.issue) created.push(result.issue.identifier);
    }
    activeSplitId = null;
    showToast(`Created ${created.length} sub-tasks: ${created.join(", ")}`, "success");
    await loadState();
  } catch (error) {
    showToast(`Split failed: ${error.message}`);
  }
}

// ── Add Note ─────────────────────────────────────────────────────────────────

async function addNote(issueId) {
  const input = document.querySelector(`[data-note-for="${issueId}"]`);
  if (!input || !input.value.trim()) return;

  const issue = (appState.issues || []).find((i) => i.id === issueId);
  const currentState = issue?.state || "Todo";
  const note = input.value.trim();

  try {
    await post(`/api/issue/${encodeURIComponent(issueId)}/state`, { state: currentState, reason: note });
    input.value = "";
    showToast("Note added", "success", 2000);
    await loadState();
  } catch (error) {
    showToast(`Note failed: ${error.message}`);
  }
}

// ── Runtime Meta ─────────────────────────────────────────────────────────────

function renderRuntimeMeta(state) {
  runtimeMeta.innerHTML = `
    <div class="meta">
      <span>Repository: ${escapeHtml(state.sourceRepoUrl || "local")}</span>
      <span>Workflow: ${escapeHtml(state.workflowPath || "local")}</span>
      <span>Tracker: ${escapeHtml(state.trackerKind || "filesystem")}</span>
      <span>Agent: ${escapeHtml(state.config?.agentProvider || "auto")} (${escapeHtml(state.config?.agentCommand || "auto-detect")})</span>
      <span class="concurrency-control">
        Concurrency:
        <input type="number" id="concurrency-input" min="1" max="16" value="${escapeHtml(state.config?.workerConcurrency ?? 2)}" style="width:48px;padding:2px 4px;font-size:0.72rem;text-align:center" />
        <button type="button" class="action-button" id="save-concurrency-btn" style="font-size:0.7em">Set</button>
      </span>
    </div>
    <div id="providers-panel" class="meta" style="margin-top:4px"></div>
    <div id="parallelism-panel" class="meta" style="margin-top:4px"></div>
    <p class="muted">Started at ${formatDate(state.startedAt)}</p>
  `;

  document.getElementById("save-concurrency-btn")?.addEventListener("click", async () => {
    const input = document.getElementById("concurrency-input");
    const num = parseInt(input?.value, 10);
    if (!num || num < 1 || num > 16) { showToast("Must be 1-16", "warn"); return; }
    try {
      await post("/api/config/concurrency", { concurrency: num });
      showToast(`Concurrency set to ${num}`, "success");
      await loadState();
    } catch (e) { showToast(e.message); }
  });

  loadProviders();
  loadParallelism();
}

async function loadProviders() {
  const panel = document.getElementById("providers-panel");
  if (!panel) return;
  try {
    const data = await fetchJSON("/api/providers");
    if (!data.providers || !data.providers.length) { panel.innerHTML = ""; return; }
    panel.innerHTML = "Providers: " + data.providers.map((p) =>
      `<span class="tag ${p.available ? "tag-ok" : "tag-missing"}">${escapeHtml(p.name)}: ${p.available ? "available" : "not found"}</span>`
    ).join(" ");
  } catch { panel.innerHTML = ""; }
}

async function loadParallelism() {
  const panel = document.getElementById("parallelism-panel");
  if (!panel) return;
  try {
    const data = await fetchJSON("/api/parallelism");
    if (!data.reason) { panel.innerHTML = ""; return; }
    const badge = data.canParallelize ? "tag-ok" : "tag-missing";
    panel.innerHTML = `Parallelism: <span class="tag ${badge}">max safe=${data.maxSafeParallelism}</span> <span class="muted">${escapeHtml(data.reason)}</span>`;
  } catch { panel.innerHTML = ""; }
}

// ── Events ───────────────────────────────────────────────────────────────────

let allEvents = [];

function renderEvents(events = []) {
  // Merge new events (dedup, cap at 200)
  if (events.length) {
    const seen = new Set(allEvents.map((e) => e.at + e.issueId + e.message));
    for (const e of events) {
      if (!seen.has(e.at + e.issueId + e.message)) allEvents.unshift(e);
    }
    if (allEvents.length > 200) allEvents.length = 200;
  }

  // Issue filter is populated by loadState() — no need to duplicate here

  if (!allEvents.length) {
    eventsEl.innerHTML = '<p class="muted">No events yet.</p>';
    return;
  }

  // Filtering is done server-side via loadEvents() params, but apply client-side too for instant feedback
  const kindFilter = eventKindFilter?.value || "all";
  const issueFilter = eventIssueFilter?.value || "all";

  const filtered = allEvents.filter((e) => {
    if (kindFilter !== "all" && (e.kind || "info") !== kindFilter) return false;
    if (issueFilter !== "all" && e.issueId !== issueFilter) return false;
    return true;
  });

  if (!filtered.length) {
    eventsEl.innerHTML = '<p class="muted">No events match this filter.</p>';
    return;
  }

  const hadEvents = eventsEl.children.length > 0;
  eventsEl.innerHTML = filtered
    .slice(0, 80)
    .map((event) => `
      <div class="event event-${event.kind || "info"}">
        <div class="mono">${escapeHtml(event.at)} ${escapeHtml(event.issueId || "system")}</div>
        <div>${escapeHtml(event.message || "")}</div>
      </div>
    `)
    .join("");

  // Auto-scroll to top when new events arrive
  if (events.length && hadEvents) eventsEl.scrollTop = 0;
}

// ── State Management ─────────────────────────────────────────────────────────

async function setIssueState(issueId, nextState) {
  await post(`/api/issue/${encodeURIComponent(issueId)}/state`, { state: nextState });
  await loadState();
}

async function retryIssue(issueId) {
  await post(`/api/issue/${encodeURIComponent(issueId)}/retry`);
  await loadState();
}

async function cancelIssue(issueId) {
  await post(`/api/issue/${encodeURIComponent(issueId)}/cancel`);
  await loadState();
}

// ── Create Issue ─────────────────────────────────────────────────────────────

function toggleCreateForm() {
  createForm.hidden = !createForm.hidden;
  if (!createForm.hidden) document.getElementById("cf-title").focus();
}

async function submitCreateForm() {
  const title = document.getElementById("cf-title").value.trim();
  if (!title) { showToast("Title is required", "warn"); return; }

  const payload = {
    title,
    description: document.getElementById("cf-desc").value.trim(),
    priority: Number(document.getElementById("cf-priority").value) || 1,
    maxAttempts: Number(document.getElementById("cf-attempts").value) || 3,
    labels: document.getElementById("cf-labels").value.split(",").map((s) => s.trim()).filter(Boolean),
    paths: document.getElementById("cf-paths").value.split(",").map((s) => s.trim()).filter(Boolean),
  };

  try {
    const result = await post("/api/issues", payload);
    showToast(`Created ${result.issue?.identifier || "issue"}`, "success");
    createForm.hidden = true;
    document.getElementById("cf-title").value = "";
    document.getElementById("cf-desc").value = "";
    document.getElementById("cf-priority").value = "1";
    document.getElementById("cf-attempts").value = "3";
    document.getElementById("cf-labels").value = "";
    document.getElementById("cf-paths").value = "";
    await loadState();
  } catch (error) {
    showToast(`Create failed: ${error.message}`);
  }
}

// ── Edit / Delete ────────────────────────────────────────────────────────────

let activeEditId = null;
let pendingDeleteId = null;

function toggleEditForm(issueId) {
  activeEditId = activeEditId === issueId ? null : issueId;
  renderIssues(appState.issues || []);
  if (activeEditId) {
    setTimeout(() => {
      const el = document.querySelector(`[data-edit-title-for="${issueId}"]`);
      if (el) el.focus();
    }, 50);
  }
}

function renderEditForm(issue) {
  return `
    <div class="edit-form">
      <div class="create-form-grid">
        <div class="form-group span-2">
          <label>Title</label>
          <input data-edit-title-for="${escapeHtml(issue.id)}" type="text" value="${escapeHtml(issue.title)}" />
        </div>
        <div class="form-group span-2">
          <label>Description</label>
          <textarea data-edit-desc-for="${escapeHtml(issue.id)}" rows="2">${escapeHtml(issue.description || "")}</textarea>
        </div>
        <div class="form-group">
          <label>Priority (1-10)</label>
          <input data-edit-priority-for="${escapeHtml(issue.id)}" type="number" min="1" max="10" value="${escapeHtml(issue.priority)}" />
        </div>
        <div class="form-group">
          <label>Labels <span class="hint">comma-separated</span></label>
          <input data-edit-labels-for="${escapeHtml(issue.id)}" type="text" value="${escapeHtml((issue.labels || []).join(", "))}" />
        </div>
        <div class="form-group span-2">
          <label>Paths <span class="hint">comma-separated</span></label>
          <input data-edit-paths-for="${escapeHtml(issue.id)}" type="text" value="${escapeHtml((issue.paths || []).join(", "))}" />
        </div>
        <div class="form-group span-2">
          <label>Blocked by <span class="hint">comma-separated issue IDs</span></label>
          <input data-edit-blocked-for="${escapeHtml(issue.id)}" type="text" value="${escapeHtml((issue.blockedBy || []).join(", "))}" />
        </div>
      </div>
      <div class="create-form-actions">
        <button type="button" class="action-button" data-id="${escapeHtml(issue.id)}" data-action="edit-cancel">Cancel</button>
        <button type="button" class="action-button btn-accent" data-id="${escapeHtml(issue.id)}" data-action="edit-submit">Save</button>
      </div>
    </div>
  `;
}

async function submitEdit(issueId) {
  const get = (attr) => document.querySelector(`[data-edit-${attr}-for="${issueId}"]`);
  const titleEl = get("title");
  if (!titleEl) return;

  try {
    const response = await fetch(`/api/issues/${encodeURIComponent(issueId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: titleEl.value.trim() || undefined,
        description: get("desc")?.value.trim() ?? "",
        priority: Math.max(1, Math.min(10, parseInt(get("priority")?.value, 10) || 1)),
        labels: (get("labels")?.value || "").split(",").map((s) => s.trim()).filter(Boolean),
        paths: (get("paths")?.value || "").split(",").map((s) => s.trim()).filter(Boolean),
        blockedBy: (get("blocked")?.value || "").split(",").map((s) => s.trim()).filter(Boolean),
      }),
    });
    if (!response.ok) throw new Error(`Failed: ${response.status}`);
    activeEditId = null;
    showToast("Issue updated", "success");
    await loadState();
  } catch (e) {
    showToast(`Edit failed: ${e.message}`);
  }
}

function requestDelete(issueId) {
  pendingDeleteId = pendingDeleteId === issueId ? null : issueId;
  renderIssues(appState.issues || []);
}

async function confirmDelete(issueId) {
  try {
    const response = await fetch(`/api/issues/${encodeURIComponent(issueId)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(`Failed: ${response.status}`);
    const issue = (appState.issues || []).find((i) => i.id === issueId);
    pendingDeleteId = null;
    showToast(`Deleted ${issue?.identifier || issueId}`, "success");
    await loadState();
  } catch (e) {
    pendingDeleteId = null;
    showToast(`Delete failed: ${e.message}`);
  }
}

// ── Wire Actions ─────────────────────────────────────────────────────────────

function wireActions() {
  issueListEl.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;

    const action = target.dataset.action;
    const id = target.dataset.id;
    const payload = target.dataset.payload || "";
    if (!action || !id) return;

    try {
      if (action === "state") await setIssueState(id, payload);
      else if (action === "retry") await retryIssue(id);
      else if (action === "cancel") await cancelIssue(id);
      else if (action === "sessions") {
        if (expandedSessions.has(id)) expandedSessions.delete(id);
        else expandedSessions.add(id);
        renderIssues(appState.issues || []);
      }
      else if (action === "split") toggleSplitForm(id);
      else if (action === "split-submit") await submitSplit(id);
      else if (action === "split-cancel") { activeSplitId = null; renderIssues(appState.issues || []); }
      else if (action === "note") await addNote(id);
      else if (action === "edit") toggleEditForm(id);
      else if (action === "edit-submit") await submitEdit(id);
      else if (action === "edit-cancel") { activeEditId = null; renderIssues(appState.issues || []); }
      else if (action === "delete") requestDelete(id);
      else if (action === "delete-confirm") await confirmDelete(id);
      else if (action === "delete-cancel") { pendingDeleteId = null; renderIssues(appState.issues || []); }
    } catch (error) {
      showToast(error.message || "Action failed.");
    }
  });

  issueListEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.dataset.noteFor) {
      addNote(event.target.dataset.noteFor);
    }
  });

  rerunBtn?.addEventListener("click", () => loadState());
  clearEventsBtn?.addEventListener("click", () => {
    allEvents = [];
    lastEventTimestamp = "";
    eventsEl.innerHTML = '<p class="muted">Event history cleared.</p>';
  });

  newIssueBtn?.addEventListener("click", toggleCreateForm);
  document.getElementById("cf-cancel")?.addEventListener("click", () => { createForm.hidden = true; });
  document.getElementById("cf-submit")?.addEventListener("click", submitCreateForm);
  document.getElementById("cf-title")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitCreateForm();
  });
}

// ── Data Loading ─────────────────────────────────────────────────────────────

async function loadEvents() {
  try {
    const params = new URLSearchParams();
    if (lastEventTimestamp) params.set("since", lastEventTimestamp);
    if (eventKindFilter?.value && eventKindFilter.value !== "all") params.set("kind", eventKindFilter.value);
    if (eventIssueFilter?.value && eventIssueFilter.value !== "all") params.set("issueId", eventIssueFilter.value);
    const query = params.size > 0 ? `?${params.toString()}` : "";
    const payload = await fetchJSON(`/api/events${query}`);
    const events = Array.isArray(payload.events) ? payload.events : [];

    if (events.length > 0) {
      const latest = events[0];
      if (latest && latest.at) lastEventTimestamp = latest.at;
    }

    renderEvents(events);
  } catch (error) {
    // ignore intermittent polling errors
  }
}

async function loadState() {
  const payload = await fetchJSON("/api/state");

  // Diff: skip re-render if nothing changed
  const hash = simpleHash(JSON.stringify(payload.issues) + JSON.stringify(payload.metrics));
  if (hash === lastStateHash) {
    refreshBadge.textContent = `refresh: ${new Date().toLocaleTimeString()}`;
    return;
  }
  lastStateHash = hash;

  appState = payload;
  const issues = Array.isArray(payload.issues) ? payload.issues : [];
  if (eventIssueFilter) {
    const previousValue = eventIssueFilter.value || "all";
    const options = [
      { value: "all", label: "All" },
      ...issues
        .map((issue) => ({ value: issue.id, label: issue.identifier || issue.id }))
        .filter((entry) => entry.value)
        .sort((a, b) => String(a.label).localeCompare(String(b.label))),
    ];
    eventIssueFilter.innerHTML = options
      .map((entry) => `<option value="${escapeHtml(entry.value)}">${escapeHtml(entry.label)}</option>`)
      .join("");
    eventIssueFilter.value = options.some((entry) => entry.value === previousValue) ? previousValue : "all";
  }
  renderOverview(payload.metrics || {}, issues);
  renderIssues(issues);
  renderRuntimeMeta(payload);

  const sourceRepo = (payload.sourceRepoUrl || "local").toString().split("/").slice(-1)[0] || "local";
  subtitle.textContent = `Runtime local: ${sourceRepo}`;
  refreshBadge.textContent = `refresh: ${new Date(payload.updatedAt || Date.now()).toLocaleTimeString()}`;
}

async function loadHealth() {
  try {
    const payload = await fetchJSON("/api/health");
    healthBadge.textContent = `status: ${payload.status || "ok"}`;
  } catch (error) {
    healthBadge.textContent = "status: offline";
  }
}

async function refreshSessions() {
  // Auto-refresh expanded session panels for running issues
  for (const issueId of expandedSessions) {
    const issue = (appState.issues || []).find((i) => i.id === issueId);
    if (issue && (issue.state === "In Progress" || issue.state === "In Review")) {
      loadSessionsForIssue(issueId);
    }
  }
}

async function refresh() {
  refreshBadge.classList.add("badge-refreshing");
  try {
    await loadState();
    await loadEvents();
    await refreshSessions();
  } catch (error) {
    issueListEl.innerHTML = `<p class="muted">Error loading runtime state: ${escapeHtml(error.message || error)}</p>`;
  } finally {
    refreshBadge.classList.remove("badge-refreshing");
  }
}

// ── Filters ──────────────────────────────────────────────────────────────────

stateFilter.addEventListener("change", () => renderIssues(appState.issues || []));
categoryFilter?.addEventListener("change", () => renderIssues(appState.issues || []));
queryInput.addEventListener("input", () => renderIssues(appState.issues || []));
eventKindFilter?.addEventListener("change", async () => {
  allEvents = [];
  lastEventTimestamp = "";
  await loadEvents();
});
eventIssueFilter?.addEventListener("change", async () => {
  allEvents = [];
  lastEventTimestamp = "";
  await loadEvents();
});

// ── Keyboard shortcuts ───────────────────────────────────────────────────

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  // Close create form
  if (!createForm.hidden) {
    createForm.hidden = true;
    return;
  }

  // Close edit form
  if (activeEditId !== null) {
    activeEditId = null;
    renderIssues(appState.issues || []);
    return;
  }

  // Close delete confirm
  if (pendingDeleteId !== null) {
    pendingDeleteId = null;
    renderIssues(appState.issues || []);
    return;
  }

  // Close split form
  if (activeSplitId !== null) {
    activeSplitId = null;
    renderIssues(appState.issues || []);
    return;
  }

  // Collapse all sessions
  if (expandedSessions.size > 0) {
    expandedSessions.clear();
    renderIssues(appState.issues || []);
  }
});

// ── Boot ─────────────────────────────────────────────────────────────────────

loadEvents();
wireActions();
loadHealth();
refresh();
setInterval(() => { refresh(); loadHealth(); }, 3000);
