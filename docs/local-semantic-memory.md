# Memória Semântica Local

## O que é

A Memória Semântica Local é a camada de embeddings e recuperação semântica do Fifony.

Ela existe para melhorar a montagem de contexto dos agentes sem depender de um banco vetorial externo. Em vez de usar só paths explícitos e busca lexical, o Fifony também consegue buscar contexto por similaridade semântica.

No código, isso é composto principalmente por:

- [src/agents/context-engine.ts](/home/cyber/Work/FF/fifony/src/agents/context-engine.ts)
- [src/agents/embedding-provider.ts](/home/cyber/Work/FF/fifony/src/agents/embedding-provider.ts)
- [src/persistence/resources/context-fragments.resource.ts](/home/cyber/Work/FF/fifony/src/persistence/resources/context-fragments.resource.ts)
- [src/persistence/store.ts](/home/cyber/Work/FF/fifony/src/persistence/store.ts)

## Nome recomendado

Se quisermos um nome técnico, o mais preciso é:

- `Semantic Context Engine`

Se quisermos um nome mais orientado a produto e UX, o melhor nome é:

- `Memória Semântica Local`

Esse segundo nome comunica melhor o comportamento real:

- roda localmente
- usa modelo open source por default
- compartilha cache entre projetos da mesma máquina
- entra como uma camada de memória/contexto dos agentes

## O que ela faz

Ela resolve quatro problemas:

1. Preparar um provider de embeddings local por default, com opção de usar provider remoto.
2. Manter um cache compartilhado de modelos em `~/.fifony/models/embeddings`.
3. Indexar fragments de contexto no store local do Fifony.
4. Enriquecer o `ContextPack` usado por planner, executor e reviewer.

Na prática, o contexto final dos agentes passa a combinar:

- paths explícitos
- busca lexical
- vizinhança estrutural
- memória de falhas e reviews
- recuperação semântica por embeddings

## Modelo default

Por default, o Fifony usa o modelo:

- `Xenova/all-MiniLM-L6-v2`

Ele é definido em [src/agents/embedding-provider.ts](/home/cyber/Work/FF/fifony/src/agents/embedding-provider.ts).

O store vetorial local foi fixado em:

- `384` dimensões

Isso está definido em [src/concerns/constants.ts](/home/cyber/Work/FF/fifony/src/concerns/constants.ts).

## Onde o modelo fica

O cache compartilhado atual fica em:

- `~/.fifony/models/embeddings`

Esse path é definido em [src/concerns/constants.ts](/home/cyber/Work/FF/fifony/src/concerns/constants.ts).

Se existir um cache legado dentro do workspace, o Fifony tenta migrar automaticamente para o cache global antes de baixar de novo. Essa lógica está em [src/agents/embedding-provider.ts](/home/cyber/Work/FF/fifony/src/agents/embedding-provider.ts).

## De onde o modelo vem

O download do modelo local é feito via:

- `@huggingface/transformers`

Na prática, isso significa que o Fifony baixa o modelo do Hugging Face Hub e persiste os artefatos no cache configurado.

## Quando essa funcionalidade entra no fluxo

### 1. Onboarding

No onboarding, o Fifony agora tenta fazer o `warmup` do provider de embeddings para deixar o modelo pronto antes do primeiro uso.

Ponto de entrada:

- [app/src/components/OnboardingWizard/index.jsx](/home/cyber/Work/FF/fifony/app/src/components/OnboardingWizard/index.jsx)

### 2. Settings / Providers

Na tela de providers, o usuário pode:

- escolher estratégia `auto`, `local`, `remote` ou `disabled`
- escolher o modelo local
- configurar endpoint remoto compatível com OpenAI embeddings
- disparar manualmente o `Warm model`

Ponto de entrada:

- [app/src/routes/settings/providers.jsx](/home/cyber/Work/FF/fifony/app/src/routes/settings/providers.jsx)

### 3. Runtime de contexto

Quando o Fifony monta o `ContextPack` de uma execução, ele consulta o provider de embeddings e o store vetorial local para puxar hits semânticos relevantes.

Esse é o ponto em que a Memória Semântica Local de fato entra no raciocínio dos agentes.

Pontos principais:

- [src/agents/context-engine.ts](/home/cyber/Work/FF/fifony/src/agents/context-engine.ts)
- [src/agents/agent-pipeline.ts](/home/cyber/Work/FF/fifony/src/agents/agent-pipeline.ts)
- [src/agents/planning/plan-generator.ts](/home/cyber/Work/FF/fifony/src/agents/planning/plan-generator.ts)
- [src/agents/planning/plan-refiner.ts](/home/cyber/Work/FF/fifony/src/agents/planning/plan-refiner.ts)

### 4. Fallback

Se embeddings estiverem desabilitados, mal configurados, ou indisponíveis, o Fifony continua funcionando com:

- busca lexical
- memória histórica
- paths explícitos
- heurísticas estruturais

Ou seja: embeddings melhoram o sistema, mas não são um hard dependency para o fluxo básico.

## API de warmup

Existe uma rota dedicada para preparar o provider de embeddings:

- `POST /api/providers/embeddings/warmup`

Ela serve para:

- predownload do modelo local
- reaproveitamento/migração do cache legado
- confirmação de que o provider está operacional

Implementação:

- [src/routes/settings.ts](/home/cyber/Work/FF/fifony/src/routes/settings.ts)

## Resumo prático

A Memória Semântica Local é a camada que prepara o modelo de embeddings, mantém cache global compartilhado entre projetos, indexa fragments no store local e melhora o contexto entregue aos agentes durante planning, execution e review.
