import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildServiceCommand, normalizeServiceEnvironment } from "../src/domains/service-env.ts";
import { deriveConfig } from "../src/domains/config.ts";
import { applyPersistedSettings, SETTING_ID_SERVICE_ENV } from "../src/persistence/settings.ts";
import { getServiceStatus } from "../src/persistence/plugins/fsm-service.ts";

describe("service environment helpers", () => {
  it("normalizes valid env maps and rejects invalid keys", () => {
    const result = normalizeServiceEnvironment({
      API_URL: "http://localhost:3000",
      FEATURE_FLAG: true,
      "bad-key": "nope",
    });

    assert.deepEqual(result.env, {
      API_URL: "http://localhost:3000",
      FEATURE_FLAG: "true",
    });
    assert.deepEqual(result.errors, ['Invalid environment variable name: bad-key']);
  });

  it("builds a prefixed command with global env overridden by service env", () => {
    const command = buildServiceCommand(
      "npm run dev",
      { API_URL: "http://global.local", SHARED: "global" },
      { SHARED: "service override", FEATURE_FLAG: "it's on" },
    );

    assert.ok(command.startsWith("API_URL='http://global.local'"));
    assert.ok(command.includes("SHARED='service override'"));
    assert.ok(command.includes("FEATURE_FLAG='it'\"'\"'s on'"));
    assert.ok(command.endsWith("npm run dev"));
  });

  it("applies persisted global service env to runtime config", () => {
    const base = deriveConfig([]);
    const next = applyPersistedSettings(base, [
      {
        id: SETTING_ID_SERVICE_ENV,
        scope: "runtime",
        value: {
          API_URL: "http://localhost:3000",
          FEATURE_FLAG: "1",
        },
        source: "user",
        updatedAt: "2026-03-26T00:00:00.000Z",
      },
    ]);

    assert.deepEqual(next.serviceEnv, {
      API_URL: "http://localhost:3000",
      FEATURE_FLAG: "1",
    });
  });

  it("returns service configuration fields together with runtime status", () => {
    const status = getServiceStatus(
      {
        id: "web",
        name: "Web",
        command: "npm run dev",
        cwd: "app",
        env: { PORT: "3000" },
        autoStart: true,
        autoRestart: true,
        maxCrashes: 7,
        port: 3000,
      },
      "/tmp/fifony-service-env-test",
    );

    assert.equal(status.command, "npm run dev");
    assert.equal(status.cwd, "app");
    assert.deepEqual(status.env, { PORT: "3000" });
    assert.equal(status.autoStart, true);
    assert.equal(status.autoRestart, true);
    assert.equal(status.maxCrashes, 7);
    assert.equal(status.port, 3000);
  });
});
