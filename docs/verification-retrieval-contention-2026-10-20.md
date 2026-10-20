# Ricerca con vettori più ampi e contesa — 20 ottobre 2026

Il proprietario ha scelto 10.000/100.000 chunk, dimensioni 768/1024, letture durante aggiornamenti e **p95 entro 5 secondi**, limitando il seguito a correzioni/verifiche locali. `RAG-INDEX-METADATA-EFFICIENCY-01` resta aperto per encoder reali e desktop installato: questi vettori sono sintetici, non output di Nomic/BGE.

[`retrievalEfficiency.py`](../scripts/e2e/retrievalEfficiency.py) conserva lo scenario storico 128D e aggiunge dimensione esplicita, vettori densi deterministici, lunghezze disuguali con testo multilingue e contesa. Ogni combinazione usa una nuova root isolata, 100 documenti con originali/archivi reali, venti campioni per scenario, una coda non indicizzata del 10%, quattro lettori da venti richieste e venti aggiornamenti nativi dei metadati di un documento estraneo ai cinque risultati attesi. Il writer usa il lock applicativo; non simula un'intera ingestione o la codifica del modello. Il trasporto httpx è vietato nel processo.

| Chunk | Dimensioni | Prima ricerca ms | p95 calda ms | p95 terminali in contesa ms | p95 writer ms | Conflitti / 80 |
| --- | --- | --- | --- | --- | --- | --- |
| 10.000 | 768 | 183 | 113 | 409 | 226 | 40 |
| 10.000 | 1024 | 189 | 109 | 476 | 139 | 49 |
| 100.000 | 768 | 803 | 457 | 2.131 | 1.012 | 33 |
| 100.000 | 1024 | 956 | 510 | 2.738 | 1.674 | 35 |

Tutte le quattro combinazioni soddisfano il limite locale dichiarato. I terminali includono **conflitti di revisione espliciti**, non vengono contati tutti come ricerche riuscite. Nessun retry nascosto o errore scartato: i campioni completi e i p95 dei soli successi sono nella [ricevuta JSON](./verification-retrieval-contention-2026-10-20.json). Il carico non certifica una disponibilità del 100%, la latenza di un retry end-to-end o la qualità semantica.

Per ciascun successo restano identici cinque risultati ordinati e tutti i campi di provenienza; navigazione e identificatore nella coda non indicizzata passano. Query senza scritture preservano tutte le righe e gli archivi. Dopo la contesa il metadato di prova viene ripristinato e tutti i campi delle tabelle, ordinati per identità, e tutti i file d'archivio coincidono con la baseline. Le modifiche native possono riordinare i frammenti fisici: il primo tentativo falliva confrontando l'ordine Arrow fisico; conserva diagnostico e fixture, poi usa uguaglianza canonica completa senza scartare campi.

Le misure sono state eseguite serialmente, prima delle nuove build/suite complete. Le versioni, contatori Windows, hash sorgenti e campioni sono nella ricevuta. I report originali sono copiati con readback SHA256 in `C:/Users/Utente/OnlyRag-Live/tracker-local-fixes-20261020-1de2acbf`; root complete e tentativo iniziale restano conservati per revisione. Nessuna modifica al runtime di ricerca, modello reale, installazione o archivio personale.

Conservazione finale: le cinque nuove root RAG e i cinque probe Monaco sono trasferiti integralmente sotto `tracker-local-fixes-20261020-1de2acbf/fixtures`, con **2.136 file** riletti SHA256. `fixture-location-map.json` conserva la corrispondenza dei vecchi percorsi TEMP e i digest per file. I report originali rimangono immutati: risolvere i loro percorsi tramite questa mappa, non presumere che i path TEMP storici esistano ancora. Nessuna eliminazione delle prove o dei fallimenti.

Residuo osservato: LanceDB 0.37.1 segnala `create_fts_index` deprecato a favore di `create_index(FTS(...))`. L'API funziona nei casi misurati; la migrazione con parità di configurazione e recupero della coda resta annotata nel task RAG esistente, senza cambiare API durante questa misura. [API primaria LanceDB](https://lancedb.github.io/lancedb/python/python/); la compatibilità effettiva è verificata con il pacchetto 0.37.1 installato.
