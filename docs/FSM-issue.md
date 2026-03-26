# FSM Issue

## Responsabilidade

O FSM de issue em [src/persistence/plugins/fsm-issue.ts](/home/cyber/Work/FF/fifony/src/persistence/plugins/fsm-issue.ts) é a fonte de verdade do lifecycle da issue.

Ele deve concentrar:

- estados legais da issue
- transições permitidas entre estados
- guards de transição ligados ao lifecycle
- side effects de entrada de estado
- enqueue de jobs de `plan`, `execute` e `review`
- limpeza de workspaces de teste
- arquivamento de falhas anteriores
- timestamps e metadados próprios do lifecycle
- regras sobre estados terminais, reopen e archive

## O que já está no FSM

- grafo de estados `Planning -> PendingApproval -> Queued -> Running -> Reviewing -> PendingDecision -> Approved -> Merged/Cancelled/Archived`
- cron triggers de staleness em `Running` e `Reviewing`
- `onEnterPlanning`: reset de planning state e enqueue de planning
- guard `requireReadyExecutionPlan`: impede `Planning -> PendingApproval` e `PendingApproval -> Queued` sem plano pronto e, em modo `contractual`, sem `contractNegotiationStatus = approved`
- `onEnterQueued`: incremento de tentativas, archive de failure summaries, limpeza de erro, enqueue de execute
- `onEnterReviewing`: persistência de `reviewingAt` e enqueue de review
- `onEnterMerged` e `onEnterCancelled`: timestamps terminais, cleanup e persistência de diff stats
- guard `requireBlockReason`

## O que não pertence aqui

Não devem viver aqui:

- montagem de prompt
- parsing de output de modelo
- escolha de provider/model
- lógica de git merge detalhada
- validação de código baseada em comandos shell
- rendering de UI

## Onde ainda existem outras regras de negócio

As regras abaixo ainda existem fora do FSM de issue porque são de execução, integração externa ou infraestrutura:

- [src/persistence/plugins/fsm-agent.ts](/home/cyber/Work/FF/fifony/src/persistence/plugins/fsm-agent.ts)
  Política do harness, contract negotiation antes da execução, semântica de review, retries automáticos, interpretação de `grading_report`, auto-approve e validation gate após review.

- [src/commands/merge-workspace.command.ts](/home/cyber/Work/FF/fifony/src/commands/merge-workspace.command.ts)
  Regras de merge local, rebase antes do merge, resolution de conflitos e validation gate antes de merge.

- [src/commands/push-workspace.command.ts](/home/cyber/Work/FF/fifony/src/commands/push-workspace.command.ts)
  Regras de push/PR, integração com `gh`, compare URL fallback e validation gate antes de push.

- [src/domains/validation.ts](/home/cyber/Work/FF/fifony/src/domains/validation.ts)
  Execução do validation gate.

- [src/domains/workspace.ts](/home/cyber/Work/FF/fifony/src/domains/workspace.ts)
  Regras operacionais de worktree, diff stats, cleanup e rebase.

## Regra aplicada neste ciclo

- A execução de mudança de estado agora é centralizada como porta de domínio:
  - `transitionIssue()` em [src/domains/issues.ts](/home/cyber/Work/FF/fifony/src/domains/issues.ts) é o único ponto de entrada de negócio para transições.
  - O domínio só depende de `IssueTransitionExecutor` (injeção).
  - O executor é registrado em [src/persistence/container.ts](/home/cyber/Work/FF/fifony/src/persistence/container.ts) com `executeTransition`.
- A reconciliação de estado entre memória e FSM foi consolidada em [src/domains/issue-state.ts](/home/cyber/Work/FF/fifony/src/domains/issue-state.ts):
  - `syncIssueStateFromFsm()` lê o estado persistido no FSM e atualiza memória apenas quando divergente.
  - `syncIssueStateInMemory()` unifica o ajuste local (`state`, `updatedAt`, `history`, dirty flag).
- O worker de recuperação de órfãos agora dispara transições via `transitionIssue` em vez de chamar `fsm-issue` diretamente, reduzindo acoplamento com persistência:
  - [src/persistence/plugins/queue-workers.ts](/home/cyber/Work/FF/fifony/src/persistence/plugins/queue-workers.ts).

## Regra prática

Uma regra deve ir para o FSM de issue quando responde a qualquer destas perguntas:

- Em que estados isto pode acontecer?
- O que esta transição pode ou não pode fazer?
- Ao entrar neste estado, que side effects são obrigatórios?
- Esta regra altera o lifecycle visível da issue?

Se a resposta for sim, a regra provavelmente pertence aqui.
