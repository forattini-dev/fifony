/**
 * Global chat session bootstrap.
 *
 * Primes the `chat-global` CLI session at boot with project context so the
 * user's first chat message resumes an already-situated assistant instead of
 * paying the cold-start latency. Fire-and-forget — never blocks boot.
 */

import { logger } from "../../concerns/logger.ts";
import type { RuntimeState } from "../../types.ts";
import { loadCliSession } from "./cli-session-store.ts";
import { buildGlobalChatPrompt } from "./chat-prompt.ts";
import { chatWithIssue } from "../planning/issue-chat.ts";
import { detectAvailableProviders } from "../providers.ts";

const GLOBAL_CHAT_KEY = "chat-global";

const PRIMING_MESSAGE =
  "This is a boot-time priming message from the fifony runtime. " +
  "The block above describes the project you will help the user operate. " +
  "Do NOT take any action now. Just acknowledge in one short sentence that " +
  "you've loaded the context and are ready. The human user will send the " +
  "first real message after this.";

export interface BootstrapOptions {
  /** Force re-priming even if a session already exists. */
  force?: boolean;
}

/**
 * Kick off global chat priming in the background. Resolves immediately.
 * Errors are logged and swallowed — chat still works without the prime.
 */
export function bootstrapGlobalChat(state: RuntimeState, options: BootstrapOptions = {}): void {
  (async () => {
    try {
      const existing = loadCliSession(GLOBAL_CHAT_KEY);
      if (existing && !options.force) {
        logger.debug(
          { provider: existing.provider, sessionId: existing.sessionId },
          "[Chat] Global chat already primed — skipping bootstrap",
        );
        return;
      }

      const providers = detectAvailableProviders();
      if (!providers.some((p) => p.available)) {
        logger.debug("[Chat] No provider available — skipping global chat bootstrap");
        return;
      }

      const systemPrompt = buildGlobalChatPrompt(state);

      logger.info("[Chat] Priming global chat session (background)…");
      const result = await chatWithIssue(
        {
          issueId: "global-chat",
          title: "Global Chat",
          description: systemPrompt,
          plan: null,
          message: PRIMING_MESSAGE,
          chatKey: GLOBAL_CHAT_KEY,
        },
        state.config,
      );

      logger.info(
        { provider: result.provider, sessionId: result.sessionId, responseLength: result.response.length },
        "[Chat] Global chat primed",
      );
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "[Chat] Global chat bootstrap failed (non-fatal — first user turn will cold-start)",
      );
    }
  })();
}
