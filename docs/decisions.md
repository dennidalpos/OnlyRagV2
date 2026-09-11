# Decisioni tecniche

Solo vincoli non ovvi che devono restare coerenti con il codice.

| Decisione | Motivo | Implementazione |
| --- | --- | --- |
| Main e Renderer comunicano solo via Preload/IPC. | Riduce la superficie privilegiata del Renderer. | `electron/preload.ts`, `electron/core/presentation/`, `shared/`. |
| Una sola generazione Ollama Main alla volta. | Evita interferenze e pressione concorrente su VRAM/RAM. | `ollamaGenerationScheduler.ts`. |
| Il piano eseguibile è JSON strutturato; Markdown è derivato. | Evita perdita di decisioni e milestone durante il parsing. | `planGenerationAppService.ts`, `AgentPlan`. |
| Gli edit esistenti richiedono la versione letta e commit atomico. | Evita di sovrascrivere modifiche esterne. | `versionedFileMutation.ts`, `fileSystemRepository.ts`, `atomicWorkspaceJournal.ts`. |
| Una milestone richiede deliverable e prova coerenti. | Il testo del modello non è evidenza. | `milestoneDeliverableResolver.ts`, `milestoneVerificationPromotion.ts`. |
| Fallback embedding esplicito. | Un vettore CPU degradato non deve sembrare equivalente a uno Ollama. | `embeddings.py`, stato `indexed_fallback`. |
| I filtri dei document ID sono validati prima di LanceDB. | Evita interpolazioni non sicure nelle query. | `sidecar/infrastructure/db.py`. |
| Le migrazioni da localStorage sono one-shot. | I dati correnti devono avere una sola fonte persistente. | `useSessionHistory.ts`, `useWorkspaceProjects.ts`, handler `migrate-legacy`. |

Quando cambia una di queste regole, aggiornare codice, test e questa tabella nello stesso passaggio.
