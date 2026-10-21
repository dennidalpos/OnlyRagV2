# Passaggio di sessione: audit critico — 21 ottobre 2026

Il proprietario richiede esplicitamente salvataggio del lavoro, commit sul branch principale e push per cambiare sessione. Verificati repository pubblico `dennidalpos/OnlyRagV2`, remoto `origin`, branch predefinito e corrente `master`, base `c0e9e58d1c27a0b9298e5aa90d7362bc0ea46219`, allineata 0/0 dopo fetch.

## Lavoro della consegna

L'[audit critico](./critical-application-audit-2026-10-21.md) contiene riscontri, fonti ufficiali, regressioni negative e limiti. Corrette gestione fetch/redirect/risposte interrotte, annullamento e limiti in byte/deadline; firma MIME divisa tra chunk nel download; decodifica UTF-8 dello stream Ollama. Informazioni ricava le versioni dai file di build, distinguendo i servizi esterni. Electron 43.8.3 e Pillow 13.0.0 sono installati e fissati nei manifest/vincoli. L'[inventario](./evidence/critical-audit-dependencies-2026-10-21.json) distingue versioni effettive e candidate.

Il rapporto precedente descrive la fase locale senza commit/push; questa richiesta autorizza ora la pubblicazione dei sorgenti. Non include un nuovo installer distribuito, aggiornamenti del profilo personale, campagne modello o commit/push del repository SecondBrain.

## Ripresa e tracker

[PROJECT_STATUS.json](../PROJECT_STATUS.json) conserva schema, note storiche e due record autonomi P2 originali con criteri invariati; zero task da assegnare al proprietario e nessuna chiusura ulteriore da questo salvataggio.

| Task | Condizione di ripresa |
| --- | --- |
| `DEPENDENCY-BRACES-UPSTREAM-01` | Upstream era ancora 3.0.3 all'audit. Conservare il fork 3.0.4+onlyrag.1; valutare una release successiva soltanto con i gate parser/AST, npm pulito, YAML/proxy, Electron/ASAR e provenienza/licenza del tracker. |
| `DEVSERVER-LOOPBACK-PROBE-STABILITY-01` | Rifiuto storico ancora senza causa attribuibile. Conservare guardie loopback/proprietario; riprendere con riproduzione e ricevute socket/listener/PID sufficienti. I successi successivi non dimostrano la risoluzione. |

Gli upgrade ulteriori sono proposte separate nel rapporto. CI, qualifiche/campagne modello, consegna pubblica di installer e nuove migrazioni legacy restano ritirati dalla fase corrente. I candidati precedenti mantengono versioni e limiti propri; non sono dichiarati corretti da uno scan locale.

## Verifica prima della pubblicazione

Prima del salvataggio, 1.224 file corrispondono alla copia di verifica salvo soli aggiornamenti documentali/tracker successivi: runtime e test sono identici per SHA-256. Le suite complete sono state ripetute e passano nella medesima copia isolata prima del commit: **3.002 TypeScript/328 file, 687 Python e un solo skip per symlink directory dell'host, 15 casi critici senza skip**. Tipi, statico (888 file/107 handler IPC), documentazione (116 pagine) e controllo diff passano. Le dipendenze npm della copia sono indipendenti; Pillow 13.0.0 è posseduta dalla fixture Python, le altre dipendenze dev sono condivise tramite junction già documentate. Gli ambienti e i risultati dell'audit precedente restano separati.

Le prove dell'implementazione comprendono build, tipi, statico, Knip/cicli, UX Electron, agente/guardie, sanitizer Monaco e Informazioni; CPU Sidecar congelato con Pillow 13.0.0 e PNG/TIFF/OCR nativi, embedding controllati; carico RAG 100k/768D con contesa e readback completo. Non si eseguono nuove inferenze. Il dettaglio dei limiti resta nel rapporto.

Evidenze dell'audit: `C:/Users/Utente/OnlyRag-Live/critical-audit-20261021`. Ricevute di pubblicazione: `C:/Users/Utente/OnlyRag-Live/critical-audit-publication-20261021`, con backup Git completo verificato, copia SHA-256 del lavoro iniziale e risultati pre-commit. SHA finale e readback remoto vengono registrati nella ricevuta esterna e nel contesto SecondBrain dopo push, senza riferimento circolare nel commit stesso.

## Conservazione e limiti

Nel seguito locale precedente sono stati riletti 2.377 file/configurazioni personali: insieme e SHA-256 invariati. La consegna ripete il confronto e conserva i profili sintetici fuori checkout. Gli audit npm/PyPI/OSV non riportavano advisory noti nei rispettivi ambienti; non attestano assenza di vulnerabilità. I 36 alert remoti Pillow osservati prima del push appartengono al loro stato remoto: non vengono dichiarati chiusi automaticamente dalla consegna.

Residuo operativo P3 conservato: `C:/Users/Utente/OnlyRag-Live/critical-audit-20261021/pyinstaller-work`. La revisione automatica ha rifiutato prima dell'esecuzione la pulizia combinata PowerShell con `blocked by policy`, senza dettagli ulteriori. Nessun tentativo alternativo; ricevuta `cleanup-rejection.json`. Restano protetti anche i residui precedenti e lo storico; nessun task di smaltimento ritirato viene riattivato.
