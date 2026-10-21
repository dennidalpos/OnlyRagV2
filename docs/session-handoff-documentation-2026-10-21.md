# Passaggio di sessione: skill e documentazione — 21 ottobre 2026

Il proprietario richiede salvataggio del lavoro, aggiornamento del tracker, commit sul principale e push prima di cambiare sessione. Verificati repository pubblico `dennidalpos/OnlyRagV2`, remoto `origin`, default e branch corrente `master`, base `425ddcffe17c681232ebef76db614bc140519f33`, allineata 0/0 dopo fetch.

## Lavoro salvato

- Nove skill in [skills/](../skills/): percorsi/contratti attuali, comandi ed effetti, desktop Windows, metadati `triggers`/`tags` supportati dal parser; regole comuni rinviate ad AGENTS.
- [Indice delle guide](./README.md), [stato corrente](./verification-current.md) e [indice storico](./history.md) separati. La precedente verifica corrente è conservata integralmente nei [riepiloghi datati](./verification-summary-history-2026-10-21.md); riesami delle librerie e ancoraggi restano consultabili.
- [Riesame documentale](./documentation-audit-2026-10-21.md): correzioni dei comandi, task conclusi/ritirati, recupero/cancellazione, UI, modelli e distribuzione; revisione specifica AGENTS 2.7. Corpus, JSON, licenze, prove storiche, snapshot e blocco comune conservati; gli snapshot SecondBrain sono aggiornati tramite Sync.

Nessuna modifica ai sorgenti applicativi, contratti generati o dipendenze. Le frasi precedenti «nessun commit/push» descrivono le fasi di revisione prima di questa richiesta esplicita.

## Tracker e ripresa

[PROJECT_STATUS.json](../PROJECT_STATUS.json) conserva schema e tutte le note precedenti. Nessuna nuova chiusura; i due P2 originali mantengono esattamente record e criteri. Due nuove voci registrano le discrepanze statiche del riesame, senza dichiararle corrette o riprodotte live.

| Attività autonoma | Priorità | Condizione di ripresa |
| --- | --- | --- |
| `DEPENDENCY-BRACES-UPSTREAM-01` | P2 | Valutare una candidata upstream soltanto quando disponibile, con i gate parser/AST, installazione pulita e integrazione previsti dal tracker. Nessuna nuova lettura del registro in questa consegna. |
| `DEVSERVER-LOOPBACK-PROBE-STABILITY-01` | P2 | Attribuire il rifiuto storico con prove socket/listener/PID sufficienti; non indebolire le guardie sulla base di successi successivi. |
| `TEST-SIDECAR-DETERMINISTIC-WRAPPER-01` | P2 | Rendere deterministico il comando ordinario anche se risponde la porta 8000; suite Python e fallimenti devono essere verificabili senza usare un server personale. |
| `INGESTION-OCR-PROVIDER-LABEL-01` | P3 | Sostituire l'affermazione iniziale fissa CUDA con informazioni del provider effettivo o stato sconosciuto/in preparazione; fixture CPU/CUDA e Vision/fallback. |

Totale: **quattro task autonomi, zero con decisione utente**. Non riattivati obblighi CI, campagne/qualifiche modello, consegna pubblica di installer o nuove migrazioni legacy. Le relative ricevute restano storiche.

## Gate della consegna

Gate pre-commit eseguiti e passati nella nuova copia isolata: **3.002 test TypeScript in 328 file, 687 Python e un solo skip per symlink di directory non disponibile sull’host; 15 casi Python critici senza skip**. Typecheck, statico (888 file/107 IPC), documentazione (120 Markdown) e whitespace passano. I 1.229 file iniziali corrispondono per SHA-256 tra checkout e copia testata; 2.377 file protetti e il loro insieme sono invariati. Le sole modifiche successive ai test aggiornano esiti documentali e nota del tracker. Ricevute `typescript.json`, `python.xml`, `critical.log` e `suite-receipt.json`.

Il `.venv` del checkout non contiene pytest. Per non cambiarlo si usa, tramite junction nella copia isolata, il precedente ambiente di verifica Python 3.13.15 con pytest 9.1.1, FastAPI 0.141.1, LanceDB 0.37.1 e Pillow 13.0.0, riletto all'avvio. Anche `node_modules` è condiviso tramite junction con il checkout: non è una nuova installazione indipendente. Test deterministici e profili isolati; nessun endpoint modello reale.

Evidenze di pubblicazione: `C:/Users/Utente/OnlyRag-Live/skill-doc-publication-20261021`, con copia iniziale dei sorgenti, backup del lavoro, bundle Git verificato, manifest SHA-256, hash dei dati protetti e log dei gate. SHA finale e readback remoto sono registrati fuori dal commit stesso per evitare riferimenti circolari.

## Conservazione e limiti

I due rilievi del prodotto restano da implementare. Il limite pytest del checkout non è risolto usando un ambiente esterno. Risultati di test, build o audit precedenti mantengono data e perimetro; nessuna nuova qualifica installata o semantica. Cache/output ignorati preesistenti e tutti i residui di cleanup rifiutato rimangono conservati. Nessuna cancellazione alternativa, migrazione personale, inferenza, installazione app o pubblicazione Git di SecondBrain.
