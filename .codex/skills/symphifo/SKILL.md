# Symphifo Integration Skill

Symphifo is the local multi-agent orchestrator managing your workflow. Use this skill to interact with the Symphifo runtime programmatically.

## REST API

The Symphifo dashboard exposes a REST API (default port configured in WORKFLOW.md or via `--port`):

### Issues
- `GET /api/issues` — List all issues. Filter with `?state=Todo` or `?category=backend`.
- `POST /api/issues` — Create a new issue. Body: `{ title, description, priority?, labels?, paths?, blockedBy? }`.
- `PUT /api/issues/:id` — Update an issue. Body: `{ title?, description?, priority?, labels?, paths?, blockedBy? }`.
- `DELETE /api/issues/:id` — Delete an issue.
- `POST /api/issue/:id/state` — Transition state. Body: `{ state: "Todo" | "In Progress" | "Blocked" | "Done" | "Cancelled" }`.
- `POST /api/issue/:id/retry` — Reset a terminal issue back to Todo for retry.
- `POST /api/issue/:id/cancel` — Cancel an issue.

### Pipeline & Sessions
- `GET /api/issue/:id/pipeline` — Get the agent pipeline state for an issue.
- `GET /api/issue/:id/sessions` — Get all agent session snapshots for an issue.

### Runtime
- `GET /api/state` — Full runtime state snapshot.
- `GET /api/health` — Health check.
- `GET /api/providers` — Detected agent providers (claude, codex) with availability status.
- `GET /api/parallelism` — Analysis of safe parallelism for current Todo issues.
- `POST /api/config/concurrency` — Update worker concurrency at runtime. Body: `{ concurrency: number }`.
- `GET /api/events` — Recent runtime events. Filter with `?issueId=`, `?kind=`, `?since=`.

## Reporting Status

When an agent finishes working on an issue, it should report its status using one of these methods:

### Option 1: `symphifo-result.json` (preferred)
Write a JSON file in the workspace root:
```json
{
  "status": "done",
  "summary": "Implemented the feature and added tests.",
  "nextPrompt": ""
}
```

Status values:
- `done` — Work is complete.
- `continue` — More turns needed. Provide `nextPrompt` with guidance for the next turn.
- `blocked` — Manual intervention required. Explain in `summary`.
- `failed` — Unrecoverable failure.

### Option 2: stdout markers
Print to stdout:
```
SYMPHIFO_STATUS=done
SYMPHIFO_SUMMARY=Implemented the feature.
```

## Creating Sub-Issues

Use the REST API to create related issues:
```bash
curl -X POST http://localhost:PORT/api/issues \
  -H 'Content-Type: application/json' \
  -d '{"title":"Fix tests after refactor","description":"...","blockedBy":["PARENT-ID"],"labels":["bugfix"]}'
```

## MCP Tools

When running in MCP mode (`symphifo mcp`), the following tools are available:
- `symphifo.status` — Get runtime status.
- `symphifo.list_issues` — List issues with optional filters.
- `symphifo.create_issue` — Create a new issue.
- `symphifo.update_issue_state` — Transition an issue's state.
- `symphifo.retry_issue` — Retry a failed/cancelled issue.
- `symphifo.get_issue_pipeline` — Get pipeline details for an issue.
- `symphifo.get_issue_sessions` — Get session history for an issue.

## Environment Variables

When your agent process is invoked, these env vars are set:
- `SYMPHIFO_ISSUE_ID` / `SYMPHIFO_ISSUE_IDENTIFIER` / `SYMPHIFO_ISSUE_TITLE`
- `SYMPHIFO_WORKSPACE_PATH` — The isolated workspace directory.
- `SYMPHIFO_PROMPT` / `SYMPHIFO_PROMPT_FILE` — The task prompt.
- `SYMPHIFO_TURN_INDEX` / `SYMPHIFO_MAX_TURNS` — Current turn info.
- `SYMPHIFO_AGENT_PROVIDER` / `SYMPHIFO_AGENT_ROLE` — Provider and role.
- `SYMPHIFO_RESULT_FILE` — Path where you should write `symphifo-result.json`.
- `SYMPHIFO_CONTINUE` — `"1"` if this is a continuation turn.
