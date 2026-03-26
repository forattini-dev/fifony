import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSettingsList, getSettingValue, upsertSettingPayload } from "../app/src/settings-payload.js";

describe("settings payload normalization", () => {
  it("reads settings from the S3DB response shape", () => {
    const payload = {
      success: true,
      data: [
        { id: "ui.onboarding.completed", value: true },
        { id: "ui.theme", value: "dark" },
      ],
    };

    const settings = getSettingsList(payload);
    assert.equal(settings.length, 2);
    assert.equal(getSettingValue(settings, "ui.onboarding.completed", false), true);
    assert.equal(getSettingValue(settings, "ui.theme", "auto"), "dark");
  });

  it("preserves the active payload shape during optimistic updates", () => {
    const payload = {
      success: true,
      data: [
        { id: "ui.theme", value: "auto" },
      ],
    };

    const next = upsertSettingPayload(payload, {
      id: "ui.onboarding.completed",
      scope: "ui",
      value: true,
      source: "user",
      updatedAt: "2026-03-26T00:00:00.000Z",
    });

    assert.equal(Array.isArray(next.data), true);
    assert.equal(Array.isArray(next.settings), false);
    assert.equal(getSettingValue(getSettingsList(next), "ui.onboarding.completed", false), true);
  });
});
