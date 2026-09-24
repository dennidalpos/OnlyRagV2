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
| Agent | `POST /agent/logs/analyze` |

## Note operative

- Ogni route tranne `/health` richiede l'header `X-OnlyRag-Token` quando il processo è avviato con `ONLYRAG_SIDECAR_TOKEN`: il Main genera un token casuale a ogni avvio e lo invia da `sidecarHttpClient`. L'header personalizzato impone anche il preflight CORS, quindi una pagina web non può chiamare l'API locale.
- `GET /documents` restituisce solo metadati (`DocumentSummary`, letti senza la colonna Markdown); il Markdown estratto arriva da `GET /documents/{doc_id}` (`DocumentRecord`), che risponde `404` per un documento assente o non indicizzato e `400` per un ID non valido.
- `/ingest-path-stream` riceve JSON ed emette NDJSON. Gli eventi `progress`/`done` portano `step_code` (`start`, `pdf_pages`, `page_ocr`, `page_text`, `page_text_tables`, `structured`, `chunking`, `embedding`, `done`) e `step_params`, neutri rispetto alla lingua; `step` è il testo inglese di ripiego. Lo stream riceve `task_id`; `POST /tasks/cancel` lo richiede e arresta solo quel task.
- `/ingest-path-stream` e `PUT /documents/{doc_id}` accettano `embedding_model` (dal setting `embeddingModel`); ogni chunk registra il modello che ha prodotto il vettore e la ricerca incorpora la query una volta per modello presente, quindi cambiare modello non mescola spazi vettoriali. I chunk con fallback hash sono marcati `fallback-hash`.
- La traduzione valida documento e tipo prima dello stream: documento assente o sorgente mancante rispondono `404`, tipo non supportato `400`; gli errori durante lo stream arrivano come evento `error`. Il file sorgente non viene mai modificato.
- Nessun modello di ripiego: `translate-inplace-stream` richiede `model` e `/ingest-path-stream` con `normalize_with_llm: true` richiede `normalization_model`; senza, la richiesta fallisce con `422`.
- L'ingestion accetta `normalization_think` per la normalizzazione LLM opzionale; la traduzione documenti accetta `think`. Entrambi sono booleani e partono da `false`. Le risposte Ollama usano solo il contenuto finale, senza incorporare il campo separato `thinking`.
- L'annullamento controlla i confini tra estrazione, embedding e scrittura LanceDB; eventuali chunk o record già avviati vengono rimossi prima della risposta `cancelled`.
- Ingestion e re-indicizzazione usano embedding Ollama; in caso di errore possono registrare `status: indexed_fallback`.
- La ricerca combina retrieval denso per modello, conteggio lessicale sui candidati e RRF, poi un cross-score lessicale locale. Non esiste un indice FTS/BM25 separato.
- Il Sidecar gestisce LanceDB, OCR RapidOCR/Vision, traduzione PDF/DOCX, export e storico semantico.
- Il vocabolario si inizializza all'avvio solo dagli asset inclusi (`bundled`), senza rete; se il manifest non è leggibile resta la cache esistente (`cache`).
- Ogni errore interno, anche quello intercettato da una route, risponde `500` con `{"detail": "Internal Server Error", "error_id"}`: il dettaglio (che può contenere path locali) resta solo nel log del Sidecar. Solo `400`/`404` di dominio riportano il messaggio. La validazione dei body è Pydantic.

Verifica: `npm run test:sidecar`. Rigenerazione OpenAPI: `npm run generate:openapi`.
