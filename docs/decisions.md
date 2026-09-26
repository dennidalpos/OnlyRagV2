# Decisioni tecniche

Solo vincoli non ovvi che devono restare coerenti con il codice.

| Decisione | Motivo | Implementazione |
| --- | --- | --- |
| Main e Renderer comunicano solo via Preload/IPC, con un contratto unico tipizzato e payload a oggetto. | Riduce la superficie privilegiata del Renderer; preload, handler e tipi Renderer non possono divergere. | `shared/ipc/ipcContract.ts`, `electron/preload.ts`, `electron/core/presentation/`. |
| Una sola generazione Ollama Main alla volta. | Evita interferenze e pressione concorrente su VRAM/RAM. | `ollamaGenerationScheduler.ts`. |
| Il piano eseguibile è JSON strutturato; Markdown è derivato. | Evita perdita di decisioni e milestone durante il parsing. | `planGenerationAppService.ts`, `AgentPlan`. |
| Agent Coding usa Ask, Guided e Auto con una sola azione Esegui. | Separa analisi read-only, revisione predefinita e autonomia locale; i task complessi pianificano automaticamente. | `AgentModeSelector.tsx`, `automaticPlanningPolicy.ts`, `agentRuntimeMode.ts`. |
| Gli edit esistenti richiedono la versione letta e commit atomico. | Evita di sovrascrivere modifiche esterne. | `versionedFileMutation.ts`, `fileSystemRepository.ts`, `atomicWorkspaceJournal.ts`. |
| Una milestone richiede deliverable e prova coerenti. | Il testo del modello non è evidenza. | `milestoneDeliverableResolver.ts`, `milestoneVerificationPromotion.ts`. |
| Fallback embedding esplicito. | Un vettore CPU degradato non deve sembrare equivalente a uno Ollama. | `embeddings.py`, stato `indexed_fallback`. |
| I filtri dei document ID sono validati prima di LanceDB. | Evita interpolazioni non sicure nelle query. | `sidecar/infrastructure/db.py`. |
| Nessuna migrazione da layout precedenti: `settings.json` è accettato solo nel formato versionato e solo dal `userData` corrente (nessuna copia da altre cartelle), gli store di sessioni, progetti e stato agente solo nella struttura corrente, e un titolo di sessione o conversazione non vuoto è sempre un nome dell'utente. | Installazione mono-utente; la cronologia è stata azzerata il 2026-09-26 dopo aver portato ogni store al formato corrente. | `appSettingsRepository.ts` (`decodeSettingsFile`), `sessionHistoryRepository.ts`, `sessionHistoryDomain.ts`, `agentSessionStateRepository.ts`. |

Quando cambia una di queste regole, aggiornare codice, test e questa tabella nello stesso passaggio.
