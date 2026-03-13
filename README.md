# Symphony (symphifo)

Fork local do Symphony baseado no fluxo **TypeScript-only (Codex-only)**.

## O que mudou neste fork

- Removido fluxo Linear para execução local.
- Removido dependência de Elixir no bootstrap local.
- Pipeline local usando apenas memória (`memory`) para tracker.
- Dashboard local em `scripts/symphony-dashboard`.
- Wrapper de execução em `scripts/start-symphony.sh`.

## Como executar local

```bash
./scripts/start-symphony.sh --port 4040
```

Abra:

- `http://localhost:4040`

Sem dashboard:

```bash
./scripts/start-symphony.sh
```

## Arquivos principais

- `scripts/run-symphony-local.ts` — runtime local em TS.
- `scripts/start-symphony.sh` — entrypoint.
- `scripts/symphony-dashboard/index.html`
- `scripts/symphony-dashboard/app.js`
- `scripts/symphony-dashboard/styles.css`
- `scripts/symphony-local-issues.json` — catálogo local de issues.

## Estado local

- `~/.local/share/symphony-aozo/WORKFLOW.local.md`
- `~/.local/share/symphony-aozo/symphony-memory-state.json`
