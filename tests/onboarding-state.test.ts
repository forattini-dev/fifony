import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasCompletedOnboarding, isOnboardingCompletedValue } from "../app/src/onboarding-state.js";

describe("onboarding completion state", () => {
  it("normalizes tolerant truthy and falsy values", () => {
    assert.equal(isOnboardingCompletedValue(true), true);
    assert.equal(isOnboardingCompletedValue("true"), true);
    assert.equal(isOnboardingCompletedValue("TRUE"), true);
    assert.equal(isOnboardingCompletedValue("1"), true);
    assert.equal(isOnboardingCompletedValue(1), true);
    assert.equal(isOnboardingCompletedValue("completed"), true);

    assert.equal(isOnboardingCompletedValue(false), false);
    assert.equal(isOnboardingCompletedValue("false"), false);
    assert.equal(isOnboardingCompletedValue("0"), false);
    assert.equal(isOnboardingCompletedValue(0), false);
    assert.equal(isOnboardingCompletedValue(null), false);
    assert.equal(isOnboardingCompletedValue(undefined), false);
  });

  it("detects completion from the settings list", () => {
    assert.equal(hasCompletedOnboarding([
      { id: "ui.onboarding.completed", value: true },
    ]), true);

    assert.equal(hasCompletedOnboarding([
      { id: "ui.onboarding.completed", value: "true" },
    ]), true);

    assert.equal(hasCompletedOnboarding([
      { id: "ui.theme", value: "dark" },
      { id: "ui.onboarding.completed", value: false },
    ]), false);
  });
});
