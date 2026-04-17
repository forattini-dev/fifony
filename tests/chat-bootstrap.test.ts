import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tempRoot: string;

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "fifony-chat-boot-"));
  process.env.FIFONY_PERSISTENCE = tempRoot;
});

after(() => {
  delete process.env.FIFONY_PERSISTENCE;
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

test("bootstrap skips silently when no provider is available", async () => {
  // Force provider detection to return nothing by sabotaging PATH for the child
  // of the one-shot runner. Simpler: just verify bootstrap respects the early
  // guard and produces no session file when providers are missing.
  const savedPath = process.env.PATH;
  process.env.PATH = "/nonexistent";
  try {
    const { bootstrapGlobalChat } = await import("../src/agents/chat/bootstrap.ts");
    const fakeState: any = {
      projectName: "test-project",
      detectedProjectName: "test-project",
      issues: [],
      config: { services: [], commandTimeoutMs: 5_000 },
    };
    bootstrapGlobalChat(fakeState);
    // Give the fire-and-forget a moment to resolve its guard check
    await new Promise((r) => setTimeout(r, 100));
    const sessionsDir = join(tempRoot, ".fifony", "chat-sessions");
    if (existsSync(sessionsDir)) {
      const files = readdirSync(sessionsDir);
      assert.deepEqual(files.filter((f) => f.startsWith("cli-")), [], "no CLI session file should be created");
    }
  } finally {
    process.env.PATH = savedPath;
  }
});

test("bootstrap short-circuits when a session already exists", async () => {
  const { saveCliSession, loadCliSession } = await import("../src/agents/chat/cli-session-store.ts");
  const { bootstrapGlobalChat } = await import("../src/agents/chat/bootstrap.ts");

  saveCliSession({ key: "chat-global", provider: "claude", sessionId: "pre-existing-uuid" });

  const fakeState: any = {
    projectName: "test",
    detectedProjectName: "test",
    issues: [],
    config: { services: [], commandTimeoutMs: 5_000 },
  };

  bootstrapGlobalChat(fakeState);
  await new Promise((r) => setTimeout(r, 50));

  const existing = loadCliSession("chat-global");
  assert.equal(existing?.sessionId, "pre-existing-uuid", "existing session must not be overwritten");
});
