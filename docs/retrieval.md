# Embedding, indice e ricerca

La provenienza dei vettori e la ricerca sono implementate in [`embeddings.py`](../sidecar/infrastructure/embeddings.py), [`chunk_storage.py`](../sidecar/infrastructure/chunk_storage.py), [`search_service.py`](../sidecar/services/search_service.py) e [`db.py`](../sidecar/infrastructure/db.py). REST e tipi rimangono in [`api-rest.md`](./api-rest.md).

## Invarianti

- Ogni spazio nativo conserva modello, digest, dimensione, normalizzazione e preparazione. Documento e query devono usare la stessa identità completa. Gli indici legacy senza provenienza non ricevono un'identità presunta; un cambio di modello o preparazione richiede un rebuild verificato.
- Nomic usa prefissi diversi per documento e query; Qwen usa un'istruzione sulla query; BGE-M3 e lo spazio hash mantengono testo raw. Solo errori di trasporto dell'encoder possono produrre il fallback hash, in uno spazio distinto.
- La ricerca combina candidati densi e BM25 nativo, applica il filtro documento e ordina con RRF e segnali lessicali. Il punteggio è un ordine di ranking, non una probabilità di correttezza né una prova che una risposta sia supportata.
- La navigazione di una fonte verifica ID, revisioni, span e hash dell'originale. Una posizione valida non certifica la verità della frase generata.
- Il rebuild offline richiede una radice dichiarata, backup/readback e attivazione esplicita tramite `data/active-store.json`; non migra automaticamente profili personali. Comandi e rifiuti sono in [`operations.md`](./operations.md).

## Stato della verifica

Le prove isolate confermano la meccanica degli spazi, dei filtri, del recupero e del ranking. La proiezione Arrow riduce il costo della scansione dei metadati nel fixture da 100.000 chunk; ricerca completa, costruzione FTS, I/O degli archivi e qualità multilingue restano da misurare o qualificare. Il corpus di accettazione congelato e i risultati, inclusi i fallimenti, sono in [`content-acceptance.md`](./content-acceptance.md). I task aperti sono `RAG-INDEX-METADATA-EFFICIENCY-01`, `HISTORY-EMBEDDING-CORRECTNESS-01` e `QUALITY-CONTENT-LIVE-QUALIFICATION-01` nel [`tracker`](../PROJECT_STATUS.json).

Dettagli e misure datate: [`rag-sidecar-history-2026-10-13.md`](./rag-sidecar-history-2026-10-13.md) e [`verification-history-2026-10-13.md`](./verification-history-2026-10-13.md).
