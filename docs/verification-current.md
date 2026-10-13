# Verifica corrente per ambito

Fotografia del **13 ottobre 2026**. Il [`tracker`](../PROJECT_STATUS.json) è la fonte dello stato aperto; questo riepilogo distingue la verifica meccanica dalla qualità dei risultati e dall'app installata. Le ricevute, i fallimenti e gli hash restano in [`verification-history-2026-10-13.md`](./verification-history-2026-10-13.md).

| Ambito | Verificato | Ancora aperto |
| --- | --- | --- |
| Build e sorgenti | Ultimo candidato CPU locale: installer e archivio sorgente con hash, 998 record sorgente, 3.598 file installati e corrispondenza dei sei moduli Sidecar congelati; probe CPU OCR/auth/PDF/ricerca fallback passati. | Installazione e riavvio sul profilo reale, firma, diritti di tutti i componenti, pubblicazione e consegna del sorgente corrispondente. |
| Test deterministici | Ultimo passaggio completo: 2.683 test JavaScript, 516 Python, 14 PowerShell; typecheck e qualità statica passati. | CI remota e condizioni non rappresentate dai fixture; non ripetere suite complete per una modifica solo documentale. |
| Ingestion e ricerca | Parser e rifiuti isolati, OCR CPU congelato, provenienza vettoriale, filtri, FTS e proiezione dei metadati verificati nei casi dichiarati. | Memoria XLS avversaria, ricerca/FTS/I/O su corpus più ampi, qualità multilingue e copertura completa dei documenti. |
| Traduzione | Corpus congelato di quattro documenti: 4/4 contenuto e lingua nella configurazione dichiarata. Un modulo italiano: 8/8 lingue con modello 4B e glossario limitato. Replay del candidato congelato senza nuove chiamate modello. | Altri documenti e configurazioni, layout visivo DOCX, consegna e prova dell'app installata/riavviata. |
| Agente | Guard, isolamento, recupero e verifiche native su fixture; quattro richieste umanamente confermate conservate con esiti e rifiuti. | Estrazione/planning live e TaskLab completi: 0 sequenze/stadi qualificati. Nuove campagne modello restano sospese. |
| Persistenza | Writer con flush del file, rename e 16 tagli isolati; originali preservati. | Flussi completi di chiusura per impostazioni/storico/checkpoint, metadata directory e perdita di alimentazione. |

## Comandi

Da PowerShell nella radice del repository: `npm run docs:check` per link e comandi; `npm run typecheck` e test mirati solo dopo modifiche comportamentali; `npm run test:fast -- --silent=true` e `.venv\Scripts\python.exe -m pytest -q` per le suite complete quando un problema lo richiede. L'elenco degli script e degli effetti è in [`operations.md`](./operations.md) e [`package.json`](../package.json). Un test passato non certifica modelli reali, semantica, interazione visiva o perdita di alimentazione.

## Prossimo lavoro offline

In ordine: sonde isolate di chiusura/riavvio per stato e checkpoint; misure complete di ricerca/FTS/archivi; proposta di ammissione XLS prima del parsing; proposta di verifica per i tool non Node. Nessuna di queste voci autorizza migrazioni personali, pulizia dei dati, installazione, pubblicazione o nuove chiamate ai modelli.

## Passaggio di sessione sulla documentazione · 2026-10-13

La documentazione tecnica è stata confrontata con i punti di ingresso e i contratti del codice, suddivisa per ambito e indicizzata in [`README.md`](./README.md). I resoconti estesi precedenti restano negli archivi datati; i duplicati `agent.md` e `decisions.md` sono stati rimossi. Corretti anche i riferimenti non aggiornati nelle skill locali.

Verifica di questa modifica: `npm run docs:check` (48 file), sei test mirati del validatore, Biome sui due file del validatore e `git diff --check`, tutti superati. Suite applicative complete non ripetute perché la modifica non cambia il comportamento dell'app. Le attività aperte restano nel [`tracker`](../PROJECT_STATUS.json); nessuna campagna modello, installazione o migrazione personale è stata avviata.
