# FSM Service

## Responsabilidade

O FSM em [src/persistence/plugins/fsm-service.ts](/home/cyber/Work/FF/fifony/src/persistence/plugins/fsm-service.ts) modela services auxiliares do workspace.

Ele deve concentrar:

- estados `stopped`, `starting`, `running`, `stopping`, `crashed`
- start/stop idempotente
- watcher de processo
- grace period de startup
- kill timeout após `SIGTERM`
- auto-restart com backoff
- persistência do pid/state do service

## O que já está no FSM

- comandos `cmdStart` e `cmdStop`
- derivação de status por pid file
- transições automáticas `starting -> running`, `starting -> crashed`, `stopping -> stopped`
- crash counting e `nextRetryAt`
- auto-restart exponencial

## O que não pertence aqui

Não devem viver aqui:

- política do lifecycle de issue
- política do harness de agentes
- lógica de merge/push/review
- detalhes da UI de observabilidade

## Onde ainda existem outras regras de negócio

- [src/routes/services.ts](/home/cyber/Work/FF/fifony/src/routes/services.ts)
  Orquestração HTTP, validação de payload e orquestração de UI; o fluxo de estado real é consumido por
  [src/domains/services.ts](/home/cyber/Work/FF/fifony/src/domains/services.ts).

- [app/src/components/ServicePanel.jsx](/home/cyber/Work/FF/fifony/app/src/components/ServicePanel.jsx)
  Apresentação e UX.

- [src/persistence/plugins/scheduler.ts](/home/cyber/Work/FF/fifony/src/persistence/plugins/scheduler.ts)
  Coordenação global de runtime (recuperação, stale checks, shutdown) e fluxo de decisão macro, não o estado local de processo.

## Contrato da fronteira (nova)

- `src/domains/services.ts` é a fachada de domínio para operações de service:
  - listagem/status (`listServiceStatuses`, `getServiceRuntimeStatus`)
  - comando (`startManagedService`, `stopManagedService`)
  - reconcile e watcher (`reconcileManagedServiceStates`, `initManagedServiceWatcher`)
  - utilitários de observabilidade (`getManagedServiceLogPath`, `readServiceLogTail`)
- `src/boot.ts` e `src/routes/services.ts` devem preferir essa fachada e não importar diretamente
  `src/persistence/plugins/fsm-service.ts`.

## Regra prática

Uma regra deve ir para este FSM quando responde a qualquer destas perguntas:

- O processo está vivo, a arrancar, parado ou crashado?
- Quando podemos matar ou reiniciar automaticamente?
- O que acontece depois de `SIGTERM`?

Se a resposta for sim, a regra provavelmente pertence aqui.
