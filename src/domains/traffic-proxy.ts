import type {
  TrafficEntry,
  ServiceGraphEdge,
  ServiceGraph,
  ServiceStatus,
} from "../types.ts";

// ── Ring Buffer ──────────────────────────────────────────────────

export class TrafficRingBuffer {
  private buf: TrafficEntry[];
  private head = 0;
  private count = 0;

  constructor(private capacity: number = 1000) {
    this.buf = new Array(capacity);
  }

  push(entry: TrafficEntry): void {
    this.buf[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  getAll(): TrafficEntry[] {
    if (this.count === 0) return [];
    if (this.count < this.capacity) return this.buf.slice(0, this.count);
    // wrap around: older entries start after head
    return [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)];
  }

  getRecent(n: number): TrafficEntry[] {
    const all = this.getAll();
    return n >= all.length ? all : all.slice(-n);
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }
}

// ── Service Graph Accumulator ────────────────────────────────────

type EdgeKey = string; // "source:target"
type LatencyBucket = { sum: number; count: number; values: number[] };

function edgeKey(source: string, target: string): EdgeKey {
  return `${source}\0${target}`;
}

const MAX_TOP_PATHS = 5;
const MAX_P95_SAMPLES = 200;

export class ServiceGraphAccumulator {
  private edges = new Map<
    EdgeKey,
    {
      source: string;
      target: string;
      requestCount: number;
      errorCount: number;
      latency: LatencyBucket;
      lastSeenAt: string;
      pathCounts: Map<string, number>;
    }
  >();
  private totalRequests = 0;
  capturedSince: string = new Date().toISOString();

  record(entry: TrafficEntry): void {
    const src = entry.sourceServiceId ?? "unknown";
    const tgt = entry.targetServiceId ?? "external";
    const key = edgeKey(src, tgt);
    this.totalRequests++;

    let edge = this.edges.get(key);
    if (!edge) {
      edge = {
        source: src,
        target: tgt,
        requestCount: 0,
        errorCount: 0,
        latency: { sum: 0, count: 0, values: [] },
        lastSeenAt: entry.startedAt,
        pathCounts: new Map(),
      };
      this.edges.set(key, edge);
    }

    edge.requestCount++;
    if (entry.statusCode >= 400 || entry.error) edge.errorCount++;
    edge.latency.sum += entry.durationMs;
    edge.latency.count++;
    // keep a sliding window for p95
    if (edge.latency.values.length >= MAX_P95_SAMPLES) edge.latency.values.shift();
    edge.latency.values.push(entry.durationMs);
    edge.lastSeenAt = entry.startedAt;
    edge.pathCounts.set(entry.path, (edge.pathCounts.get(entry.path) ?? 0) + 1);
  }

  getGraph(services: ServiceStatus[]): ServiceGraph {
    const nodes = services.map((s) => ({
      id: s.id,
      name: s.name,
      state: s.state,
      port: s.port,
    }));

    const edges: ServiceGraphEdge[] = [];
    for (const e of this.edges.values()) {
      const sorted = [...e.latency.values].sort((a, b) => a - b);
      const p95Idx = Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1);
      const topPaths = [...e.pathCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_TOP_PATHS)
        .map(([path, count]) => ({ path, count }));

      edges.push({
        source: e.source,
        target: e.target,
        requestCount: e.requestCount,
        errorCount: e.errorCount,
        avgLatencyMs: e.latency.count > 0 ? Math.round(e.latency.sum / e.latency.count) : 0,
        p95LatencyMs: sorted.length > 0 ? sorted[p95Idx] : 0,
        lastSeenAt: e.lastSeenAt,
        topPaths,
      });
    }

    return {
      nodes,
      edges,
      capturedSince: this.capturedSince,
      totalRequests: this.totalRequests,
    };
  }

  reset(): void {
    this.edges.clear();
    this.totalRequests = 0;
    this.capturedSince = new Date().toISOString();
  }
}

// ── Source / Target Resolution ────────────────────────────────────

export function extractServiceIdFromProxyAuth(
  headers: Record<string, string>,
): string | null {
  const auth = headers["proxy-authorization"];
  if (!auth) return null;
  // Basic base64(username:password)
  const match = auth.match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    return colon > 0 ? decoded.slice(0, colon) : decoded;
  } catch {
    return null;
  }
}

export function resolveTargetService(
  url: string,
  services: ServiceStatus[],
): string | null {
  try {
    const parsed = new URL(url);
    const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
    const match = services.find((s) => s.port === port);
    return match?.id ?? null;
  } catch {
    return null;
  }
}

// ── Proxy Env Helpers ────────────────────────────────────────────

export function buildProxyEnvVars(
  proxyPort: number,
  serviceId: string,
  dashboardPort: number,
): Record<string, string> {
  const proxyUrl = `http://${encodeURIComponent(serviceId)}:fifony@localhost:${proxyPort}`;
  return {
    HTTP_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    NO_PROXY: `localhost:${dashboardPort}`,
    no_proxy: `localhost:${dashboardPort}`,
  };
}

// ── Traffic Entry Builder ────────────────────────────────────────

let entrySeq = 0;

export function buildTrafficEntry(
  method: string,
  url: string,
  requestSize: number,
  statusCode: number,
  responseSize: number,
  sourceServiceId: string | null,
  targetServiceId: string | null,
  startTime: number,
  error?: string,
): TrafficEntry {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }

  return {
    id: `tr_${Date.now()}_${++entrySeq}`,
    sourceServiceId,
    targetServiceId,
    method,
    url,
    path,
    statusCode,
    requestSize,
    responseSize,
    startedAt: new Date(startTime).toISOString(),
    durationMs: Date.now() - startTime,
    error,
  };
}
