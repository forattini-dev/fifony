import type { IssueState } from "./types.ts";

export const ISSUE_STATE_MACHINE_ID = "issue-lifecycle";

type IssueStateTransitionMap = Record<string, string[]>;

type IssueStateMachineDefinition = {
  initialState: string;
  states?: Record<string, { on?: Record<string, string> } | undefined>;
};

const ISSUE_STATE_TRANSITIONS: Record<string, readonly string[]> = {
  Planning:  ["Planned", "Cancelled"],
  Planned:   ["Queued", "Planning", "Cancelled"],
  Queued:    ["Running"],
  Running:   ["Reviewing", "Queued", "Blocked"],
  Reviewing: ["Reviewed", "Queued", "Blocked"],
  Reviewed:  ["Done", "Queued", "Planning", "Cancelled"],
  Blocked:   ["Queued", "Planning", "Cancelled"],
  Done:      ["Planning", "Queued"],
  Cancelled: ["Planning", "Planned"],
};

export const ISSUE_STATE_MACHINE_DEFINITION = {
  initialState: "Planning",
  states: {
    Planning: {
      on: {
        Planned: "Planned",
        Cancelled: "Cancelled",
      },
    },
    Planned: {
      on: {
        Queued: "Queued",
        Planning: "Planning",
        Cancelled: "Cancelled",
      },
    },
    Queued: {
      on: {
        Running: "Running",
      },
    },
    Running: {
      on: {
        Reviewing: "Reviewing",
        Queued: "Queued",
        Blocked: "Blocked",
      },
    },
    Reviewing: {
      on: {
        Reviewed: "Reviewed",
        Queued: "Queued",
        Blocked: "Blocked",
      },
    },
    Reviewed: {
      on: {
        Done: "Done",
        Queued: "Queued",
        Planning: "Planning",
        Cancelled: "Cancelled",
      },
    },
    Blocked: {
      on: {
        Queued: "Queued",
        Planning: "Planning",
        Cancelled: "Cancelled",
      },
    },
    Done: {
      on: {
        Planning: "Planning",
        Queued: "Queued",
      },
    },
    Cancelled: {
      on: {
        Planning: "Planning",
        Planned: "Planned",
      },
    },
  },
} as const;

type TransitionPayload = {
  event: string;
  context: Record<string, unknown>;
  issueId: string;
  to: string;
  from: string;
  timestamp: string;
};

export type IssueStateMachinePluginLike = {
  getMachineDefinition?: (machineId: string) => unknown;
  getState?: (machineId: string, entityId: string) => Promise<string>;
  getValidEvents?: (machineId: string, stateOrEntityId: string) => Promise<string[]>;
  initializeEntity?: (machineId: string, entityId: string, context?: Record<string, unknown>) => Promise<unknown>;
  send?: (machineId: string, entityId: string, event: string, context?: Record<string, unknown>) => Promise<TransitionPayload>;
};

let issueStateMachinePlugin: IssueStateMachinePluginLike | null = null;

function normalizeMachineDefinition(machineDefinition: unknown): IssueStateMachineDefinition {
  const definition = machineDefinition as Partial<IssueStateMachineDefinition>;
  return {
    initialState: typeof definition?.initialState === "string" ? definition.initialState : "Planned",
    states: definition?.states && typeof definition.states === "object" && !Array.isArray(definition.states)
      ? definition.states
      : (ISSUE_STATE_MACHINE_DEFINITION as IssueStateMachineDefinition).states,
  };
}

export function setIssueStateMachinePlugin(plugin: IssueStateMachinePluginLike | null): void {
  issueStateMachinePlugin = plugin;
}

export function getIssueStateMachinePlugin(): IssueStateMachinePluginLike | null {
  return issueStateMachinePlugin;
}

export function getIssueStateMachineDefinition(): unknown {
  return issueStateMachinePlugin?.getMachineDefinition?.(ISSUE_STATE_MACHINE_ID)
    || ISSUE_STATE_MACHINE_DEFINITION;
}

export function getIssueStateMachineInitialState(machineDefinition: unknown = getIssueStateMachineDefinition()): string {
  return normalizeMachineDefinition(machineDefinition).initialState;
}

function getIssueTransitionsFromStateDefinition(
  machineDefinition: unknown,
  state: string,
): string[] {
  const definition = normalizeMachineDefinition(machineDefinition);
  const direct = definition?.states?.[state]?.on;
  if (!direct || typeof direct !== "object") return [...ISSUE_STATE_TRANSITIONS[state as keyof typeof ISSUE_STATE_TRANSITIONS] ?? []];

  const next = Object.keys(direct);
  return next.length > 0 ? next : [state];
}

function getIssueTransitionsByState(machineDefinition: unknown): Record<string, string[]> {
  const definition = normalizeMachineDefinition(machineDefinition);
  const fallback = Object.entries(ISSUE_STATE_TRANSITIONS).reduce<Record<string, string[]>>(
    (acc, [state, states]) => {
      acc[state] = [...states];
      return acc;
    },
    {},
  );

  if (!definition?.states || typeof definition.states !== "object") {
    return fallback;
  }

  for (const [state, next] of Object.entries(definition.states)) {
    if (!next || typeof next !== "object") continue;
    const transitions = next.on;
    if (transitions && typeof transitions === "object") {
      fallback[state] = Object.keys(transitions);
    }
  }

  return fallback;
}

export function findIssueStateMachineTransitionPath(
  machineDefinition: unknown,
  from: string,
  to: string,
): string[] | null {
  if (from === to) return [];

  const definition = normalizeMachineDefinition(machineDefinition);
  const edges = definition.states || {};
  if (!edges[from] || !edges[to]) return null;

  const queue: string[] = [from];
  const previousState = new Map<string, string>();
  const previousEvent = new Map<string, string>();
  previousState.set(from, "");

  for (let i = 0; i < queue.length; i += 1) {
    const current = queue[i]!;
    const transitions = edges[current]?.on;
    if (!transitions || typeof transitions !== "object") continue;

    for (const [event, nextRaw] of Object.entries(transitions)) {
      if (typeof nextRaw !== "string") continue;
      const next = nextRaw;
      if (previousState.has(next)) continue;

      previousState.set(next, current);
      previousEvent.set(next, event);

      if (next === to) {
        const events = [];
        let cursor = next;
        while (cursor !== from) {
          const prev = previousState.get(cursor);
          const event = previousEvent.get(cursor);
          if (!prev || !event) return null;
          events.unshift(event);
          cursor = prev;
        }
        return events;
      }

      queue.push(next);
    }
  }

  return null;
}

