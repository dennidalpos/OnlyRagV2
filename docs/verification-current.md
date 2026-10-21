# Verifica corrente per ambito

Stato aggiornato per il [cambio sessione del 21 ottobre](./session-handoff-documentation-2026-10-21.md). [PROJECT_STATUS.json](../PROJECT_STATUS.json) contiene **quattro attività autonome: tre P2 e una P3**. Ai due P2 originali (fork `braces` e rifiuto dev-server) si aggiungono il wrapper Sidecar non deterministico (P2) e l’etichetta OCR fissa (P3), emersi dal riesame documentale. Nessuna attività con decisione utente; criteri e condizioni di ripresa sono nel tracker.

La [politica locale approvata](./local-development-policy-2026-10-20.md) ritira campagne/qualifiche dei modelli, obblighi CI, distribuzione pubblica e nuove migrazioni legacy. I fallimenti conservati non diventano successi e non riaprono automaticamente quei task.

## Evidenze applicative più recenti

| Ambito | Ricevuta e perimetro |
| --- | --- |
| Runtime e dipendenze del 21 ottobre | [Audit critico](./critical-application-audit-2026-10-21.md): 3.002 test TypeScript/328 file, 687 Python e un symlink host saltato, 15 casi critici senza skip, build e scenari Electron deterministici. Sono risultati datati, non suite ripetute per questa revisione documentale. |
| IPC/UX e modelli scelti dall'utente | [UX mirata](./verification-ux-targeted-2026-10-21.md): tastiera, zoom, focus, errori/esportazioni, scelta esplicita nel wizard; servizi controllati. |
| Recupero chat, bozze e writer; rebuild e cancellazione traduzione | [Completamenti locali](./verification-tracker-completion-2026-10-21.md): interruzioni dei processi posseduti e readback, profili isolati; nessuna prova di perdita di alimentazione. |
| Ricerca e indici FTS | [API FTS](./verification-fts-api-2026-10-21.md): parità di risultati e dati, 17 regressioni, quattro carichi sintetici; nessuna nuova qualifica dell'encoder reale. |
| Recupero agente ed effetti ignoti | [Ripresa esplicita](./verification-agent-crash-recovery-2026-10-20.md) e [ispezione/abbandono](./verification-inflight-reconciliation-2026-10-20.md); nessun replay automatico. |
| Candidati installati precedenti | [Impostazioni](./verification-installed-settings-2026-10-20.md), [XLS](./verification-installed-xls-2026-10-20.md) e [footprint](./verification-candidate-footprint-2026-10-20.md): valgono per gli artefatti identificati, non per ogni build successiva. |
| Semantica dei modelli | [Contenuti](./verification-live-content-2026-10-20.md) e [ledger](./verification-ledger-bounded-2026-10-20.md): raccolte conservate con accettazione fallita; campagne ritirate. |

## Verifica documentale di questa sessione

Il [riesame della documentazione](./documentation-audit-2026-10-21.md) riporta i comandi eseguiti, la copertura dei documenti e le discrepanze residue. Non modifica codice applicativo, contratti generati, corpus o licenze. Nel `.venv` del checkout manca `pytest`: il riesame documentale non aveva rieseguito il gate completo. Per il successivo [commit di cambio sessione](./session-handoff-documentation-2026-10-21.md) sono passate nuove suite complete in una copia isolata con ambiente Python di verifica esterno: 3.002 TypeScript, 687 Python e uno skip host, 15 critici senza skip. Il `.venv` del checkout resta invariato; l’ambiente esterno non è un nuovo setup indipendente.

I dati/output ignorati preesistenti e le prove storiche protette restano conservati; le precedenti rimozioni rifiutate non vengono riprovate. Nessuna inferenza, installazione, migrazione personale o pubblicazione deriva dall'aggiornamento delle guide.

## Perimetro desktop — 2026-10-17

Il target e il solo desktop Windows, normalmente 1920×1080; tablet e smartphone sono esclusi. [Decisione e controlli originali](./verification-summary-history-2026-10-21.md#perimetro-desktop--2026-10-17). I viewport ridotti usati nei test di zoom sono prove desktop, non un nuovo target mobile.

## Cronologia

La precedente pagina accumulava conteggi, autorizzazioni e risultati di sessioni diverse. Il testo è conservato integralmente nei [riepiloghi storici](./verification-summary-history-2026-10-21.md); [history.md](./history.md) indicizza tutte le ricevute per ambito. Per requisiti di verifica e comandi operativi usare [AGENTS.md](../AGENTS.md#comandi-e-verifica) e [operations.md](./operations.md).
