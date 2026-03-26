export function isOnboardingCompletedValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on", "completed"].includes(normalized)) return true;
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  }
  return false;
}

export function hasCompletedOnboarding(settings) {
  const entry = Array.isArray(settings) ? settings.find((setting) => setting?.id === "ui.onboarding.completed") : null;
  return isOnboardingCompletedValue(entry?.value);
}
