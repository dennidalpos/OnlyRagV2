# API FTS e seguito del tracker — 21 ottobre 2026

Ripresa dei tre task rimasti dopo il [lotto precedente](./verification-tracker-completion-2026-10-21.md). Il lavoro locale precedente, ancora non committato, è preservato e censito con hash prima di questo seguito. Nessun commit, push, modello reale, installazione o modifica a store personali.

## RAG-FTS-INDEX-API-01

Sostituita la chiamata deprecata `create_fts_index` con `create_index(column, config=FTS(...), name=..., replace=False)` in `search_service.py`. La dipendenza resta **LanceDB 0.37.1**. Il [riferimento primario dell'API](https://lancedb.github.io/lancedb/python/python/#lancedb.table.Table.create_index) è confrontato con firme e sorgenti della versione effettivamente installata: la nuova API usa `replace=True` per default, mentre la vecchia usava `False`. La scelta esplicita conserva il rifiuto delle collisioni senza sostituzioni implicite.

Conservati tokenizer semplice, minuscole, stemming disabilitato, stop word conservate, nessun limite alla lunghezza del token, nessun ASCII folding, posizioni disabilitate e nomi/colonne degli indici. Il vecchio wrapper applicava anche un rifiuto degli artefatti Tantivy locali, assente nella nuova API: il controllo resta esplicito sul percorso della tabella locale esposto dalla proprietà pubblica `uri`. Nessuna conversione o cancellazione di indici incompatibili. Gli indici nativi esistenti vengono riusati; il runner delle prestazioni misura ora `create_index`.

### Regressioni native

`python -m pytest sidecar/tests/test_lexical_retrieval.py -q`: **17 passati**, incluse sei nuove casistiche. Ricerca di identificatori multilingue, termini non stemmati, stop word e token oltre 40 caratteri; niente warning deprecato nel percorso nuovo. Riutilizzo degli indici creati con l'API precedente, compatibilità di nomi/colonne, rifiuto di indice scalare, colonna sbagliata, archivio Tantivy conservato e collisione con inventario superato. L'ultimo caso dimostra che `replace=False` evita la sostituzione di un indice appena creato. I file della tabella e degli indici restano byte-identici nei casi di rifiuto/riuso.

I primi due fallimenti della fixture confrontavano `IndexConfig.created_at`: nel readback osservato il timestamp perdeva la frazione submillisecondo, mentre i file restavano invariati. Il confronto di immutabilità ora usa tutti i byte conservati, senza scartare dati della tabella. Diagnostici originali conservati, nessun difetto applicativo aggiunto per quella rappresentazione.

### Parità e contesa

Eseguito `retrievalEfficiency.py --label after --chunks <10000|100000> --dimension <768|1024> --samples 20 --varied --contention --p95-limit-ms 5000`, in quattro nuove root sintetiche. Venti scritture native e quattro lettori per combinazione, con conflitti di revisione dichiarati separatamente dai successi.

| Chunk | Dimensioni | p95 terminali in contesa ms | Conflitti / 80 | p95 writer ms |
| --- | --- | --- | --- | --- |
| 10.000 | 768 | 475 | 30 | 209 |
| 10.000 | 1024 | 471 | 34 | 254 |
| 100.000 | 768 | 2100 | 26 | 1721 |
| 100.000 | 1024 | 2701 | 29 | 1638 |

Tutti i limiti di 5000 ms passano. I sedici hash dei risultati completi ordinati, comprese provenienza e coda non indicizzata, coincidono con le ricevute dell'API precedente. Anche righe canoniche iniziali e archivi coincidono con la baseline. In ogni root le query non mutano righe/archivi, e il ripristino dopo contesa restituisce tutti i byte/campi attesi. Le prove usano vettori sintetici e trasporto dei modelli vietato; non qualificano un encoder o la qualità semantica. Ricevuta `fts-parity.json`.

### Gate e stato

**Completato e rimosso dal tracker** dopo 680 test Python passati, un solo skip per symlink di directory non disponibile sull'host e gate critico 15/15 senza skip. Passano anche le nove regressioni native delle guardie dev-server, statico e documentazione. Nessuna guardia dev-server modificata; questi nove successi non attribuiscono la causa storica. Nessuna nuova migrazione di dati o release installer.

## Due attività ancora aperte

- `DEPENDENCY-BRACES-UPSTREAM-01`: nuova lettura del registro primario con `npm view braces version dist.integrity --json`, ancora **3.0.3**. Il fork **3.0.4+onlyrag.1** resta necessario. Non esiste una candidata pubblicata da sottoporre ai gate originali; ID, priorità e criteri restano invariati.
- `DEVSERVER-LOOPBACK-PROBE-STABILITY-01`: riesaminati i resoconti del 15/16 ottobre e la successiva [indagine loopback](./verification-loopback-probes-2026-10-20.md). Il primo fallimento non registra gli endpoint TCP della sonda. Self-connect e readiness ridondante sono difetti riprodotti e già corretti, ma i loro riproduttori non attribuiscono retroattivamente quella tupla mancante. Le guardie restano invariate e il task conserva la richiesta di una causa attribuibile.

Nessun nuovo residuo applicativo osservato nelle prove FTS concluse. Le prove storiche e i residui protetti del lotto precedente restano conservati; nessun task ritirato viene riattivato.

## Evidenze e limiti

Root `C:/Users/Utente/OnlyRag-Live/tracker-next-20261021-50b2e907`: copia sorgenti iniziale verificata SHA-256, patch del lavoro precedente, tracker iniziale, ricevute FTS/JUnit, benchmark, lettura registro e audit delle prove dev-server. Node/npm e venv Python sono quelli già presenti; la copia usa junction dichiarate, senza installare o cambiare dipendenze. Dati/config personali censiti prima delle prove, con confronto finale separato. Le nuove root di benchmark e i diagnostici sono evidenze intenzionalmente conservate fuori dal checkout.

Stato finale: due task P2 ancora aperti, nessuna nuova voce applicativa. I 147 file/config protetti e il loro insieme sono ricontrollati nella ricevuta finale. Sorgenti Node/Renderer, manifest e lock sono invariati rispetto al lotto precedente: nessuna nuova suite frontend completa o build dichiarata in questo seguito Python.

Residuo operativo P3 nelle note del tracker: `C:/Users/Utente/OnlyRag-Live/tracker-next-20261021-50b2e907/source/.pytest_cache`, esistenza verificata dopo il rifiuto. La revisione automatica ha respinto prima dell'esecuzione il comando combinato che includeva la rimozione di questa cache (`blocked by policy`, nessun altro motivo). Nessuna fase del comando rifiutato è stata eseguita e nessun metodo alternativo di cancellazione è stato tentato. Cache e puntatore testuale `C:/Users/Utente/OnlyRag-Live/tracker-next-current.txt` restano conservati con le evidenze; questo non riattiva il task di smaltimento storico ritirato. Ricevuta `cleanup-rejection.json`.
