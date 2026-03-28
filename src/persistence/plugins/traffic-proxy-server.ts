import { createServer, type Server } from "node:http";
import {
  createHttpForwardProxy,
  type HttpForwardProxy,
  type ProxyStats,
} from "raffel";
import { logger } from "../../concerns/logger.ts";
import {
  TrafficRingBuffer,
  ServiceGraphAccumulator,
  extractServiceIdFromProxyAuth,
  resolveTargetService,
  buildTrafficEntry,
} from "../../domains/traffic-proxy.ts";
import type { TrafficEntry, ServiceGraph, ServiceStatus } from "../../types.ts";

// ── Singleton state ──────────────────────────────────────────────

let server: Server | null = null;
let proxy: HttpForwardProxy | null = null;
let buffer: TrafficRingBuffer | null = null;
let graph: ServiceGraphAccumulator | null = null;
let boundPort: number | null = null;

type OnEntryFn = (entry: TrafficEntry) => void;
let onEntryCallback: OnEntryFn | null = null;

// Accessor for services list — injected externally to avoid importing persistence
let servicesAccessor: (() => ServiceStatus[]) | null = null;

export function setServicesAccessor(fn: () => ServiceStatus[]): void {
  servicesAccessor = fn;
}

// ── Lifecycle ────────────────────────────────────────────────────

export interface TrafficProxyOptions {
  port?: number;
  bufferSize?: number;
  onEntry?: OnEntryFn;
}

export async function startTrafficProxy(
  options: TrafficProxyOptions = {},
): Promise<number> {
  if (server) {
    logger.warn("Traffic proxy already running, skipping start");
    return boundPort!;
  }

  const port = options.port ?? 0;
  const bufferSize = options.bufferSize ?? 1000;

  buffer = new TrafficRingBuffer(bufferSize);
  graph = new ServiceGraphAccumulator();
  onEntryCallback = options.onEntry ?? null;

  proxy = createHttpForwardProxy({
    timeout: 30_000,
    maxBodySize: 10 * 1024 * 1024,
  });

  server = createServer((req, res) => {
    // Capture request metadata before forwarding
    const startTime = Date.now();
    const method = req.method ?? "GET";
    const url = req.url ?? "";
    const sourceId = extractServiceIdFromProxyAuth(
      req.headers as Record<string, string>,
    );
    const services = servicesAccessor?.() ?? [];
    const targetId = resolveTargetService(url, services);
    const requestSize = Number(req.headers["content-length"] ?? 0);

    // Intercept response completion for full lifecycle capture
    res.on("finish", () => {
      const entry = buildTrafficEntry(
        method,
        url,
        requestSize,
        res.statusCode,
        Number(res.getHeader("content-length") ?? 0),
        sourceId,
        targetId,
        startTime,
      );
      buffer?.push(entry);
      graph?.record(entry);
      onEntryCallback?.(entry);
    });

    // Delegate to raffel's forward proxy handler
    proxy!.requestHandler(req, res);
  });

  return new Promise<number>((resolve, reject) => {
    server!.listen(port, "127.0.0.1", () => {
      const addr = server!.address();
      boundPort = typeof addr === "object" && addr ? addr.port : port;
      logger.info({ port: boundPort }, "Mesh traffic proxy started");
      resolve(boundPort);
    });
    server!.on("error", (err) => {
      logger.error({ err }, "Mesh traffic proxy failed to start");
      reject(err);
    });
  });
}

export async function stopTrafficProxy(): Promise<void> {
  if (!server) return;
  return new Promise<void>((resolve) => {
    server!.close(() => {
      logger.info("Mesh traffic proxy stopped");
      server = null;
      proxy = null;
      boundPort = null;
      resolve();
    });
  });
}

// ── Accessors ────────────────────────────────────────────────────

export function getTrafficProxyPort(): number | null {
  return boundPort;
}

export function isTrafficProxyRunning(): boolean {
  return server !== null;
}

export function getTrafficBuffer(): TrafficRingBuffer | null {
  return buffer;
}

export function getServiceGraph(): ServiceGraphAccumulator | null {
  return graph;
}

export function getTrafficProxyStats(): ProxyStats | null {
  return proxy?.stats ?? null;
}
