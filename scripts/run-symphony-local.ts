#!/usr/bin/env node
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { extname, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env, exit, argv } from "node:process";
import { homedir } from "node:os";

type JsonRecord = Record<string, unknown>;

type IssueEntry = {
  id: string;
  identifier: string;
  title: string;
  description: string;
  priority: number;
  state: string;
  branchName?: string;
  url?: string;
  assigneeId?: string;
  labels: string[];
  blockedBy: string[];
  assignedToWorker: boolean;
  createdAt?: string;
  updatedAt?: string;
  history: string[];
};

type RuntimeState = {
  startedAt: string;
  trackerKind: string;
  workflowPath: string;
  sourceRepoUrl: string;
  sourceRef: string;
  dashboardPort?: string;
  issues: IssueEntry[];
  notes: string[];
};

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(__filename);
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

const TRACKER_KIND = env.SYMPHONY_TRACKER_KIND ?? "memory";
const STATE_ROOT = env.SYMPHONY_BOOTSTRAP_ROOT ?? `${homedir()}/.local/share/symphony-aozo`;
const SOURCE_ROOT = `${STATE_ROOT}/aozo-source`;
const SOURCE_MARKER = `${SOURCE_ROOT}/.symphony-local-source-ready`;
const WORKFLOW_TEMPLATE = `${REPO_ROOT}/WORKFLOW.md`;
const WORKFLOW_RENDERED = `${STATE_ROOT}/WORKFLOW.local.md`;
const STATE_DUMP = `${STATE_ROOT}/symphony-memory-state.json`;
const LOCAL_ISSUES_FILE = env.SYMPHONY_MEMORY_ISSUES_FILE ?? `${SCRIPT_DIR}/symphony-local-issues.json`;
const DEFAULT_ISSUES_FILE = `${SCRIPT_DIR}/symphony-local-issues.json`;
const FRONTEND_DIR = `${SCRIPT_DIR}/symphony-dashboard`;
const FRONTEND_INDEX = `${FRONTEND_DIR}/index.html`;
const FRONTEND_APP_JS = `${FRONTEND_DIR}/app.js`;
const FRONTEND_STYLES_CSS = `${FRONTEND_DIR}/styles.css`;

const ALLOWED_STATES = new Set(["Todo", "In Progress", "In Review", "Blocked", "Done", "Cancelled"]);

if (TRACKER_KIND !== "memory") {
  console.error("SYMPHONY_TRACKER_KIND precisa ser 'memory' para este fork. Linear não é utilizado.");
  console.error("Defina SYMPHONY_TRACKER_KIND=memory e rode novamente.");
  exit(1);
}

mkdirSync(STATE_ROOT, { recursive: true });

function fail(message: string): never {
  console.error(message);
  exit(1);
}

function log(message: string) {
  const time = new Date().toISOString();
  console.log(`[${time}] ${message}`);
}

function normalizeState(value: unknown): string {
  if (typeof value === "string" && ALLOWED_STATES.has(value)) {
    return value;
  }
  return "Todo";
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function toNumberValue(value: unknown, fallback = 1): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.round(value));
  }
  return fallback;
}

function toBooleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function now() {
  return new Date().toISOString();
}

function bootstrapSource() {
  if (existsSync(SOURCE_MARKER)) {
    return;
  }

  log("Criando snapshot local da workspace para o Symphony (modo local-only)...");

  const SKIP_DIRS = new Set([
    ".git",
    "node_modules",
    ".venv",
    "data",
    "app/data",
    "app/dist",
    "app/.tanstack",
    "app-builder/node_modules",
    "apk-pull",
    "mobile-assets",
    "pcap-archive",
    "lua-extract",
    "locale-extract",
  ]);

  const shouldSkip = (relPath: string) => {
    const parts = relPath.split("/");
    if (parts.some((segment) => SKIP_DIRS.has(segment))) {
      return true;
    }

    const base = relPath.split("/").at(-1) ?? "";
    if (base.startsWith("map_scan_") && extname(base) === ".json") {
      return true;
    }

    if (extname(base) === ".xlsx") {
      return true;
    }

    return false;
  };

  const copyRecursive = (source: string, target: string, rel = "") => {
    mkdirSync(target, { recursive: true });
    const items = readdirSync(source, { withFileTypes: true });

    for (const item of items) {
      const nextRel = rel ? `${rel}/${item.name}` : item.name;
      if (shouldSkip(nextRel)) {
        continue;
      }

      const sourcePath = `${source}/${item.name}`;
      const targetPath = `${target}/${item.name}`;
      const stat = statSync(sourcePath);

      if (item.isDirectory()) {
        copyRecursive(sourcePath, targetPath, nextRel);
        continue;
      }

      if (item.isSymbolicLink()) {
        continue;
      }

      if (stat.isFile() || stat.isFIFO()) {
        try {
          const contents = readFileSync(sourcePath);
          writeFileSync(targetPath, contents);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            log(`Arquivo ausente ignorado: ${sourcePath}`);
            return;
          }
          throw error;
        }
      }
    }
  };

  mkdirSync(SOURCE_ROOT, { recursive: true });
  copyRecursive(REPO_ROOT, SOURCE_ROOT);
  writeFileSync(SOURCE_MARKER, `${now()}\n`);
}

function renderWorkflow() {
  const text = readFileSync(WORKFLOW_TEMPLATE, "utf8");
  const withTracker = text.replace(/kind:\s*linear/g, "kind: memory");
  const rendered = withTracker.replace(/project_slug:\s*".*?"/, 'project_slug: ""');

  writeFileSync(WORKFLOW_RENDERED, rendered);
  return rendered;
}

function parsePort(args: string[]) {
  let port = "";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help") {
      console.log("Usage: run-symphony-local.ts [--port <n>]");
      exit(0);
    }

    if (arg === "--port") {
      const value = args[i + 1] ?? "";
      if (!/^\d+$/.test(value)) {
        fail(`Valor inválido para --port: ${value}.`);
      }
      port = value;
      return port;
    }

    fail(`Argumento desconhecido: ${arg}`);
  }

  return port;
}

function ensureIssuesSource(pathOrInline: string, inline = false) {
  if (inline) {
    writeFileSync(LOCAL_ISSUES_FILE, `${pathOrInline}\n`, { flag: "w" });
    return;
  }

  if (existsSync(pathOrInline)) {
    return;
  }

  if (!existsSync(DEFAULT_ISSUES_FILE)) {
    fail(`Arquivo default de issues não encontrado: ${DEFAULT_ISSUES_FILE}`);
  }

  cpSync(DEFAULT_ISSUES_FILE, pathOrInline, { force: true });
}

function normalizeIssue(raw: JsonRecord): IssueEntry | null {
  const id = toStringValue(raw.id, "") || toStringValue(raw.identifier, "");
  if (!id) {
    return null;
  }

  return {
    id,
    identifier: toStringValue(raw.identifier, id),
    title: toStringValue(raw.title, `Issue ${id}`),
    description: toStringValue(raw.description, ""),
    priority: toNumberValue(raw.priority, 1),
    state: normalizeState(raw.state),
    branchName: toStringValue(raw.branch_name) || toStringValue(raw.branchName),
    url: toStringValue(raw.url),
    assigneeId: toStringValue(raw.assignee_id),
    labels: toStringArray(raw.labels),
    blockedBy: toStringArray(raw.blocked_by),
    assignedToWorker: toBooleanValue(raw.assigned_to_worker, true),
    createdAt: toStringValue(raw.created_at),
    updatedAt: toStringValue(raw.updated_at),
    history: [],
  };
}

function loadIssues(): IssueEntry[] {
  const inlineJson = env.SYMPHONY_MEMORY_ISSUES_JSON;
  if (inlineJson) {
    ensureIssuesSource(inlineJson, true);
  }

  ensureIssuesSource(LOCAL_ISSUES_FILE);
  const raw = readFileSync(LOCAL_ISSUES_FILE, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`Erro parseando JSON de issues: ${String(error)}`);
  }

  if (!Array.isArray(parsed)) {
    fail("SYMPHONY_MEMORY_ISSUES precisa ser um array JSON.");
  }

  const issues = parsed
    .map((item): IssueEntry | null => {
      if (!item || typeof item !== "object") {
        return null;
      }

      return normalizeIssue(item as JsonRecord);
    })
    .filter((issue): issue is IssueEntry => issue !== null);

  if (issues.length === 0) {
    fail("Nenhuma issue local disponível para executar.");
  }

  return issues;
}

function transition(issue: IssueEntry, toState: string, note: string) {
  issue.state = toState;
  issue.updatedAt = now();
  issue.history.push(`[${issue.updatedAt}] ${note}`);
}

function executeWorkflow(issues: IssueEntry[]) {
  for (const issue of issues) {
    transition(issue, "In Progress", `Iniciando processamento local: ${issue.title}`);
    transition(issue, "Done", "Processo Codex local concluído sem execução remota.");
  }
}

function persistState(state: RuntimeState) {
  writeFileSync(STATE_DUMP, JSON.stringify(state, null, 2));
}

function readFrontendFile(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException).code;
    if (errno === "ENOENT" || errno === "EISDIR") {
      return "";
    }
    throw error;
  }
}

function serveText(res: import("node:http").ServerResponse, contentType: string, text: string) {
  res.statusCode = 200;
  res.setHeader("content-type", contentType);
  res.end(text);
}

function startDashboard(state: RuntimeState, port: number) {
  const indexHtml = readFrontendFile(FRONTEND_INDEX);
  const appJs = readFrontendFile(FRONTEND_APP_JS);
  const stylesCss = readFrontendFile(FRONTEND_STYLES_CSS);

  const dashboardFallback = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Symphony Local</title>
    <style>
      body { font-family: Inter, system-ui, sans-serif; padding: 20px; background: #0b1020; color: #d1d5db; }
    </style>
  </head>
  <body>
    <h1>Symphony Local (TypeScript)</h1>
    <p>Frontend não encontrado no diretório scripts/symphony-dashboard. Usando view de fallback.</p>
    <p>Estado: ${state.startedAt}</p>
    <p>Issues: ${state.issues.length}</p>
  </body>
</html>
`.trim();

  const server = createServer((req, res) => {
    const reqUrl = new URL(req.url ?? "/", `http://localhost:${port}`);
    const path = reqUrl.pathname;

    const json = (code: number, payload: unknown) => {
      const body = JSON.stringify(payload, null, 2);
      res.statusCode = code;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(body);
    };

    const method = req.method ?? "GET";
    if (path === "/api/state" && method === "GET") {
      json(200, state);
      return;
    }

    if (path === "/api/issues" && method === "GET") {
      json(200, { issues: state.issues });
      return;
    }

    if (path === "/api/health" && method === "GET") {
      json(200, {
        status: "ok",
        startedAt: state.startedAt,
        trackerKind: state.trackerKind,
      });
      return;
    }

    if (path === "/" || path === "/index.html") {
      if (method !== "GET") {
        res.statusCode = 405;
        res.end("Method Not Allowed");
        return;
      }

      serveText(res, "text/html; charset=utf-8", indexHtml || dashboardFallback);
      return;
    }

    if (path === "/assets/app.js") {
      if (method !== "GET") {
        res.statusCode = 405;
        res.end("Method Not Allowed");
        return;
      }

      if (!appJs) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }

      serveText(res, "application/javascript; charset=utf-8", appJs);
      return;
    }

    if (path === "/assets/styles.css") {
      if (method !== "GET") {
        res.statusCode = 405;
        res.end("Method Not Allowed");
        return;
      }

      if (!stylesCss) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }

      serveText(res, "text/css; charset=utf-8", stylesCss);
      return;
    }

    if (path === "/state" && method === "GET") {
      res.statusCode = 301;
      res.setHeader("location", "/api/state");
      res.end();
      return;
    }

    if (path.startsWith("/api/issue/") && path.endsWith("/state") && method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });

      req.on("end", () => {
        let payload: JsonRecord;
        try {
          payload = JSON.parse(body || "{}");
        } catch {
          json(400, { ok: false, error: "JSON inválido" });
          return;
        }

        const newState = normalizeState((payload.state as unknown) || "Todo");
        const issueId = path.split("/")[3];
        const issue = state.issues.find((entry) => entry.id === issueId || entry.identifier === issueId);

        if (!issue) {
          json(404, { ok: false, error: "Issue não encontrada" });
          return;
        }

        transition(issue, newState, `Estado alterado manualmente para ${newState}.`);
        persistState(state);
        json(200, { ok: true, issue });
      });
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  server.listen(port, () => {
    log(`Dashboard local disponível em http://localhost:${port}`);
    log("Endpoint de estado: /api/state");
  });
}

function main() {
  const port = parsePort(argv.slice(2));

  bootstrapSource();
  const rendered = renderWorkflow();

  const issues = loadIssues();
  const state: RuntimeState = {
    startedAt: now(),
    trackerKind: "memory",
    workflowPath: WORKFLOW_RENDERED,
    sourceRepoUrl: SOURCE_ROOT,
    sourceRef: "main",
    issues,
    notes: [
      "Runtime TypeScript local iniciado. Sem dependências externas de tracker.",
      `Workflow renderizado a partir de ${WORKFLOW_TEMPLATE}.`,
      `Usando issues de ${LOCAL_ISSUES_FILE}.`,
    ],
  };

  if (rendered.includes("kind: linear")) {
    fail("Falha interna: não foi possível forçar o modo memory no workflow renderizado.");
  }

  executeWorkflow(state.issues);
  state.startedAt = now();
  persistState(state);

  appendFileSync(
    `${STATE_ROOT}/symphony-local.log`,
    `${now()} [symphony-local-ts] workflow renderizado: ${WORKFLOW_RENDERED}\n${now()} [symphony-local-ts] issues processadas: ${state.issues.length}\n`,
  );

  log(`Workflow local renderizado: ${WORKFLOW_RENDERED}`);
  log(`Issues processadas: ${state.issues.length}`);
  log(`Estado final em arquivo: ${STATE_DUMP}`);

  if (!port) {
    log("Execução local concluída. Nada mais a fazer sem dashboard.");
    return;
  }

  state.dashboardPort = port;
  startDashboard(state, Number(port));
}

main();
