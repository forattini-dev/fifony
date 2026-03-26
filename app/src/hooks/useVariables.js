import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.js";

export const VARIABLES_QUERY_KEY = ["variables"];

export function useVariables() {
  return useQuery({
    queryKey: VARIABLES_QUERY_KEY,
    queryFn: () => api.get("/variables"),
    staleTime: 10_000,
  });
}

export function getVariablesList(data) {
  return Array.isArray(data?.variables) ? data.variables : [];
}

export function useVariableMutations() {
  const qc = useQueryClient();

  const upsert = async (key, value, scope) => {
    const id = `${scope}:${key}`;
    const entry = await api.put(`/variables/${encodeURIComponent(id)}`, { key, value, scope });
    qc.setQueryData(VARIABLES_QUERY_KEY, (current) => {
      const list = getVariablesList(current);
      const idx = list.findIndex((v) => v.id === id);
      const updated = entry?.variable ?? { id, key, value, scope, updatedAt: new Date().toISOString() };
      if (idx >= 0) {
        const next = [...list];
        next[idx] = updated;
        return { ...current, variables: next };
      }
      return { ...current, variables: [...list, updated] };
    });
  };

  const remove = async (id) => {
    await api.delete(`/variables/${encodeURIComponent(id)}`);
    qc.setQueryData(VARIABLES_QUERY_KEY, (current) => ({
      ...current,
      variables: getVariablesList(current).filter((v) => v.id !== id),
    }));
  };

  return { upsert, remove };
}
