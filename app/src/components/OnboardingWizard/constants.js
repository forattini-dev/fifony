import { Zap, Gauge, Brain, Flame, Search } from "lucide-react";

// ── Step labels ───────────────────────────────────────────────────────────────

export const BASE_STEP_LABELS = [
  "Welcome", "Setup", "Pipeline", "Agents & Skills", "Preferences", "Launch",
];

export function getStepLabels() {
  return BASE_STEP_LABELS;
}

export function getStepCount() {
  return BASE_STEP_LABELS.length;
}

// ── Stepper labels ────────────────────────────────────────────────────────────

export const BASE_STEPPER_LABELS = [
  "Setup", "Pipeline", "Agents", "Preferences", "Launch",
];

export function getStepperLabels() {
  return BASE_STEPPER_LABELS;
}

// ── Effort options ────────────────────────────────────────────────────────────

export const EFFORT_OPTIONS = [
  { value: "low", label: "Low", icon: Zap, description: "Quick and light -- fast responses, less thorough", color: "text-info" },
  { value: "medium", label: "Medium", icon: Gauge, description: "Balanced -- good mix of speed and quality", color: "text-success" },
  { value: "high", label: "High", icon: Brain, description: "Thorough -- deeper analysis, takes more time", color: "text-warning" },
  { value: "extra-high", label: "Extra High", icon: Flame, description: "Maximum depth -- most thorough, slowest", color: "text-error" },
];

// Effort availability depends on the CLI: codex and claude support extra-high (claude maps it to "max"), gemini does not
export const PROVIDER_EFFORT_SUPPORT = {
  codex: EFFORT_OPTIONS,
  claude: EFFORT_OPTIONS,
  gemini: EFFORT_OPTIONS.filter((option) => option.value !== "extra-high"),
};

export function getEffortOptionsForRole(role, pipeline) {
  const provider = pipeline?.[role] || "codex";
  return PROVIDER_EFFORT_SUPPORT[provider] || EFFORT_OPTIONS;
}

// ── Themes ────────────────────────────────────────────────────────────────────

export const THEMES = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "black", label: "Black" },
  { value: "cupcake", label: "Cupcake" },
  { value: "night", label: "Night" },
  { value: "sunset", label: "Sunset" },
];

// ── Pipeline roles ────────────────────────────────────────────────────────────

export const PIPELINE_ROLES = [
  {
    role: "planner",
    label: "Planner",
    description: "Scopes the issue, breaks it into steps, and decides the approach",
    icon: Brain,
    color: "text-info",
  },
  {
    role: "executor",
    label: "Executor",
    description: "Implements the plan — writes code, edits files, runs commands",
    icon: Zap,
    color: "text-primary",
  },
  {
    role: "reviewer",
    label: "Reviewer",
    description: "Validates the result — checks correctness, scope, and quality",
    icon: Search,
    color: "text-secondary",
  },
];
