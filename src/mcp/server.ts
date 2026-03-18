import { env, stdin } from "node:process";
import {
  initDatabase,
  getDatabase,
  appendEvent,
  WORKSPACE_ROOT,
  PERSISTENCE_ROOT,
} from "./database.js";
import {
  incomingBuffer,
  setIncomingBuffer,
  sendError,
  processIncomingBuffer,
} from "./jsonrpc-transport.js";

const DEBUG_BOOT = env.FIFONY_DEBUG_BOOT === "1";

function debugBoot(message: string): void {
  if (!DEBUG_BOOT) return;
  process.stderr.write(`[FIFONY_DEBUG_BOOT] ${message}\n`);
}

async function bootstrap(): Promise<void> {
  debugBoot("mcp:bootstrap:start");
  await initDatabase();
  debugBoot("mcp:bootstrap:database-ready");
  await appendEvent("info", "Fifony MCP server started.", { workspaceRoot: WORKSPACE_ROOT, persistenceRoot: PERSISTENCE_ROOT });

  stdin.on("data", (chunk: Buffer) => {
    setIncomingBuffer(Buffer.concat([incomingBuffer, chunk]));
    processIncomingBuffer();
  });

  stdin.resume();
  debugBoot("mcp:bootstrap:stdin-ready");
}

bootstrap().catch((error) => {
  sendError(null, -32001, `Failed to start Fifony MCP server: ${String(error)}`);
  process.exit(1);
});

process.on("SIGINT", async () => {
  const db = getDatabase();
  if (db) await db.disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  const db = getDatabase();
  if (db) await db.disconnect();
  process.exit(0);
});
