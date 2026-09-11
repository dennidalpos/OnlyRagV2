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

## Guardrail

- [`planDirectiveArbiter.ts`](../electron/core/domain/agent/planDirectiveArbiter.ts): una direttiva operativa alla volta.
- [`loopDetector.ts`](../electron/core/domain/agent/loopDetector.ts): blocca ripetizioni e oscillazioni.
- [`compilerDiagnosticDirective.ts`](../electron/core/domain/agent/compilerDiagnosticDirective.ts): isola il primo errore utile.
- [`versionedFileMutation.ts`](../electron/core/domain/agent/versionedFileMutation.ts) e [`fileSystemRepository.ts`](../electron/core/infrastructure/filesystem/fileSystemRepository.ts): gli edit su file esistenti richiedono la versione letta e sono atomici.
- [`milestoneUpdateAuthority.ts`](../electron/core/domain/agent/milestoneUpdateAuthority.ts): una milestone diventa completa solo con deliverable reali e verifiche riuscite.
- [`verificationCommandSafety.ts`](../shared/domain/agent/verificationCommandSafety.ts): filtra comandi non sicuri.

Gli esiti tool sono strutturati (`success`, `failure`, `rejected`, `blocked`); errori incerti non vengono ripetuti automaticamente. La prova comportamentale corrente è descritta in [`verification.md`](./verification.md).
