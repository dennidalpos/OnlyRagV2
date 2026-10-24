# Passaggio di sessione: pulizia e isolamento dei log — 24 ottobre 2026

Richiesti esplicitamente salvataggio del lavoro, aggiornamento tracker, commit sul branch principale e push. Destinazione verificata: repository pubblico [dennidalpos/OnlyRagV2](https://github.com/dennidalpos/OnlyRagV2), remoto origin, default e branch corrente master; base 9b5508d28305d3cdc5dbe02729767345fdaf2395 allineata 0/0 dopo fetch.

## Lavoro consegnato

- Eliminati quattro metodi senza chiamanti applicativi e il test esclusivo di una guardia inattiva; test delle API supportate riallineati.
- Logger operativo e audit unificati su userDataRoot. Eliminato il fallback di clearLogs che svuotava anche il log della directory corrente. Due regressioni falliscono sul logger precedente e passano sul fix.
- Rimossi quattro output/cache del checkout, 68 file e 20.532.566 byte, dopo backup SHA-256 e preflight della policy.
- Guide operative, verifica corrente, [rapporto completo](./repository-cleanup-2026-10-24.md), tracker e dossier SecondBrain aggiornati.

## Incidente e conservazione

La prima suite della fase di pulizia ha troncato logs/app.log tramite il vecchio fallback. Erano stati salvati hash e lunghezza, ma non i byte. I 35.873 byte originali non sono recuperati; il proprietario dichiara di non avere un backup. Non considerare il commit o il cambio sessione come accettazione della perdita. La causa è corretta; il recupero rimane aperto.

Il log audit è stato ripristinato byte per byte (107.646 byte) e i 66 file di userdata_dev sono invariati rispetto all'inizio della pulizia. Prima della pubblicazione sono stati copiati e verificati tutti i 68 file attuali di userdata_dev e logs. Asset, font/licenze, corpus, ricevute storiche, dipendenze, riferimenti interni Git e oggetti dangling restano conservati.

La revisione automatica ha rifiutato prima dell'esecuzione la rimozione della copia sorgenti isolata, del runtime Python temporaneo e della directory Vite vuota: motivo restituito soltanto blocked by policy. Nessuna rimozione alternativa o nuova richiesta di pulizia di quei target. Sono mantenuti la copia sorgenti con junction node_modules, il runtime e le fixture sintetiche; inventario nel rapporto.

## Tracker e ripresa

Schema e tutti i cinque record aperti sono conservati: quattro autonomi (tre P2 e una P3), uno con disposizione del proprietario (P2).

| ID | Priorità | Ripresa |
| --- | --- | --- |
| DEPENDENCY-BRACES-UPSTREAM-01 | P2 | Fork locale attivo; valutare una candidata upstream compatibile soltanto quando disponibile e verificarla. |
| DEVSERVER-LOOPBACK-PROBE-STABILITY-01 | P2 | Riprodurre e attribuire il rifiuto storico prima di modificare le guardie loopback/PID. |
| TEST-PNPM-OFFLINE-PREPARATION-01 | P2 | Provare il ramo pnpm con cache vuota isolata e rete vietata. Un passaggio ordinario non soddisfa da solo il criterio. |
| OCR-RUNTIME-EFFECTIVE-PROVIDER-01 | P3 | Distinguere provider RapidOCR effettivo da disponibile, incluso fallback CPU. |
| DIAGNOSTICS-LOG-HISTORY-RECOVERY-01 | P2 | Recupero esatto del log originale o disposizione esplicita del proprietario; nessun backup disponibile. |

Usare [PROJECT_STATUS.json](../PROJECT_STATUS.json) per i criteri completi. Non riaprire campagne dei modelli, CI, distribuzione o nuove migrazioni legacy ritirate dalla politica locale.

## Verifiche

- Suite TypeScript completa: **3.039 test / 330 file passati**, 211,12 secondi.
- Suite Python completa: **687 passati e uno skip** per symlink directory non disponibile, 204,58 secondi.
- Gate Python critico: **15 casi / otto controlli passati, nessuno skip**.
- Tipi, quality:static (891 file, 107 handler IPC), docs:check (125 Markdown), format:check e verifica JSON/tracker passati.
- Tutti i 68 file attuali di dati/log risultano invariati rispetto al backup pre-pubblicazione. Nessuna perdita ulteriore del log residuo.
- Build, smoke Electron isolato, Knip, cicli e policy cleanup erano già passati sulla stessa revisione dei sorgenti nella fase di pulizia; nessuna modifica runtime successiva. Non ripetuti per la sola registrazione della consegna.

La suite TypeScript usa la copia isolata già conservata, aggiornata e verificata byte per byte; node_modules è condiviso tramite junction dichiarata. Python usa l'interprete del checkout e il solo pytest 9.1.1 esterno tramite PYTHONPATH; il .venv del checkout resta invariato. Non usare il venv temporaneo come equivalente del checkout per qualificare worker XLS e DLL CUDA.

## Backup e pubblicazione

- Fase di pulizia: %TEMP%/onlyrag-cleanup-20261024 (bundle, copie output/cache, manifest, ricevute e fallimenti conservati).
- Pubblicazione: %TEMP%/onlyrag-cleanup-publication-20261024 (bundle completo verificato, copie delle modifiche, dati/log attuali verificati, patch, manifest e ricevute precommit/pubblicazione).
- SHA del commit e readback del push vengono registrati nel dossier e nella ricevuta esterna dopo la pubblicazione; questo documento appartiene al commit stesso.

Le precedenti dichiarazioni senza commit/push nel rapporto descrivono la fase di pulizia. Nessun commit/push del repository SecondBrain, modello reale, installazione, migrazione personale o pubblicazione di installer.
