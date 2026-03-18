import { env } from "node:process";
import { getRuntimeSnapshot } from "./database.js";

export async function resolveApiBaseUrl(): Promise<string> {
  const envPort = env.FIFONY_API_PORT;
  if (envPort) return `http://localhost:${envPort}`;

  const runtime = await getRuntimeSnapshot();
  const config = runtime.config as Record<string, unknown> | undefined;
  const port = config?.dashboardPort;
  if (port) return `http://localhost:${port}`;

  // Fallback: try common ports
  for (const candidate of [4000, 3000, 8080]) {
    try {
      const res = await fetch(`http://localhost:${candidate}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return `http://localhost:${candidate}`;
    } catch {}
  }

  throw new Error("Fifony runtime API is not reachable. Start the runtime with --port to enable plan/refine/approve/analytics tools.");
}

export async function apiPost(path: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const base = await resolveApiBaseUrl();
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json() as Record<string, unknown>;
  if (!res.ok || json.ok === false) {
    throw new Error(typeof json.error === "string" ? json.error : `API request failed: ${res.status}`);
  }
  return json;
}

export async function apiGet(path: string): Promise<Record<string, unknown>> {
  const base = await resolveApiBaseUrl();
  const res = await fetch(`${base}${path}`, {
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json() as Record<string, unknown>;
  if (!res.ok || json.ok === false) {
    throw new Error(typeof json.error === "string" ? json.error : `API request failed: ${res.status}`);
  }
  return json;
}
