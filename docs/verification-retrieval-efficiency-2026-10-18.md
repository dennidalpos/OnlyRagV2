# Ricerca, FTS e I/O degli archivi — 18 ottobre 2026

Lotto autorizzato con «procedi» sul piano `RAG-INDEX-METADATA-EFFICIENCY-01`: misure offline in radici isolate, intervento sul costo dimostrato e aggiornamento del task esistente. I lotti locali CI e XLS preesistenti sono conservati. Nessun commit o push autorizzato in questo lotto.

## Evidenza precedente e problema attuale

Le tre ricevute JSON della campagna metadati del 13 ottobre corrispondono ancora ai propri SHA-256. `chunk_storage.py` coincide con il sorgente misurato; `db.py`, ricerca e test hanno invece modifiche successive. Si riusano ricevute, invarianti e disegno del fixture, senza modificare il vecchio store o attribuire le sue latenze alla ricerca attuale. La proiezione Arrow già completata non viene reimplementata.

La nuova misura mostra cinque letture di `extraction.json`, cinque query del documento canonico e dieci hash di testo per una ricerca con cinque risultati dello stesso documento. Nel fixture da 100.000 chunk sono 11.871.960 byte logici di archivio per richiesta. La regressione `test_search_reads_each_document_once_and_revalidates_on_next_request` fallisce prima della correzione: cinque letture osservate contro una attesa.

## Modifica

`chunk_source_provenance_batch` raggruppa per documento soltanto i risultati della richiesta corrente, legge e valida una volta archivio e documento canonico e calcola una volta la revisione canonica. Conserva ordine, identità, sezioni e distinzione tra span originali e derivati. Elabora un documento alla volta, senza trattenere tutti gli archivi del batch. La funzione singola usata dalla navigazione delega allo stesso percorso.

La ricerca continua a ricontrollare versioni e provenienza completa degli encoder sotto il lock esistente. Non cambiano ranking, filtri, indici, contratti REST/IPC, schema persistente o politica di manutenzione. Nessuna cache attraversa le richieste: revisione aggiornata, archivio prima assente e archivio alterato vengono riletti. I guard di recovery, contenimento path/junction e hash dell'originale restano attivi; non si pretende di proteggere da tutte le sostituzioni concorrenti del filesystem.

## Metodo ripetibile

Il comando `.venv\Scripts\python.exe -B scripts/e2e/retrievalEfficiency.py --label after --chunks 100000 --samples 20` crea **sempre** un nuovo scratch `onlyrag-retrieval-after-*`, dichiara `ONLYRAG_DATA_DIR` prima degli import e conserva store, originali, archivi e `report.json`. `--chunks 10000` esercita il corpus minore. `--label` etichetta il sorgente correntemente eseguito: non ripristina una versione precedente. I report baseline sono stati prodotti prima della modifica applicativa; il backup ne conserva i sorgenti.

- 100 documenti, 10.000 o 100.000 chunk, un solo spazio dichiarato con vettori float32 di dimensione 128. Cinque prove lessicali esatte sono deliberatamente fuori dai primi candidati densi; il filtro seleziona 100 o 1.000 chunk del documento `doc_000`.
- Archivi reali creati tramite retention/extraction di produzione. Il documento dei risultati contiene circa 2,3 MB di testo e riempimento dichiarato. Questo caso rende misurabile la rilettura, senza rappresentare una distribuzione documentale generale.
- La prima ricerca crea i tre indici FTS; seguono 20 ricerche complete, 20 filtrate e 20 dopo append di una coda del 10%, senza optimize. Un codice presente solo nella coda deve essere recuperato. Una navigazione controlla lo span e l'hash dell'originale.
- L'encoder restituisce vettori dichiarati; `httpx` rifiuta qualunque invio. Nessuna chiamata Ollama, servizio esterno o modello reale. Il fixture non misura la latenza di un encoder.
- Si confrontano SHA-256 di righe Arrow, tutti gli originali/archivi e risultati ordinati completi di punteggi e provenienza. Baseline e finale coincidono nei due corpus. Le ricerche non cambiano i record; la creazione FTS modifica invece legittimamente gli indici/versioni. Anche dopo l'append, le ricerche preservano tutte le righe e i file.
- p95 nearest-rank, diciannovesimo campione ordinato su venti. La prima ricerca è una sola osservazione, non un p95 statistico; non viene svuotata la cache del sistema operativo. Il tempo include la strumentazione; non si impongono soglie CI sensibili all'hardware.

Host: Windows, Intel Core i7-10700, 8 core/16 thread, 34.242.015.232 byte di RAM fisica. Runtime: Python 3.13.15, LanceDB 0.37.1, Arrow 25.0.1; versione Pydantic, piattaforma completa, hash dei sorgenti e campioni sono nei [dati della misura](./verification-retrieval-efficiency-2026-10-18.json). Le prove non sono eseguite in un ambiente hardware esclusivo.

## Risultati sui sorgenti finali

Millisecondi, mediana / p95; venti campioni per riga.

| Chunk e ricerca | Prima | Dopo |
| --- | --- | --- |
| 10.000, completa | 168,26 / 184,73 | 60,05 / 61,01 |
| 10.000, filtro documento | 182,14 / 208,59 | 56,67 / 60,22 |
| 10.000 + 1.000, coda non indicizzata | 169,07 / 176,02 | 63,64 / 65,79 |
| 100.000, completa | 310,47 / 340,58 | 166,11 / 174,05 |
| 100.000, filtro documento | 228,23 / 263,13 | 93,52 / 95,79 |
| 100.000 + 10.000, coda non indicizzata | 329,83 / 418,66 | 174,69 / 196,22 |

Le letture dell'archivio passano da cinque a una per richiesta, **80% in meno**; anche query canonica e hash ripetuti sono ridotti nello stesso rapporto. Sul corpus maggiore: 11.871.960 → 2.374.392 byte logici di archivio per ricerca. Il p95 di ciascuna sezione esterna del lock nelle ricerche complete passa da 286,06 a 132,88 ms. Si misura occupazione del lock senza un carico concorrente, non la latenza dei lettori in contesa.

La prima ricerca da 100.000 chunk passa da 712,05 a 597,49 ms, con costruzione FTS complessiva 407,05 → 420,93 ms; non si rivendica un miglioramento della costruzione degli indici. Le tre strutture occupano circa 5,8 MB; ciascuna riporta 100.000 righe indicizzate e 10.000 non indicizzate dopo append, correttamente ricercabili. Nel corpus minore la prima ricerca passa da 246,02 a 138,90 ms, costruzione FTS 71,99 → 73,19 ms e indici circa 0,56 MB.

I contatori nativi di lettura del processo per venti ricerche complete da 100.000 chunk passano da 1.262.556.726 a 1.072.422.726 byte. Questi contatori e i byte logici intercettati su `Path.read_text` non misurano i byte fisici letti dal disco: scansione vettoriale e metadati rimangono. I picchi working set dell'intera campagna, inclusi import, costruzione fixture e hash integrali, sono 666.800.128 → 671.096.832 byte; non dimostrano un risparmio di memoria della ricerca. Una navigazione finale richiede 47,09 ms nel corpus maggiore: singolo campione, nessuna qualifica prestazionale generale.

## Verifiche e recupero

| Comando o prova | Esito |
| --- | --- |
| Pytest mirato, `test_source_provenance.py -k search_reads_each_document` sul codice precedente | Fallimento atteso: cinque letture contro una. |
| `.venv\Scripts\python.exe -B -m pytest -q -rs --tb=short -p no:cacheprovider sidecar/tests/test_source_provenance.py sidecar/tests/test_lexical_retrieval.py sidecar/tests/test_embedding_space_storage.py sidecar/tests/test_document_recovery.py` | 53 passati e un symlink saltato dopo la prima regressione. La successiva prova intercalata è inclusa nella suite completa finale. |
| `.venv\Scripts\python.exe -B -m pytest -q -rs --tb=short -p no:cacheprovider` | **583 passati, un symlink saltato**, 153,89 s. Junction reale eseguita. |
| Benchmark prima/dopo, 10.000 e 100.000 chunk, 20 campioni per scenario | Quattro report completi; identità di fixture/risultati, revisioni/spans, dati preservati e coda trovata verificati. Due ulteriori esecuzioni dopo la correzione confermano la riduzione delle letture; i report finali corrispondono esattamente ai sorgenti. |
| AST Python su Sidecar e benchmark | 65 sorgenti passati, senza bytecode. |
| `npm run quality:static` | Passato: 851 file supportati e 103 handler IPC; non è un lint completo Python. |
| `npm run docs:check`, `git diff --check`, confronto tracker con il backup | Passati: 67 pagine Markdown, 43 ID univoci conservati e sola voce RAG aggiornata; note e tutte le altre voci invariate. |

La regressione finale verifica anche readback delle citazioni, aggiornamento del testo canonico tra richieste, rifiuto dell'archivio alterato, identità/ordine di documenti intercalati e archivio assente che ricompare. Suite TypeScript completa, build ed Electron non ripetuti: nessuna modifica frontend o ai contratti. La CI remota resta distinta.

Backup dei file interessati precedente al lotto in `%TEMP%/onlyrag-retrieval-cff489b89a684abb9ba5ae46f3a847e1`, con manifest e SHA-256 verificati. I [dati della misura](./verification-retrieval-efficiency-2026-10-18.json) legano tramite SHA-256 i quattro report grezzi conservati negli scratch, le versioni e i sorgenti. Le prime due esecuzioni diagnostiche sono conservate in `onlyrag-retrieval-baseline-u759p7t4` e `onlyrag-retrieval-baseline-onb3ht6q`: la raccolta terminava su `IndexStatistics` non serializzabile, corretto prima dei quattro report accettati. Nessuna evidenza fallita eliminata.

## Stato residuo e fonti

`RAG-INDEX-METADATA-EFFICIENCY-01` resta **aperto**: conclusa la misura su questi fixture sorgente e la rimozione delle riletture, non la qualifica generale. Restano distribuzioni/dimensioni vettoriali rappresentative e più spazi, corpus maggiori, contesa letture/scritture, encoder reali e desktop installato isolato. Nuovi indici/cache non sono giustificati automaticamente da queste misure. Installazione e chiamate a modelli richiedono autorizzazione separata. Nessuna migrazione personale, pulizia di dati, modifica dei corpus congelati, commit o push.

Fonti primarie consultate: [FTS e righe non indicizzate LanceDB](https://docs.lancedb.com/search/full-text-search#keeping-the-index-up-to-date), [GetProcessIoCounters](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getprocessiocounters), [IO_COUNTERS](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-io_counters) e [PROCESS_MEMORY_COUNTERS](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-process_memory_counters). Le API e gli attributi effettivi sono verificati anche nei sorgenti installati e nelle esecuzioni native con le versioni sopra dichiarate. La documentazione corrente LanceDB non certifica da sola una release diversa. `create_fts_index`, già usato dalla produzione, emette un avviso di deprecazione; questo lotto non cambia API o politica FTS.
