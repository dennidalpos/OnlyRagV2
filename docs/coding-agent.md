# Coding Agent

Il modello propone piani e azioni; Main decide cosa eseguire, verifica file/comandi e registra esiti. Il percorso è `intervista/piano → contesto → azione → verifica → risultato`. I contratti e le regole sono in [`shared/ipc/ipcContract.ts`](../shared/ipc/ipcContract.ts), [`electron/core/domain/agent/`](../electron/core/domain/agent/) e [`electron/core/application/`](../electron/core/application/).

## Uso e confini

- Ask legge; Guided e Auto usano il piano JSON e l'identità immutabile di run, conversazione, revisione e workspace. Esegui parte subito; Pianifica richiede la scelta esplicita prevista dalla modalità.
- Una modifica di file esistente richiede la versione letta. Il journal protegge lo step e conserva checkpoint sotto `.onlyrag/checkpoints`; Stop lascia il lavoro e il ripristino è esplicito.
- Comandi, rete, installazioni e commit passano dai controlli della modalità e del profilo acquisito all'avvio. Una verifica è `verified` solo quando le prove richieste passano; il testo del modello non basta.
- La pianificazione lega richiesta originale, condizioni, target e revisione. Risposte incomplete o riferimenti inventati sono rifiutati. La cronologia di prove live e i marker di budget restano separati dal codice corrente.
- La persistenza di sessioni e stato agente rifiuta originali illeggibili e scritture non confermate. Il recupero dopo chiusura/crash di snapshot rimasti solo in memoria è ancora aperto.

## Qualificazione

I guard e gli scenari isolati dimostrano la meccanica dichiarata. Le campagne `qwen3.5:9b` non hanno prodotto una sequenza TaskLab completa né qualificato l'estrazione e la pianificazione generale. Non avviare nuove campagne real-model dal solo tracker. La [qualifica delle verifiche native](./verification-native-projects-2026-10-19.md) e le [regressioni su root, discovery ed evidenza](./verification-project-regressions-2026-10-20.md) hanno ricevute separate. Residui e dipendenze sono in [`PROJECT_STATUS.json`](../PROJECT_STATUS.json), in particolare `AGENT-REQUEST-LEDGER-LIVE-QUALIFICATION-01`, `LIVE-MODEL-HARDWARE-01` e `AGENT-UNGRACEFUL-SHUTDOWN-RECOVERY-01`.

Dettagli implementativi: [`agent-runtime.md`](./agent-runtime.md), [`agent-guards.md`](./agent-guards.md), [`agent-diagnostics.md`](./agent-diagnostics.md). Prove e fallimenti: [`verification-history-2026-10-13.md`](./verification-history-2026-10-13.md), [`request-ledger-human-review-2026-10-10.md`](./request-ledger-human-review-2026-10-10.md).
