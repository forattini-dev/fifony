import type { AgentContextHit, AgentProviderRole, ContextLayerName, IssueEntry } from "../types.ts";

export type ContextAssemblyPolicy = {
  name: string;
  maxHits: number;
  layerCaps: Record<ContextLayerName, number>;
  layerPriority: ContextLayerName[];
};

type ContextPolicyInput = {
  role: AgentProviderRole;
  issue?: Pick<IssueEntry, "plan">;
};

function buildPolicy(
  name: string,
  maxHits: number,
  layerCaps: Record<ContextLayerName, number>,
): ContextAssemblyPolicy {
  return {
    name,
    maxHits,
    layerCaps,
    layerPriority: ["bootstrap", "workspace-memory", "issue-memory", "retrieval"],
  };
}

export function resolveContextAssemblyPolicy(input: ContextPolicyInput): ContextAssemblyPolicy {
  const harnessMode = input.issue?.plan?.harnessMode ?? "standard";
  const checkpointPolicy = input.issue?.plan?.executionContract?.checkpointPolicy ?? "final_only";

  if (input.role === "planner") {
    return buildPolicy("planner-foundation", 6, {
      bootstrap: 2,
      "workspace-memory": 2,
      "issue-memory": 1,
      retrieval: 3,
    });
  }

  if (input.role === "reviewer") {
    if (harnessMode === "contractual" && checkpointPolicy === "checkpointed") {
      return buildPolicy("reviewer-contractual-checkpointed", 10, {
        bootstrap: 1,
        "workspace-memory": 2,
        "issue-memory": 3,
        retrieval: 5,
      });
    }
    if (harnessMode === "contractual") {
      return buildPolicy("reviewer-contractual-final-only", 9, {
        bootstrap: 1,
        "workspace-memory": 2,
        "issue-memory": 3,
        retrieval: 4,
      });
    }
    return buildPolicy("reviewer-standard", 8, {
      bootstrap: 1,
      "workspace-memory": 2,
      "issue-memory": 3,
      retrieval: 4,
    });
  }

  if (harnessMode === "contractual") {
    return buildPolicy("executor-contractual", 9, {
      bootstrap: 2,
      "workspace-memory": 2,
      "issue-memory": 2,
      retrieval: 5,
    });
  }

  return buildPolicy("executor-standard", 8, {
    bootstrap: 2,
    "workspace-memory": 2,
    "issue-memory": 2,
    retrieval: 4,
  });
}

export function formatContextAssemblyPolicy(policy: ContextAssemblyPolicy): string[] {
  return [
    `policy:${policy.name}`,
    `layer-caps:${policy.layerPriority.map((name) => `${name}=${policy.layerCaps[name] ?? 0}`).join(",")}`,
  ];
}

export function selectHitsByContextPolicy(
  layers: Record<ContextLayerName, AgentContextHit[]>,
  policy: ContextAssemblyPolicy,
): AgentContextHit[] {
  const selected: AgentContextHit[] = [];
  const selectedIds = new Set<string>();

  const orderedLayers = policy.layerPriority.map((name) => ({
    name,
    hits: [...(layers[name] ?? [])].sort((left, right) => right.score - left.score || left.id.localeCompare(right.id)),
  }));

  for (const layer of orderedLayers) {
    const cap = Math.max(0, policy.layerCaps[layer.name] ?? 0);
    if (cap === 0) continue;
    let taken = 0;
    for (const hit of layer.hits) {
      if (selected.length >= policy.maxHits) return selected;
      if (selectedIds.has(hit.id) || taken >= cap) continue;
      selected.push(hit);
      selectedIds.add(hit.id);
      taken += 1;
    }
  }

  const remainder = orderedLayers
    .flatMap((layer) => layer.hits)
    .filter((hit) => !selectedIds.has(hit.id))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));

  for (const hit of remainder) {
    if (selected.length >= policy.maxHits) break;
    selected.push(hit);
    selectedIds.add(hit.id);
  }

  return selected;
}
