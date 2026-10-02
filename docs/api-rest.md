# REST API Sidecar

Il server FastAPI ascolta su `127.0.0.1:8000`. Route e schemi sono definiti in [`sidecar/main.py`](../sidecar/main.py) e [`sidecar/schemas.py`](../sidecar/schemas.py); il contratto completo è [`openapi-2.5.0.json`](../sidecar/contracts/openapi-2.5.0.json).

## Route

| Area | Endpoint |
| --- | --- |
| Stato | `GET /health`, `POST /tasks/cancel?task_id=...` |
| Ingestion | `POST /ingest-path-stream` |
| Documenti | `GET /documents`, `GET /documents/{doc_id}`, `PUT /documents/{doc_id}`, `DELETE /documents/{doc_id}`, `GET /documents/{doc_id}/page-preview/{page_num}` |
| Traduzione | `POST /documents/{doc_id}/translate-inplace-stream` |
| Ricerca | `POST /vector/search` |
| Storico prompt | `POST /history/index`, `POST /history/search`, `POST /history/remove` |
| Export | `POST /export` |

## Note operative

Il rifiuto della normalizzazione e un evento terminale `error` di `/ingest-path-stream`, con `normalization_review: { original_markdown, issues: [{ page, reason }] }`. L'originale contiene tutte le pagine prima della normalizzazione; `page` parte da 1 e `reason` distingue troncamento, completamento non confermato, risposta vuota, richiesta/modello indisponibile, entita modificate e contenuto modificato. Nessun documento/chunk viene scritto. Il Main valida il campo; i [limiti e il comportamento di revisione](./rag-sidecar.md) non cambiano i record persistiti o gli errori ordinari.

- Ogni route tranne `/health` richiede l'header `X-OnlyRag-Token` quando il processo è avviato con `ONLYRAG_SIDECAR_TOKEN`: il Main genera un token casuale a ogni avvio e lo invia da `sidecarHttpClient`. L'header personalizzato impone anche il preflight CORS, quindi una pagina web non può chiamare l'API locale.
- `GET /documents` restituisce solo metadati (`DocumentSummary`, letti senza la colonna Markdown); il Markdown estratto arriva da `GET /documents/{doc_id}` (`DocumentRecord`), che risponde `404` per un documento assente o non indicizzato e `400` per un ID non valido.
- `/ingest-path-stream` riceve JSON ed emette NDJSON. Gli eventi `progress`/`done` portano `step_code` (`start`, `pdf_pages`, `page_ocr`, `page_text`, `page_text_tables`, `structured`, `chunking`, `embedding`, `done`) e `step_params`, neutri rispetto alla lingua; `step` è il testo inglese di ripiego. Lo stream riceve `task_id`; `POST /tasks/cancel` lo richiede e arresta solo quel task.
- `/ingest-path-stream` e `PUT /documents/{doc_id}` accettano `embedding_model` (dal setting `embeddingModel`); ogni nuovo chunk registra modello, digest, dimensione nativa e politica versionata. La ricerca incorpora la query nello stesso spazio completo, sotto filtro documento. Payload malformati non diventano hash; un indice legacy, un digest cambiato o una dimensione diversa richiedono ricostruzione esplicita protetta da backup/readback/rollback. Il formato delle richieste REST resta invariato. Vedi [politica embedding](./rag-sidecar.md#embedding-nativi-e-provenienza--2026-10-02).
- La traduzione valida documento e tipo prima dello stream: documento assente o sorgente mancante rispondono `404`, tipo non supportato `400`; gli errori durante lo stream arrivano come evento `error`. Il file sorgente non viene mai modificato.
- Il Sidecar prepara internamente documenti/query: prefissi Nomic distinti, istruzione Qwen solo sulla query, nessuna istruzione BGE-M3. La politica partecipa all'identita persistita; `raw-v1` Nomic/Qwen richiede rebuild esplicito. Nessun parametro REST aggiunto e nessuna migrazione automatica. La cronologia prompt resta raw fino al suo task di provenienza.
- `num_ctx` (ingestion e traduzione) è un intero tra 256 e 131072: Main lo limita al contesto addestrato del modello, quindi un modello vision da 2048 token come `moondream` riceve 2048.
- Nessun modello di ripiego: `translate-inplace-stream` richiede `model` e `/ingest-path-stream` con `normalize_with_llm: true` richiede `normalization_model`; senza, la richiesta fallisce con `422`.
- L'ingestion accetta `normalization_think` per la normalizzazione LLM opzionale; la traduzione documenti accetta `think`. Entrambi sono booleani e partono da `false`. Le risposte Ollama usano solo il contenuto finale, senza incorporare il campo separato `thinking`.
- L'annullamento controlla i confini tra estrazione, embedding e scrittura LanceDB; eventuali chunk o record già avviati vengono rimossi prima della risposta `cancelled`.
- `POST /tasks/cancel` accetta anche un ID arrivato prima della registrazione del task: la richiesta resta valida per 5 minuti. Le richieste non ancora associate a un task sono limitate a 1024 ID; oltre il limite viene scartata la più vecchia. Una risposta `success` conferma la registrazione della richiesta di annullamento, non l'esistenza di un task con quell'ID. Richieste ripetute per un task attivo o in attesa restano idempotenti.
- Ingestion e re-indicizzazione usano embedding Ollama; solo in caso di errore di trasporto possono registrare `status: indexed_fallback` nello spazio hash separato, se la dimensione dello store è compatibile. Errori HTTP/metadati/payload falliscono esplicitamente.
- La ricerca combina retrieval denso per spazio verificato e BM25 nativo indipendente su testo/nome/sezione, sotto lo stesso filtro documento, poi RRF e un cross-score lessicale locale. Il campo `score` ordina candidati: non e una probabilita calibrata di rilevanza o supporto. [Politica FTS e diagnostica dei rank](./rag-sidecar.md#independent-lexical-retrieval--2026-10-02).
- Il Sidecar gestisce LanceDB, OCR RapidOCR/Vision, traduzione PDF/DOCX, export e storico semantico.
- Il vocabolario si inizializza all'avvio solo dagli asset inclusi (`bundled`), senza rete; se il manifest non è leggibile resta la cache esistente (`cache`).
- Ogni errore interno, anche quello intercettato da una route, risponde `500` (eccetto il database indisponibile su `/health`, che risponde `503`) con `{"detail": "Internal Server Error", "error_id"}`: il dettaglio (che può contenere path locali) resta solo nel log del Sidecar. Solo `400`/`404` di dominio riportano il messaggio. La validazione dei body è Pydantic.

Verifica: `npm run test:sidecar`. Rigenerazione OpenAPI: `npm run generate:openapi`.

## Affidabilita del database

- `GET /health` restituisce 503 se il database non e utilizzabile o il recupero e fallito; 200 mantiene il contratto `status: online`. Il Main interpreta un 503 come offline.
- I guasti di lettura, aggiornamento, cancellazione e ricerca restituiscono 500, senza essere convertiti in elenchi vuoti o successi. `[]` indica un archivio realmente vuoto. Il Renderer conserva elenco e selezione su una richiesta fallita.
- Ingestion e reindicizzazione preparano embedding e chunk prima del commit coordinato. Se la seconda tabella fallisce, vengono ripristinate entrambe; il registro delle versioni sopravvive alle interruzioni del processo. Non modificare o cancellare `data/document-recovery.json` quando il recupero fallisce.
