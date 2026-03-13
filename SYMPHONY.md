# Symphony setup for AoZO / Black Citadel (Codex-only)

Este projeto agora roda Symphony com **runtime TypeScript local**, sem Linear e sem Elixir.

## Estrutura

- Workflow de orquestração: [WORKFLOW.md](./WORKFLOW.md)
- Bootstrap local: [scripts/run-symphony-local.ts](./scripts/run-symphony-local.ts)
- Wrapper shell: [scripts/start-symphony.sh](./scripts/start-symphony.sh)

## Regras do fork `symphifo`

- Modo padrão e único: `memory`.
- Sem integração externa de tracker.
- Sem runtime Elixir no bootstrap.
- Ideal para execução local com Codex e issues em JSON local.

## Variáveis de ambiente

```bash
export SYMPHONY_TRACKER_KIND=memory
export SYMPHONY_BOOTSTRAP_ROOT=$HOME/.local/share/symphony-aozo
export SYMPHONY_MEMORY_ISSUES_FILE=/path/to/issues.json
```

Opcional (JSON inline para testes):

```bash
export SYMPHONY_MEMORY_ISSUES_JSON='[{"id":"LOCAL-1","title":"Validar fluxo","description":"...","state":"Todo"}]'
```

## Start

```bash
pnpm exec tsx ./scripts/run-symphony-local.ts
```

Ou via wrapper:

```bash
./scripts/start-symphony.sh
```

Observabilidade local:

```bash
pnpm exec tsx ./scripts/run-symphony-local.ts --port 4040
# ou
./scripts/start-symphony.sh --port 4040
```

## O que é feito no bootstrap

- Cria snapshot local da workspace em `~/.local/share/symphony-aozo/aozo-source`.
- Renderiza `WORKFLOW.md` para `WORKFLOW.local.md` em modo `memory`.
- Carrega issues do arquivo definido em `SYMPHONY_MEMORY_ISSUES_FILE`.
- Executa o ciclo local de processamento de issues com runtime TS.
- Gera estado em `~/.local/share/symphony-aozo/symphony-memory-state.json`.
- Opcionalmente sobe dashboard HTML/JSON em `--port`.
