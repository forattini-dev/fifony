# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is fifony

Filesystem-backed local orchestrator with a TypeScript CLI, MCP mode, and multi-agent (Claude/Codex/Gemini) workflows. AI plans, executes, and reviews code — the user approves and merges. State lives in `.fifony/` (SQLite via s3db.js). No cloud, no accounts.

## Commands

```bash
pnpm dev              # API (port 4000) + frontend HMR (port 5173)
pnpm dev:api          # API only
pnpm dev:ui           # Frontend only (Vite, proxies to :4000)
pnpm build            # tsup (backend) + vite (frontend)
pnpm test             # node --import tsx/esm --test 'tests/**/*.test.ts'
pnpm mcp              # MCP server (stdio)
pnpm prompts:generate # Compile .md templates → src/agents/generated/prompts.ts
```

Always use **pnpm**. `prompts:generate` runs automatically before dev/build/start.

## Architecture

**Runtime:** Node.js 23+ ESM. **Backend:** TypeScript + s3db.js + Pino. **Frontend:** React 19 + TanStack Router/Query + Tailwind + DaisyUI. **Build:** tsup (backend) → `dist/`, Vite (frontend) → `app/dist/`.

### Hexagonal (Ports & Adapters)

- **Ports** (`src/ports/index.ts`): `IIssueRepository`, `IEventStore`, `IQueuePort`, `IPersistencePort`
- **Adapters** (`src/persistence/`): s3db-backed implementations with dirty tracking
- **Container** (`src/persistence/container.ts`): wires ports → adapters
- **Commands** (`src/commands/`): use-case handlers that depend on ports, not adapters. Key commands: `transitionIssueCommand` (generic BFS path finder), `approvePlanCommand`, `executeIssueCommand`, `replanIssueCommand`, `retryExecutionCommand`, `requestReworkCommand`, `cancelIssueCommand`, `mergeWorkspaceCommand`, `pushWorkspaceCommand`

### State Machine (Issue Lifecycle)

```
Planning → PendingApproval → Queued → Running → Reviewing → PendingDecision → Approved → Merged
  (AI)       (Human)          (queue)   (AI)      (AI)         (Human)          (Human)
```

10 states. Defined in `src/persistence/plugins/issue-state-machine.ts`. Transitions dispatched via s3db StateMachinePlugin. Entry actions enqueue jobs via lazy imports to break circular deps. Terminal states: `Merged`, `Cancelled`. Legacy state names (`Planned`, `Reviewed`, `Done`) auto-migrated via `parseIssueState()`.

**States by actor:**

| Actor | States | What happens |
|-------|--------|-------------|
| AI | Planning, Queued, Running, Reviewing | Machine is working — no human action needed |
| Human | PendingApproval, PendingDecision, Approved | Waiting for human decision (approve plan / approve+rework+replan / merge) |
| System | Blocked | Failed, waiting for retry or intervention |
| Terminal | Merged, Cancelled | Done |

**Kanban columns** map to actor, not state: Planning, Needs Approval (human), In Progress (AI), Blocked, Done.

#### FSM events

| Event | Transition | Trigger |
|-------|-----------|---------|
| PLANNED | Planning → PendingApproval | Plan generated |
| QUEUE | PendingApproval → Queued | `approvePlanCommand` |
| RUN | Queued → Running | Queue dispatch |
| REVIEW | Running → Reviewing | Execution succeeded |
| REVIEWED | Reviewing → PendingDecision | Review completed |
| APPROVE | PendingDecision → Approved | Reviewer approved |
| MERGE | Approved → Merged | User merges |
| BLOCK | Running/Reviewing → Blocked | Stale timeout or failure |
| UNBLOCK | Blocked → Queued | `retryExecutionCommand` |
| REPLAN | PendingApproval/PendingDecision/Blocked → Planning | `replanIssueCommand` |
| REQUEUE | PendingDecision → Queued | `requestReworkCommand` (reviewer rework) |
| CANCEL | Most states → Cancelled | `cancelIssueCommand` |
| REOPEN | Merged/Cancelled → Planning | Reopen for rework |

#### Retry semantics — plan, execute, and review retries are distinct operations

| Operation | Command | FSM path | Counters affected |
|-----------|---------|----------|-------------------|
| Plan (1st) | auto (`onEnterPlanning`) | `→ Planning` | `planVersion` 0→1 |
| **Replan** | `replanIssueCommand` | `→ Planning` | `planVersion++`, archives plan to `planHistory`, resets `executeAttempt`/`reviewAttempt` |
| Execute (1st) | `executeIssueCommand` | `PendingApproval → Queued` | `executeAttempt` 0→1 (at run time) |
| **Re-execute** | `retryExecutionCommand` | `Blocked → Queued` | `attempts++` (budget), `executeAttempt++` at run time. `onEnterQueued` archives failure to `previousAttemptSummaries`. `buildRetryContext()` injects prior failure insights into prompt |
| Review (1st) | auto (`onEnterReviewing`) | `Running → Reviewing` | `reviewAttempt` 0→1 |
| **Rework** (re-review) | `requestReworkCommand` | `Reviewing → PendingDecision → Queued` | `attempts++`, `lastFailedPhase="review"`. Reviewer feedback archived via `onEnterQueued` |

Each variant has its own artifact versioning: `plan.v{N}`, `execute.v{N}a{M}`, `review.v{N}a{M}`.

### Key Layers

| Layer | Path | Role |
|-------|------|------|
| Types | `src/types.ts` | All domain types (`IssueEntry`, `RuntimeState`, `IssueState`) |
| Constants | `src/concerns/constants.ts` | Paths, env resolution, `ALLOWED_STATES`, `TERMINAL_STATES` |
| Domains | `src/domains/` | Pure business logic — no I/O (issues, workspace/git, project, config) |
| Persistence | `src/persistence/` | s3db resources, plugins, dirty tracker, store |
| Routes | `src/routes/` | HTTP handlers — registered via `register*Routes(collector, state)` in `api-server.ts` |
| Agents | `src/agents/` | Provider detection, CLI wrapping, prompt rendering, session tracking |
| Commands | `src/commands/` | Hexagonal use-case handlers |
| MCP | `src/mcp/` | MCP server (stdio transport, JSON-RPC 2.0) |
| CLI | `src/cli.ts` | Entry point, arg parsing, command dispatch |
| Boot | `src/boot.ts` | Process entry: setup → store → early API → load state → detect → queue init → hold. No scheduler loop — queue is event-driven |

### Frontend

File-based routing via TanStack Router in `app/src/routes/`. Key views: `/kanban` (board), `/issues` (list), `/agents` (cockpit), `/analytics`, `/settings`. PWA with service worker. Vite proxies `/api` and `/ws` to backend in dev.

### Persistence (s3db.js)

SQLite at `.fifony/fifony.sqlite`. Resources: `issues`, `events`, `runtime_state`, `settings`, `agent_sessions`, `agent_pipelines`. Plugins: StateMachinePlugin (FSM), S3QueuePlugin (job queue), ApiPlugin (HTTP+WS). In-memory dirty tracking — only modified issues flush to disk.

### Unified Work Queue

`src/persistence/plugins/queue-workers.ts` — single queue replaces the old 3-queue system and scheduler loop.

- **Phase ordering**: review → execute → plan. Closest-to-done drains first.
- **Semaphore**: shared `workerConcurrency` limit. Planning runs outside (doesn't occupy a slot).
- **Dispatch guards**: `canDispatch()` checks assignedToWorker, terminal states, deps resolved, agent alive — absorbed from the deleted `canRunIssue`.
- **Periodic tasks**: stale check (30s interval), persist (5s interval) — replaces the old boot.ts polling loop.
- **Boot recovery**: `recoverState()` reconciles FSM, enqueues in-progress issues. `recoverOrphans()` handles PID recovery. `cleanTerminalWorkspaces()` cleans merged/cancelled.
- **No scheduler, no polling** — dispatch is event-driven via `enqueue()` → `drain()`.

## Testing

Uses Node.js native `node:test` module with `assert/strict`. Tests in `tests/`. Temp dirs via `mkdtempSync`, cleanup with `after()` hooks.

## Patterns to Follow

- **Logger**: `import { logger } from "../concerns/logger.ts"` — Pino singleton. Always `logger.error({ err }, "msg")` with the error object.
- **Dirty tracking**: Call `markIssueDirty(id)` after mutating an issue in-memory.
- **Circular deps**: FSM entry actions use lazy `await import()` for queue-workers.
- **Route registration**: Export `register*Routes(collector, state)`, call from `api-server.ts`.
- **Domain purity**: `src/domains/` must not import from `src/persistence/` or do I/O.
- **State transitions**: Go through the state machine (`send()`), never mutate `issue.state` directly.
- **Retry semantics**: Use the specific command for each retry type — `replanIssueCommand` for re-planning, `retryExecutionCommand` for re-execution from Blocked, `requestReworkCommand` for reviewer-requested rework. Never conflate them — they have different counter resets, FSM paths, and prompt injection.
- **Queue dispatch**: Use `enqueue(issue, "plan"|"execute"|"review")` — never call `runIssueOnce` or `runPlanningJob` directly. The queue handles concurrency, guards, and ordering.
- **No scheduler**: The unified queue handles stale checks and persist via intervals. `boot.ts` just holds the process alive after queue init.

## tsup Entry Points

| Entry | Source | Output |
|-------|--------|--------|
| CLI | `src/cli.ts` | `dist/cli.js` |
| Agent runner | `src/boot.ts` | `dist/agent/run-local.js` |
| CLI wrapper | `src/agents/cli-wrapper.ts` | `dist/agent/cli-wrapper.js` |
| MCP server | `src/mcp/server.ts` | `dist/mcp/server.js` |
