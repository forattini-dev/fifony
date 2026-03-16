<div align="center">

# Fifony

**AI agents that actually ship code. You just watch.**

Point at a repo. Open the dashboard. AI plans, builds, and reviews — you approve.

One command. Full orchestra.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)]()

</div>

---

## Quick Start

```bash
npx -y fifony --port 4040
```

Open **http://localhost:4040**. First run launches the **onboarding wizard** — it detects your CLIs, scans your project, and configures everything.

State lives in `.fifony/`. No accounts, no cloud, no setup.

---

## What Makes Fifony Different

### Mixed-Agent Pipeline

The core idea: **different AI providers handle different stages** of a single task.

```
  Plan          Execute        Review
┌─────────┐   ┌─────────┐   ┌─────────┐
│ Claude   │──▶│ Codex   │──▶│ Claude  │
│ Opus 4.6 │   │         │   │ Sonnet  │
│ high     │   │ medium  │   │ medium  │
└─────────┘   └─────────┘   └─────────┘
```

Claude plans. Codex executes. Claude reviews. Each stage gets its own **provider**, **model**, and **reasoning effort** — configurable per-project in Settings → Workflow.

### Onboarding Wizard

First run detects your environment and walks you through setup:

1. **Pipeline** — Choose which CLI runs each stage (planner, executor, reviewer)
2. **Project Scan** — AI analyzes your codebase to detect language, stack, and domains
3. **Domains** — Pre-selected by AI, 21 options across Technical/Industry/Role
4. **Agents & Skills** — Curated catalog of 15 agents and 5 skills, auto-recommended by domain
5. **Effort** — Per-stage reasoning effort, reactive to which CLI is selected
6. **Workers & Theme** — Parallel worker count + visual theme

Settings saved progressively. Re-run anytime from Settings.

### Language Agnostic

The project scanner works with any codebase — it detects build files for 18+ ecosystems:

`package.json` · `Cargo.toml` · `pyproject.toml` · `go.mod` · `build.gradle` · `Gemfile` · `mix.exs` · `pubspec.yaml` · `CMakeLists.txt` · `composer.json` · `Package.swift` · `deno.json` · `pom.xml` · `Dockerfile` · and more

Uses the detected CLI with `--reasoning-effort low` for fast, accurate analysis.

---

## How It Works

```
Planning → Todo → Queued → Running → In Review → Done
    ↑                                      ↓
    └──── Blocked ←── Rework ──────────────┘
```

1. **Create an Issue** — Click "+", describe what you want done
2. **AI Plans It** — Structured execution plan with steps, risks, file paths, complexity
3. **You Approve** — Review the plan, approve → agents pick it up
4. **Agents Execute** — Isolated workspace, live output streaming, PID tracking
5. **Automated Review** — Diff inspection, approve/rework/block decision
6. **You Ship** — Review the diff, merge

---

## Dashboard

| Page | What you see |
|------|-------------|
| **Kanban** | Drag-and-drop board. Cards flow through the pipeline with state-colored borders and stagger animations. |
| **Issues** | Searchable list with descriptions, labels, token usage, duration, and filter chips by state. |
| **Agents** | Live cockpit with agent slots, real-time log output, queue, token usage sparkline. |
| **Settings** | Tabbed: General, Workflow (pipeline config), Notifications, Providers. |

### Kanban Drag & Drop

Drag issues between columns to change state. Works on desktop (click + drag) and mobile (long-press). Valid drop targets highlight green, invalid ones dim. State machine enforces valid transitions only.

### Micro-interactions

Every interaction has visual feedback:

- **Cards** lift on hover with state-colored left border
- **Running cards** pulse with a breathing border glow
- **Buttons** scale on press, hover lift
- **Toasts** slide in with progress bar, typed as success/error/info
- **Drawers** slide in/out with backdrop fade
- **View transitions** fade between routes
- **Theme changes** cross-fade in 300ms
- **Counters** bounce when values change
- **Skeleton loaders** shimmer during initial load
- **Empty states** animate in with helpful guidance
- **Confetti** bursts on issue creation

### PWA

Install as a desktop app. Works offline. Desktop notifications when issues change state. Service worker with stale-while-revalidate caching.

---

## Agent & Skill Catalog

Fifony ships with a curated catalog of specialist agents:

| Agent | Domain |
|-------|--------|
| Frontend Developer | React, Vue, CSS, responsive design |
| Backend Architect | APIs, microservices, scalable systems |
| Database Optimizer | Schema design, query optimization, indexing |
| Security Engineer | OWASP, threat modeling, secure code review |
| DevOps Automator | CI/CD, Docker, Kubernetes, cloud infra |
| Mobile App Builder | iOS, Android, React Native, Flutter |
| AI Engineer | ML models, LLM integration, data pipelines |
| UI Designer | Visual design, component libraries, design systems |
| UX Architect | UX patterns, accessibility, information architecture |
| Code Reviewer | Code quality, best practices, constructive feedback |
| Technical Writer | Docs, READMEs, API references, tutorials |
| SRE | Reliability, observability, incident response |
| Data Engineer | ETL, data warehousing, analytics infrastructure |
| Software Architect | System design, DDD, architectural patterns |
| Game Designer | Game mechanics, level design, cross-engine |

Skills: `commit`, `review-pr`, `debug`, `testing`, `impeccable` (frontend design).

Agents are installed to `.claude/agents/` during onboarding. Compatible with both Claude Code and Codex CLI.

---

## MCP Server

Use Fifony as tools inside your editor:

```bash
npx -y fifony mcp
```

```json
{
  "mcpServers": {
    "fifony": {
      "command": "npx",
      "args": ["-y", "fifony", "mcp", "--workspace", "/path/to/repo"]
    }
  }
}
```

Create issues, check status, review workflows — without leaving the editor.

---

## API

REST + WebSocket API with auto-generated OpenAPI docs:

```
http://localhost:4040/docs
```

| Endpoint | Description |
|----------|-------------|
| `GET /api/state` | Runtime state with issues, metrics, config |
| `POST /api/issues/create` | Create a new issue |
| `POST /api/issues/:id/plan` | Generate AI execution plan |
| `POST /api/issues/:id/approve` | Approve plan, start execution |
| `GET /api/live/:id` | Live agent output (PID, log tail, elapsed) |
| `GET /api/diff/:id` | Git diff of workspace changes |
| `GET /api/config/workflow` | Pipeline workflow configuration |
| `GET /api/scan/project` | Project structure scan |
| `POST /api/scan/analyze` | AI-powered project analysis |
| `GET /api/catalog/agents` | Agent catalog (filterable by domain) |
| `POST /api/install/agents` | Install agents to project |
| `GET /api/settings` | All persisted settings |
| `/ws` | WebSocket for real-time state updates |

---

## Run Modes

```bash
# Full experience — dashboard + API + scheduler
npx -y fifony --port 4040

# Dev mode — Vite HMR on port+1
npx -y fifony --port 4040 --dev

# Headless — scheduler only, no UI
npx -y fifony

# MCP server — stdio for editor integration
npx -y fifony mcp

# Custom workspace
npx -y fifony --workspace /path/to/repo --port 4040
```

---

## Architecture

```
.fifony/                ← all state (gitignore it)
  s3db/                     ← durable database (issues, events, sessions, settings)
  source/                   ← codebase snapshot
  workspaces/               ← isolated per-issue agent workspaces
```

**Persistence**: [s3db.js](https://github.com/forattini-dev/s3db.js) — filesystem-backed database. Issues, events, settings, agent sessions — all persisted and recoverable across restarts.

**State Machine**: `Planning → Todo → Queued → Running → Interrupted → In Review → Blocked → Done → Cancelled`

**Agent Protection**: Detached child processes survive server restarts. PID tracking for recovery. Graceful shutdown marks running issues as Interrupted.

**Token Tracking**: Per-model token usage with daily/weekly rollups and cost estimates.

---

## Credits

Fifony is built on the shoulders of:

- **[OpenAI Codex CLI](https://github.com/openai/codex)** — Original foundation (Apache 2.0). See [NOTICE](NOTICE) and [THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES.md).
- **[Agency Agents](https://github.com/msitarzewski/agency-agents)** — Inspiration for the agent catalog.
- **[Impeccable](https://github.com/pbakaus/impeccable)** — Frontend design skill system by Paul Bakaus.
- **[s3db.js](https://github.com/forattini-dev/s3db.js)** — Filesystem-backed persistence layer.
- **[DaisyUI](https://daisyui.com)** — Component library for the dashboard.

---

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.

This project includes code from OpenAI Codex CLI. See [NOTICE](NOTICE) for attribution.
