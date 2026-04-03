import type { TemplateVariant, TemplateVariantSelection } from "../types.ts";
import { now } from "../concerns/helpers.ts";

// ── Variant registry ────────────────────────────────────────────────────────
// Variants are registered at startup from settings and can be selected
// per-attempt for A/B testing or adaptive harness search.

const registry = new Map<string, TemplateVariant>();

/** Built-in baseline variant (current behavior). Always present. */
const BASELINE_VARIANT: TemplateVariant = {
  id: "baseline",
  description: "Default retry context behavior — summary-based with file references",
  weight: 1.0,
  active: true,
  parameters: {
    budgetMultiplier: 1.0,
    inlineTraceContent: false,
    hypothesisGeneration: false,
    lessonExtraction: false,
  },
};

/** Full-trace variant (Meta-Harness aligned — Phases 1-3). */
const FULL_TRACE_VARIANT: TemplateVariant = {
  id: "full-trace-inline",
  description: "Inline trace content, causal hypotheses, cross-issue lessons",
  weight: 1.0,
  active: true,
  parameters: {
    budgetMultiplier: 1.0,
    inlineTraceContent: true,
    hypothesisGeneration: true,
    lessonExtraction: true,
  },
};

// Initialize with built-in variants
registry.set(BASELINE_VARIANT.id, BASELINE_VARIANT);
registry.set(FULL_TRACE_VARIANT.id, FULL_TRACE_VARIANT);

/** Register a custom variant. Overwrites if ID already exists. */
export function registerVariant(variant: TemplateVariant): void {
  registry.set(variant.id, variant);
}

/** Remove a variant by ID. Cannot remove built-in variants. */
export function unregisterVariant(id: string): boolean {
  if (id === "baseline" || id === "full-trace-inline") return false;
  return registry.delete(id);
}

/** Get all active variants. */
export function getActiveVariants(): TemplateVariant[] {
  return [...registry.values()].filter((v) => v.active);
}

/** Get a specific variant by ID. */
export function getVariant(id: string): TemplateVariant | null {
  return registry.get(id) ?? null;
}

/** List all registered variants (active and inactive). */
export function listVariants(): TemplateVariant[] {
  return [...registry.values()];
}

/**
 * Select a variant using the specified method.
 * - "default": always returns "full-trace-inline" (the Meta-Harness aligned variant)
 * - "weighted-random": picks from active variants weighted by their weight field
 * - "adaptive": uses "full-trace-inline" (future: select based on Pareto data)
 */
export function selectVariant(
  method: "default" | "weighted-random" | "adaptive" = "default",
): TemplateVariantSelection {
  const active = getActiveVariants();
  if (active.length === 0) {
    return { variantId: "full-trace-inline", selectedAt: now(), selectionMethod: method };
  }

  let selected: TemplateVariant;

  if (method === "weighted-random") {
    const totalWeight = active.reduce((sum, v) => sum + v.weight, 0);
    let random = Math.random() * totalWeight;
    selected = active[active.length - 1]!;
    for (const variant of active) {
      random -= variant.weight;
      if (random <= 0) { selected = variant; break; }
    }
  } else {
    // "default" and "adaptive" both use full-trace-inline
    selected = registry.get("full-trace-inline") ?? active[0]!;
  }

  return {
    variantId: selected.id,
    selectedAt: now(),
    selectionMethod: method,
  };
}

/** Load custom variants from persisted settings array. */
export function loadVariantsFromSettings(variants: unknown): void {
  if (!Array.isArray(variants)) return;
  for (const raw of variants) {
    if (!raw || typeof raw !== "object") continue;
    const v = raw as Record<string, unknown>;
    if (typeof v.id !== "string" || !v.id) continue;
    // Don't overwrite built-in variants' core behavior, only weight/active
    if (v.id === "baseline" || v.id === "full-trace-inline") {
      const existing = registry.get(v.id)!;
      if (typeof v.weight === "number") existing.weight = v.weight;
      if (typeof v.active === "boolean") existing.active = v.active;
      continue;
    }
    registerVariant({
      id: v.id,
      description: typeof v.description === "string" ? v.description : "",
      weight: typeof v.weight === "number" ? v.weight : 1.0,
      active: typeof v.active === "boolean" ? v.active : true,
      parameters: {
        budgetMultiplier: typeof (v as { parameters?: { budgetMultiplier?: number } }).parameters?.budgetMultiplier === "number" ? (v as { parameters: { budgetMultiplier: number } }).parameters.budgetMultiplier : 1.0,
        inlineTraceContent: Boolean((v as { parameters?: { inlineTraceContent?: boolean } }).parameters?.inlineTraceContent),
        hypothesisGeneration: Boolean((v as { parameters?: { hypothesisGeneration?: boolean } }).parameters?.hypothesisGeneration),
        lessonExtraction: Boolean((v as { parameters?: { lessonExtraction?: boolean } }).parameters?.lessonExtraction),
      },
    });
  }
}
