# Coding Agent

Il ciclo è coordinato da [`agentOrchestratorAppService.ts`](../electron/core/application/agentOrchestratorAppService.ts). Il modello propone; Main autorizza, esegue, verifica e decide la chiusura.

```text
plan/interview -> plan -> collect_context -> propose_action -> apply_action
                                                        -> verify -> outcome
```

## Contratti operativi

- Intervista e piano: `/api/chat` non streaming con `format` JSON Schema da [`ollamaStructuredResponse.ts`](../electron/core/domain/agent/ollamaStructuredResponse.ts).
- Loop: `/api/chat` con `tools`; il fallback testuale resta per modelli senza `tool_calls` nativi.
- Policy: [`turnToolPolicy.ts`](../electron/core/domain/agent/turnToolPolicy.ts) limita i tool per turno; gate ed executor ricontrollano la stessa allowlist.
- Piano: `AgentPlan` strutturato (`formatVersion: 2`); il Markdown è una vista, non la fonte di esecuzione.
- Contesto: `projectPlanningFacts.ts`, `planPromptWindow.ts` e `episodicMemoryCompactor.ts` limitano fatti, file e cronologia al lavoro corrente.
- Runtime: modello, endpoint, digest, opzioni e metriche vengono salvati nel checkpoint e rivalidati al resume.
- Identità run: comandi ed eventi di esecuzione trasportano sempre `runId`, `conversationId`, `planRevisionId` e `workspaceId`; il Renderer accetta solo eventi che coincidono con la run attiva.
- Timeline: gli eventi usano le categorie tipizzate di `AgentLogCategory`; la richiesta di generazione piano è informativa (`generic_info`).

## Guardrail

- [`planDirectiveArbiter.ts`](../electron/core/domain/agent/planDirectiveArbiter.ts): una direttiva operativa alla volta.
- [`loopDetector.ts`](../electron/core/domain/agent/loopDetector.ts): blocca ripetizioni e oscillazioni.
- [`compilerDiagnosticDirective.ts`](../electron/core/domain/agent/compilerDiagnosticDirective.ts): isola il primo errore utile.
- [`versionedFileMutation.ts`](../electron/core/domain/agent/versionedFileMutation.ts) e [`fileSystemRepository.ts`](../electron/core/infrastructure/filesystem/fileSystemRepository.ts): gli edit su file esistenti richiedono la versione letta e sono atomici.
- L'editor conserva l'hash letto e salva con compare-and-swap. Se una run modifica il file aperto, `workspace:file-version` forza una scelta esplicita tra ricarica, merge manuale e sovrascrittura confermata.
- Il commit include solo i path modificati dalla run. L'approvazione mostra il diff esatto, che viene ricontrollato prima del commit; il commit riuscito diventa il nuovo confine di rollback.
- I path dei tool sono nomi opachi: gli spazi restano invariati. Prima delle mutazioni, il Main risolve l'antenato esistente e blocca symlink o junction che escono dal workspace.
- [`milestoneUpdateAuthority.ts`](../electron/core/domain/agent/milestoneUpdateAuthority.ts): una milestone diventa completa solo con deliverable reali e verifiche riuscite.
- [`verificationCommandSafety.ts`](../shared/domain/agent/verificationCommandSafety.ts): filtra comandi non sicuri.

Gli esiti tool sono strutturati (`success`, `failure`, `rejected`, `blocked`); errori incerti non vengono ripetuti automaticamente. La prova comportamentale corrente è descritta in [`verification.md`](./verification.md).
