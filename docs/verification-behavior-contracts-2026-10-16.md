# Correzioni dei contratti comportamentali — 2026-10-16

Implementazione autorizzata dei cinque rilievi dell'audit comportamentale. Le modifiche locali preesistenti sono state preservate; nessun commit, push, aggiornamento del tracker, migrazione personale o chiamata a modelli reali.

## Riproduzione e correzione

| Rilievo | Riproduzione sul codice precedente | Comportamento corretto e regressione |
| --- | --- | --- |
| F1, UTF-8 | Il client HTTP restituiva `citt��` per `città` dividendo la risposta fra i byte della lettera accentata. | `setEncoding('utf8')` decodifica incrementalmente. Il test attraversa ogni separazione in byte con accenti, CJK ed emoji, per JSON e NDJSON con e senza newline finale, controllando anche gli eventi di progresso. |
| F2, aggiornamento/eliminazione | Un aggiornamento fermato agli embedding ricreava documento e chunk dopo una cancellazione confermata; due aggiornamenti sovrapposti perdevano la revisione vincente. | Controllo atomico della revisione prima del journal e delle scritture; documento assente rifiutato, revisione diversa con HTTP 409. I test usano LanceDB reale e verificano righe, chunk e assenza di journal residuo. |
| F3, export | L'IPC rifiutava `md`; `html` e `htm` producevano invece Markdown con estensione `.md` dichiarando successo. | Insieme condiviso dei formati fra tipo e schema runtime; `htm` diventa `html`. Test sul validatore IPC reale e sull'instradamento al writer testuale o al convertitore, con controllo di estensione e byte consegnati. |
| F4, annullamento | Restava la copia integrale dell'originale anche con esito `cancelled`. Main interrompeva lo stream e il Renderer dichiarava la pulizia prima di conoscerne l'esito. | Pulizia limitata alla directory creata dal task, dopo rollback verificato; `error` su rifiuto della pulizia. Main attende il terminale e il Renderer mantiene il lock. Coperti copia parziale, estrazione, indicizzazione, cancellazione dopo commit, errore di rollback, errore di pulizia e collisione con archivio preesistente. |
| F5, lock della ricerca | Con encoder sospeso, lista documenti e health restavano bloccati oltre il timeout Main di tre secondi. | Preparazione e verifica dello snapshot sotto lock, generazione embedding fuori lock. Con encoder sospeso, le letture e health completano entro un secondo nel test. Aggiornamento, eliminazione, cambio di provenienza o recovery invalidano l'operazione; il conflitto HTTP è esplicito. |

Prima delle correzioni i nuovi test hanno prodotto cinque fallimenti JavaScript e dodici Python. Altri quattro test hanno riprodotto la mancata attesa della pulizia fra HTTP e Renderer. I test non usano modelli reali: gli encoder sono fixture dichiarati e le chiamate HTTP del client usano server locali su porte effimere.

Riferimento primario per la decodifica multibyte: [documentazione Node 24.20.0](https://raw.githubusercontent.com/nodejs/node/v24.20.0/doc/api/string_decoder.md), versione presente sulla postazione. La concorrenza applicativa è verificata contro FastAPI 0.141.1, Starlette 1.7.0 e LanceDB 0.37.1 installati, con Python 3.13.15.

## Verifica finale

| Comando o verifica | Esito |
| --- | --- |
| `npm run test:fast -- --silent=true` | 2.818 test passati in 317 file, 184,39 secondi. |
| `.venv\Scripts\python.exe -m pytest -q` | 536 passati, uno saltato, 126,28 secondi. |
| `npm run typecheck` | Superato. |
| `npm run quality:static` | Superato: 99 handler IPC verificati, 835 file controllati, nessuna correzione automatica applicata dal gate. |
| `npm run build` | Superato per Renderer, Main e Preload. Nessuna app installata o modello avviato. |
| `npm run docs:check` | Superato: 59 file Markdown. |
| `git diff --check` | Superato. |
| Rigenerazione OpenAPI tramite `scripts/generate_openapi.py` in radice dati temporanea isolata | Superata; il confronto con il contratto runtime passa nella suite Python. |

Sono stati aggiunti 17 casi JavaScript e 16 Python. I controlli mirati comprendono 72 test JavaScript e 43 Python passati; dopo la suite completa, gli otto test della cancellazione sono stati rieseguiti con assert più forti sull'integrità dei documenti e chunk precedenti, tutti passati. Le differenze preesistenti in AGENTS, tracker, documentazione datata, server Vite gestito e relativi test non sono state modificate.

## Limiti

Le prove qualificano la meccanica isolata, non l'app installata/riavviata, la qualità dei modelli, la semantica RAG, la perdita di alimentazione o le prestazioni su corpus ampi. Il test sui symlink di directory può essere saltato per mancanza del privilegio Windows. La costruzione FTS e le letture effettive dell'indice restano coordinate dal lock: è la generazione degli embedding a esserne esclusa.

Nessuna pulizia retroattiva degli originali conservati o delle campagne esistenti: il ciclo di vita generale degli archivi resta nel task `SOURCE-ARCHIVE-LIFECYCLE-01`. Il residuo temporaneo già segnalato nell'audit iniziale non è stato oggetto di una nuova richiesta di pulizia.
