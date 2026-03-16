---
name: symphifony
description:
  Use the local Symphifony runtime and integration surface when working with
  orchestration state, issues, sessions, events, or MCP/REST interactions.
---

# Symphifony Integration Skill

Symphifony is the local multi-agent orchestrator managing your workflow. Use this skill to interact with the Symphifony runtime programmatically.

## REST API

Symphifony exposes local endpoints on the running server (default port configured in `WORKFLOW.md` or via `--port`):

### Runtime
- `GET /state` — full runtime snapshot.
- `GET /status` — health check.
- `GET /providers` — detected providers and availability.
- `GET /parallelism` — parallelism analysis.
- `POST /config/concurrency` — update worker concurrency with `{ "concurrency": number }`.
- `POST /refresh` — trigger a persistence refresh and broadcast.

### Issues and events
- `POST /issues/create` — create a new issue.
- `POST /issues/:id/state` — transition issue state.
- `POST /issues/:id/retry` — retry a terminal issue.
- `POST /issues/:id/cancel` — cancel an issue.
- `GET /issues/:id/pipeline` — get pipeline snapshot for one issue.
- `GET /issues/:id/sessions` — get session snapshots for one issue.
- `GET /events/feed?since=&kind=&issueId=` — feed with optional filters.

## MCP Tools

When running in MCP mode (`symphifony mcp`), the following tools are available:
- `symphifony.status`
- `symphifony.list_issues`
- `symphifony.create_issue`
- `symphifony.update_issue_state`
- `symphifony.integration_config`
- `symphifony.list_integrations`
- `symphifony.integration_snippet`
- `symphifony.resolve_capabilities`

## Completion Contract

When an agent finishes working on an issue, it should report status using:

### Preferred
1. `symphifony-result.json`

```json
{
  "status": "done",
  "summary": "Implemented the feature.",
  "nextPrompt": ""
}
```

Status values:
- `done`
- `continue`
- `blocked`
- `failed`

### Alternative
- `SYMPHIFONY_STATUS=done`
- `SYMPHIFONY_SUMMARY=...`

## Useful environment variables

- `SYMPHIFONY_ISSUE_ID`
- `SYMPHIFONY_ISSUE_IDENTIFIER`
- `SYMPHIFONY_ISSUE_TITLE`
- `SYMPHIFONY_WORKSPACE_PATH`
- `SYMPHIFONY_PROMPT`
- `SYMPHIFONY_PROMPT_FILE`
- `SYMPHIFONY_TURN_INDEX`
- `SYMPHIFONY_MAX_TURNS`
- `SYMPHIFONY_AGENT_PROVIDER`
- `SYMPHIFONY_AGENT_ROLE`
- `SYMPHIFONY_RESULT_FILE`
