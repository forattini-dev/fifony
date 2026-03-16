---
tracker:
  kind: filesystem
workspace:
  root: ./.symphifony/workspaces
agent:
  provider: codex
  profile: ""
  max_concurrent_agents: 2
  max_attempts: 3
  max_turns: 4
  providers:
    - provider: claude
      role: planner
      profile: ""
    - provider: codex
      role: executor
      profile: ""
    - provider: claude
      role: reviewer
      profile: ""
codex:
  command: ""
claude:
  command: ""
routing:
  enabled: true
  priorities: {}
  overrides: []
---

You are working on {{ issue.identifier }}.

Title: {{ issue.title }}
Description:
{{ issue.description }}

Target paths:
{{ issue.paths }}
