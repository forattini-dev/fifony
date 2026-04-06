/**
 * Service log broadcaster — pushes new log chunks to connected WebSocket clients.
 *
 * Uses @logdna/tail-file for robust file tailing:
 * - Tracks inode for proper rotation handling (rename + recreate)
 * - Handles truncation (copytruncate) automatically
 * - Poll-based with configurable interval — no fragile fs.watch
 * - Readable stream API — data events fire only when bytes are appended
 */

import { existsSync, statSync } from "node:fs";
import TailFile from "@logdna/tail-file";
import { sendToServiceLogRoom, serviceLogRoomSize } from "../../routes/websocket.ts";
import { serviceLogPath } from "./fsm-service.ts";
import { logger } from "../../concerns/logger.ts";

const MAX_CHUNK_BYTES = 16_384;

type Entry = {
  tail: TailFile;
  buffer: string;
  position: number;
};

const active = new Map<string, Entry>();

export function startServiceLogBroadcasting(id: string, fifonyDir: string): void {
  if (active.has(id)) return;

  const logPath = serviceLogPath(fifonyDir, id);
  if (!existsSync(logPath)) return;

  const tail = new TailFile(logPath, {
    startPos: null,             // null = start from EOF
    pollFileIntervalMs: 250,    // 250ms poll — fast enough for real-time feel
    maxPollFailures: 30,        // tolerate temporary file absence (rotation)
    encoding: "utf8",
  });

  const entry: Entry = { tail, buffer: "", position: 0 };
  try {
    entry.position = statSync(logPath).size;
  } catch {}

  // Buffer incoming chunks and flush to WS subscribers
  tail.on("data", (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (!text) return;

    entry.position += Buffer.byteLength(text, "utf8");

    // If nobody is listening, buffer up to MAX_CHUNK_BYTES so we can
    // deliver a catch-up burst when a subscriber joins
    if (serviceLogRoomSize(id) === 0) {
      entry.buffer += text;
      if (entry.buffer.length > MAX_CHUNK_BYTES) {
        entry.buffer = entry.buffer.slice(-MAX_CHUNK_BYTES);
      }
      return;
    }

    // Flush any buffered content first
    let payload = entry.buffer + text;
    entry.buffer = "";

    // Cap outbound chunk size
    if (payload.length > MAX_CHUNK_BYTES) {
      payload = payload.slice(-MAX_CHUNK_BYTES);
    }

    sendToServiceLogRoom(id, JSON.stringify({ type: "service:log", id, chunk: payload }));
  });

  tail.on("truncated", (info) => {
    logger.debug({ id, info }, "[ServiceLogBroadcaster] File truncated (rotation/restart)");
    entry.position = 0;
    entry.buffer = "";
  });

  tail.on("renamed", (info) => {
    logger.debug({ id, info }, "[ServiceLogBroadcaster] File renamed (log rotation)");
  });

  tail.on("tail_error", (err) => {
    logger.warn({ id, err }, "[ServiceLogBroadcaster] Tail error");
  });

  // Register BEFORE async start — so stopServiceLogBroadcasting can find it
  active.set(id, entry);

  // start() is async but we fire-and-forget — the data listener is already
  // attached so chunks will flow as soon as start completes.
  tail.start().then(() => {
    logger.debug({ id, logPath }, "[ServiceLogBroadcaster] Started tailing");
  }).catch((err) => {
    logger.warn({ id, err }, "[ServiceLogBroadcaster] Failed to start tail");
    active.delete(id);
  });
}

export function stopServiceLogBroadcasting(id: string): void {
  const entry = active.get(id);
  if (!entry) return;
  // Delete from map SYNCHRONOUSLY so a subsequent start() won't early-return
  active.delete(id);
  // Quit the tail asynchronously — fire-and-forget
  entry.tail.quit().catch(() => {});
}

export function stopAllServiceLogBroadcasting(): void {
  for (const id of [...active.keys()]) stopServiceLogBroadcasting(id);
}
