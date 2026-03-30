import type { RuntimeState, ChatAction, ChatTurn, ChatSessionFile } from "../types.ts";
import type { RouteRegistrar } from "./http.ts";
import { logger } from "../concerns/logger.ts";
import { now, toStringValue } from "../concerns/helpers.ts";
import {
  loadChatSession,
  persistChatSession,
  createIssueChat,
  listChatSessions,
  deleteChatSession,
  appendTurn,
  sessionFileToMeta,
} from "../agents/chat/chat-session.ts";
import { buildGlobalChatPrompt } from "../agents/chat/chat-prompt.ts";
import { parseActionsFromResponse } from "../agents/chat/action-parser.ts";
import { executeChatAction } from "../agents/chat/action-executor.ts";
import { chatWithIssue } from "../agents/planning/issue-chat.ts";

export function registerChatRoutes(
  app: RouteRegistrar,
  state: RuntimeState,
): void {
  // ── Session CRUD (issue-linked) ────────────────────────────────────

  app.get("/api/chat/sessions", async (c) => {
    try {
      const sessions = await listChatSessions();
      return c.json({ ok: true, sessions: sessions.map(sessionFileToMeta) });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  app.get("/api/chat/sessions/:id", async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ ok: false, error: "Issue id is required." }, 400);
    try {
      const session = await loadChatSession(id);
      if (!session) return c.json({ ok: false, error: "No chat session for this issue." }, 404);
      return c.json({ ok: true, session: sessionFileToMeta(session) });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  app.delete("/api/chat/sessions/:id", async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ ok: false, error: "Issue id is required." }, 400);
    try {
      await deleteChatSession(id);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // ── Chat message (core) ────────────────────────────────────────────
  // issueId: optional — if provided, loads/creates issue-linked session
  // If not provided, chat is temporary (response returned but not persisted)

  app.post("/api/chat", async (c) => {
    try {
      const body = await c.req.json() as Record<string, unknown>;
      const message = toStringValue(body.message, "").trim();
      if (!message) return c.json({ ok: false, error: "Message is required." }, 400);

      const issueId = typeof body.issueId === "string" ? body.issueId : undefined;
      const historyRaw = Array.isArray(body.history) ? body.history as Array<{ role: string; content: string }> : [];

      // Build history for the one-shot runner
      const history = historyRaw
        .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
        .map((t) => ({ role: t.role as "user" | "assistant", content: t.content }));

      // If issue-linked, load existing session for its turns
      let session: ChatSessionFile | null = null;
      if (issueId) {
        session = await loadChatSession(issueId);
        if (session) {
          // Use persisted turns as history (overrides frontend-sent history)
          const persistedHistory = session.turns
            .filter((t) => t.role === "user" || t.role === "assistant")
            .map((t) => ({ role: t.role as "user" | "assistant", content: t.content }));
          history.length = 0;
          history.push(...persistedHistory);
        }
      }

      // Build context
      const systemPrompt = buildGlobalChatPrompt(state);
      const issue = issueId ? state.issues.find((i) => i.id === issueId) : null;

      const result = await chatWithIssue(
        {
          issueId: issueId || "global-chat",
          title: issue?.title || "Global Chat",
          description: issue ? `${issue.description}\n\n---\n\n${systemPrompt}` : systemPrompt,
          plan: issue?.plan ?? null,
          message,
          history,
        },
        state.config,
      );

      const actions = parseActionsFromResponse(result.response);

      // If issue-linked, persist turns
      if (issueId) {
        if (!session) {
          session = await createIssueChat(issueId, { provider: result.provider });
        }
        appendTurn(session, { role: "user", content: message });
        appendTurn(session, {
          role: "assistant",
          content: result.response,
          actions: actions.length > 0 ? actions : undefined,
        });
        session.cli = { provider: result.provider };
        await persistChatSession(session);
      }

      logger.info(
        { issueId: issueId || "temporary", provider: result.provider, actions: actions.length },
        "[Chat] Message processed",
      );

      return c.json({
        ok: true,
        response: result.response,
        actions,
        issueId: issueId || null,
        provider: result.provider,
      });
    } catch (err) {
      logger.error({ err }, "[Chat] POST /api/chat failed");
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // ── Link temporary chat to a new issue ─────────────────────────────
  // Called after create-issue action: saves the temporary turns to issue file

  app.post("/api/chat/link", async (c) => {
    try {
      const body = await c.req.json() as Record<string, unknown>;
      const issueId = typeof body.issueId === "string" ? body.issueId : "";
      if (!issueId) return c.json({ ok: false, error: "issueId is required." }, 400);

      const turns = Array.isArray(body.turns) ? body.turns as ChatTurn[] : [];
      const provider = typeof body.provider === "string" ? body.provider : state.config.agentProvider;

      const session = await createIssueChat(issueId, { provider }, turns);
      logger.info({ issueId, turns: turns.length }, "[Chat] Linked temporary chat to issue");
      return c.json({ ok: true, session: sessionFileToMeta(session) });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // ── Execute action ─────────────────────────────────────────────────

  app.post("/api/chat/action", async (c) => {
    try {
      const body = await c.req.json() as Record<string, unknown>;
      const action = body.action as ChatAction | undefined;
      if (!action?.type) return c.json({ ok: false, error: "Action is required." }, 400);

      const result = await executeChatAction(action, state);
      return c.json(result);
    } catch (err) {
      logger.error({ err }, "[Chat] Action execution failed");
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
}
