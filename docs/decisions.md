# Decisioni tecniche

Solo vincoli non ovvi che devono restare coerenti con il codice.

| Decisione | Motivo | Implementazione |
| --- | --- | --- |
| Main e Renderer comunicano solo via Preload/IPC, con un contratto unico tipizzato e payload a oggetto. | Riduce la superficie privilegiata del Renderer; preload, handler e tipi Renderer non possono divergere. | `shared/ipc/ipcContract.ts`, `electron/preload.ts`, `electron/core/presentation/`. |
| Una sola generazione Ollama Main alla volta. | Evita interferenze e pressione concorrente su VRAM/RAM. | `ollamaGenerationScheduler.ts`. |
| Il piano eseguibile è JSON strutturato; Markdown è derivato. | Evita perdita di decisioni e milestone durante il parsing. | `planGenerationAppService.ts`, `AgentPlan`. |
| Agent Coding usa Ask, Guided e Auto: Esegui avvia direttamente, Pianifica richiede una scelta esplicita in Guided e Auto. | L'utente decide se preparare e approvare un piano; la run usa poi la modalità scelta. | `AgentModeSelector.tsx`, `CodingAgentView.tsx`, `agentRuntimeMode.ts`. |
| Gli edit esistenti richiedono la versione letta e commit atomico. | Evita di sovrascrivere modifiche esterne. | `versionedFileMutation.ts`, `fileSystemRepository.ts`, `atomicWorkspaceJournal.ts`. |
| Una milestone richiede deliverable e prova coerenti. | Il testo del modello non è evidenza. | `milestoneDeliverableResolver.ts`, `milestoneVerificationPromotion.ts`. |
| Fallback embedding esplicito. | Un vettore CPU degradato non deve sembrare equivalente a uno Ollama. | `embeddings.py`, stato `indexed_fallback`. |
| I filtri dei document ID sono validati prima di LanceDB. | Evita interpolazioni non sicure nelle query. | `sidecar/infrastructure/db.py`. |
| `settings.json` accetta solo il formato versionato dal `userData` corrente. Gli archivi di sessioni/progetti e lo stato agente mancanti possono essere inizializzati; JSON illeggibile, versioni sconosciute, record incompleti e identità incoerenti bloccano le scritture dipendenti. Le sessioni e i seed legacy compatibili restano leggibili; la migrazione del layout `.onlyrag` conserva backup e verifica il readback. Un titolo non vuoto è un nome scelto dall'utente. | Preservare dati esistenti e compatibilità fino alla verifica su dati legacy reali. Nessuna migrazione personale, pulizia o ripresa automatica dei checkpoint; l'acknowledgement delle scritture durante la run resta un task distinto. | `appSettingsRepository.ts` (`decodeSettingsFile`), `sessionHistoryRepository.ts`, `agentSessionStateRepository.ts`, `workspaceMetadataDirectory.ts`; [archivi](./verification.md#session-store-preservation--2026-10-06), [stato agente](./verification.md#agent-state-preservation--2026-10-06). |

Quando cambia una di queste regole, aggiornare codice, test e questa tabella nello stesso passaggio.
