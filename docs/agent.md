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
- Workspace: ogni run con progetto usa un worktree temporaneo (o una copia temporanea fuori da Git). File tool, comandi, generatori, download e package manager operano solo lì.
- Runtime: modello, endpoint, digest, opzioni e metriche vengono salvati nel checkpoint e rivalidati al resume. Senza un limite di contesto verificato, `num_ctx` conserva la capacità hardware invece di cadere a 2048.
- Identità run: comandi ed eventi di esecuzione trasportano sempre `runId`, `conversationId`, `planRevisionId` e `workspaceId`; il Renderer accetta solo eventi che coincidono con la run attiva.
- Ripresa: cronologia della conversazione e checkpoint esecutivo sono distinti. Si ripristinano step, recovery e milestone solo per la stessa run `IN_PROGRESS`; un nuovo prompt usa eventualmente il piano approvato come seme e azzera i budget.
- Cronologia: log e coda prompt sono scritti subito per conversazione tramite IPC serializzato e store atomico; la chiusura della finestra non è un percorso di persistenza.
- File attivo: il solo contesto editor trasmesso alla run è `activeFile` (`path`, `content`, `versionHash` SHA-256); l'IPC valida il contratto e scarta il legacy `contextFiles`.
- Piano e intervista: ogni flusso usa una `AgentRunIdentity` propria; una seconda richiesta resta bloccata finché la prima non termina o viene annullata tramite il suo `runId` nello scheduler Ollama.
- Coda: l'accettazione restituisce `runId` e `queuePosition`; l'annullamento richiede sempre l'identità della singola run.
- Timeline: gli eventi usano le categorie tipizzate di `AgentLogCategory`; la richiesta di generazione piano è informativa (`generic_info`).

## Guardrail

- [`planDirectiveArbiter.ts`](../electron/core/domain/agent/planDirectiveArbiter.ts): una direttiva operativa alla volta.
- [`loopDetector.ts`](../electron/core/domain/agent/loopDetector.ts): blocca ripetizioni e oscillazioni.
- [`compilerDiagnosticDirective.ts`](../electron/core/domain/agent/compilerDiagnosticDirective.ts): isola il primo errore utile.
- [`versionedFileMutation.ts`](../electron/core/domain/agent/versionedFileMutation.ts) e [`fileSystemRepository.ts`](../electron/core/infrastructure/filesystem/fileSystemRepository.ts): gli edit su file esistenti richiedono la versione letta e sono atomici.
- L'editor conserva l'hash letto e salva con compare-and-swap. Se una run modifica il file aperto, `workspace:file-version` forza una scelta esplicita tra ricarica, merge manuale e sovrascrittura confermata.
- Fuori dalle run isolate, il commit include solo i path approvati; il diff viene ricontrollato prima del commit.
- Prima della chiusura, l'app richiede il consenso per pubblicare le differenze del workspace temporaneo. Pubblica solo i path il cui contenuto sorgente coincide ancora con il baseline; annullamento, rifiuto o conflitto lasciano intatto il workspace utente e rimuovono quello temporaneo.
- `ensure_tool` installa fuori dal workspace e richiede sempre consenso esplicito. Dopo la pubblicazione, Git ricalcola il diff nel workspace utente e chiede un secondo consenso prima del commit.
- I path dei tool sono nomi opachi: gli spazi restano invariati. Prima delle mutazioni, il Main risolve l'antenato esistente e blocca symlink o junction che escono dal workspace.
- [`milestoneUpdateAuthority.ts`](../electron/core/domain/agent/milestoneUpdateAuthority.ts): una milestone diventa completa solo con deliverable reali e verifiche riuscite.
- [`verificationCommandSafety.ts`](../shared/domain/agent/verificationCommandSafety.ts): filtra comandi non sicuri.

Gli esiti tool sono strutturati (`success`, `failure`, `rejected`, `blocked`); errori incerti non vengono ripetuti automaticamente. La prova comportamentale corrente è descritta in [`verification.md`](./verification.md).
