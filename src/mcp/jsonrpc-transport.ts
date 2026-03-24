import { stdout } from "node:process";
import { type JsonRpcId, type JsonRpcRequest, type JsonRpcResponse } from "./mcp-types.js";
import { listResourcesMcp, readResource } from "./resources/resource-handlers.js";
import { listTools } from "./tools/tool-list.js";
import { callTool } from "./tools/tool-executor.js";
import { listPrompts } from "./prompts/prompt-list.js";
import { getPrompt } from "./prompts/prompt-handler.js";

export let incomingBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

export function setIncomingBuffer(buffer: Buffer<ArrayBufferLike>): void {
  incomingBuffer = buffer;
}

export function sendMessage(message: JsonRpcResponse): void {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  stdout.write(payload);
}

export function sendResult(id: JsonRpcId, result: unknown): void {
  sendMessage({ jsonrpc: "2.0", id, result });
}

export function sendError(id: JsonRpcId, code: number, message: string, data?: unknown): void {
  sendMessage({ jsonrpc: "2.0", id, error: { code, message, data } });
}

export async function handleRequest(request: JsonRpcRequest): Promise<void> {
  const id = request.id ?? null;
  try {
    switch (request.method) {
      case "initialize":
        sendResult(id, { protocolVersion: "2024-11-05", capabilities: { resources: {}, tools: {}, prompts: {} }, serverInfo: { name: "fifony", version: "0.1.0" } });
        return;
      case "notifications/initialized": return;
      case "ping": sendResult(id, {}); return;
      case "resources/list": sendResult(id, { resources: await listResourcesMcp() }); return;
      case "resources/read": sendResult(id, { contents: await readResource(String(request.params?.uri ?? "")) }); return;
      case "tools/list": sendResult(id, { tools: listTools() }); return;
      case "tools/call": sendResult(id, await callTool(String(request.params?.name ?? ""), (request.params?.arguments as Record<string, unknown> | undefined) ?? {})); return;
      case "prompts/list": sendResult(id, { prompts: listPrompts() }); return;
      case "prompts/get": sendResult(id, await getPrompt(String(request.params?.name ?? ""), (request.params?.arguments as Record<string, unknown> | undefined) ?? {})); return;
      default: sendError(id, -32601, `Method not found: ${request.method}`);
    }
  } catch (error) {
    sendError(id, -32000, String(error));
  }
}

export function processIncomingBuffer(): void {
  while (true) {
    const separatorIndex = incomingBuffer.indexOf("\r\n\r\n");
    if (separatorIndex === -1) return;

    const headerText = incomingBuffer.subarray(0, separatorIndex).toString("utf8");
    const contentLengthHeader = headerText.split("\r\n").find((line) => line.toLowerCase().startsWith("content-length:"));
    if (!contentLengthHeader) { incomingBuffer = Buffer.alloc(0); return; }

    const contentLength = Number.parseInt(contentLengthHeader.split(":")[1]?.trim() ?? "0", 10);
    const messageStart = separatorIndex + 4;
    const messageEnd = messageStart + contentLength;
    if (incomingBuffer.length < messageEnd) return;

    const messageBody = incomingBuffer.subarray(messageStart, messageEnd).toString("utf8");
    incomingBuffer = incomingBuffer.subarray(messageEnd);

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(messageBody) as JsonRpcRequest;
    } catch (error) {
      sendError(null, -32700, `Invalid JSON: ${String(error)}`);
      continue;
    }

    void handleRequest(request);
  }
}
