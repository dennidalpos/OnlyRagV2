# Electron Main

[`electron/main.ts`](../electron/main.ts) crea una finestra con `nodeIntegration: false`, `contextIsolation: true` e `sandbox: true`. [`secureIpcMain.ts`](../electron/core/presentation/secureIpcMain.ts) valida frame e payload; Application coordina Domain e adapter Infrastructure. Il Sidecar è gestito da [`sidecarProcessManager.ts`](../electron/core/infrastructure/process/sidecarProcessManager.ts).

## Avvio

Main carica le impostazioni, registra IPC e avvia il Sidecar locale. Il listener `:8000` viene riconosciuto tramite processo avviato/discendente o marker con PID, percorso e ora di avvio; un listener sconosciuto non viene terminato. Il bundle comprende worker separati per scanner dipendenze e typecheck incrementale. [`operations.md`](./operations.md) distingue sviluppo, smoke e packaging.

## Stato e scritture

Impostazioni, registro progetti, sessioni e stato agente usano scritture serializzate con staging nello stesso percorso, flush del file e rename. Un file illeggibile o una scrittura non confermata blocca le operazioni dipendenti; gli originali e lo staging restano disponibili. Flush della directory e perdita di alimentazione non sono qualificati (`STATE-WRITER-CRASH-DURABILITY-01`).

## Session deletion recovery — 2026-10-12

Eliminazione e Clear hanno stati `refused`, `pending` e `complete`. Main conserva il journal delle operazioni incomplete, la cronologia e i checkpoint; il Renderer offre retry, ripristino o export secondo il contratto IPC. Una fase `.preparing-<operationId>` rimasta dopo crash o rifiuto non viene promossa né rimossa automaticamente: richiede verifica di proprietà e completezza (`SESSION-DELETION-STAGING-RESOLUTION-01`).

### Sidecar indexing fence extension — implemented 2026-10-11

La rimozione della cronologia prompt registra prima un fence versionato; l'indicizzazione ricontrolla la generazione prima del commit. Il ripristino esplicito richiede lo stesso `operation_id` e Main reindicizza le righe conservate.

### Candidate-store ownership — 2026-10-12

Main legge store workspace e fallback prima di eliminare, conserva l'unione dei checkpoint e rifiuta identità di sessione con proprietari incoerenti. Copie o checkpoint illeggibili non diventano autorizzazione alla cancellazione.

## Session deletion recovery proposal — 2026-10-06

La proposta storica precede il journal attuale; stato e limiti correnti sono sopra e nel [`tracker`](../PROJECT_STATUS.json).

Verifica datata e tagli isolati: [`verification-history-2026-10-13.md`](./verification-history-2026-10-13.md).
