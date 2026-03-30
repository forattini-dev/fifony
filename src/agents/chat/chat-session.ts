import type { ChatSessionFile, ChatCliSession, ChatTurn, ChatSessionMeta } from "../../types.ts";
import { now } from "../../concerns/helpers.ts";
import { logger } from "../../concerns/logger.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { STATE_ROOT } from "../../concerns/constants.ts";

const CHAT_DIR = join(STATE_ROOT, "chat-sessions");

function ensureChatDir(): void {
  mkdirSync(CHAT_DIR, { recursive: true });
}

function sessionPath(issueId: string): string {
  return join(CHAT_DIR, `issue-${issueId}.json`);
}

// ── Issue-linked sessions (persisted to disk) ───────────────────────────────

/** Load a chat session for an issue. Returns null if no session exists. */
export async function loadChatSession(issueId: string): Promise<ChatSessionFile | null> {
  const path = sessionPath(issueId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ChatSessionFile;
  } catch {
    return null;
  }
}

/** Persist a chat session for an issue. */
export async function persistChatSession(session: ChatSessionFile): Promise<void> {
  ensureChatDir();
  session.updatedAt = now();
  writeFileSync(sessionPath(session.issueId), JSON.stringify(session, null, 2), "utf8");
}

/** Create a new session file for an issue, optionally importing turns from a temporary chat. */
export async function createIssueChat(
  issueId: string,
  cli: ChatCliSession,
  existingTurns?: ChatTurn[],
): Promise<ChatSessionFile> {
  const ts = now();
  const session: ChatSessionFile = {
    issueId,
    cli,
    turns: existingTurns ?? [],
    createdAt: ts,
    updatedAt: ts,
  };
  await persistChatSession(session);
  logger.debug({ issueId, provider: cli.provider }, "[Chat] Issue chat created");
  return session;
}

/** Delete a chat session for an issue. */
export async function deleteChatSession(issueId: string): Promise<boolean> {
  try {
    rmSync(sessionPath(issueId), { force: true });
    return true;
  } catch {
    return false;
  }
}

/** List all issue-linked chat sessions. */
export async function listChatSessions(): Promise<ChatSessionFile[]> {
  ensureChatDir();
  try {
    const files = readdirSync(CHAT_DIR).filter((f) => f.startsWith("issue-") && f.endsWith(".json"));
    const sessions: ChatSessionFile[] = [];
    for (const file of files) {
      try {
        const raw = readFileSync(join(CHAT_DIR, file), "utf8");
        sessions.push(JSON.parse(raw) as ChatSessionFile);
      } catch { /* skip corrupt */ }
    }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (err) {
    logger.warn({ err }, "[Chat] Failed to list sessions");
    return [];
  }
}

// ── Turn helpers ─────────────────────────────────────────────────────────────

export function appendTurn(session: ChatSessionFile, turn: Omit<ChatTurn, "timestamp">): void {
  session.turns.push({ ...turn, timestamp: now() });
}

// ── Backward compat: ChatSessionMeta adapters ────────────────────────────────
// Routes that still use the old API get adapters here

export function sessionFileToMeta(session: ChatSessionFile): ChatSessionMeta {
  return {
    id: session.issueId,
    name: `Issue ${session.issueId}`,
    status: "active",
    provider: session.cli.provider,
    turns: session.turns,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

/** @deprecated Use createIssueChat */
export async function createChatSession(provider: string, name?: string): Promise<ChatSessionMeta> {
  const ts = now();
  return {
    id: `temp-${Date.now()}`,
    name: name || "Temporary",
    status: "active",
    provider,
    turns: [],
    createdAt: ts,
    updatedAt: ts,
  };
}
