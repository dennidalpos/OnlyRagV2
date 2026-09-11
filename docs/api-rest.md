# REST API Sidecar

Il server FastAPI ascolta su `127.0.0.1:8000`. Route e schemi sono definiti in [`sidecar/main.py`](../sidecar/main.py) e [`sidecar/schemas.py`](../sidecar/schemas.py); il contratto completo è [`openapi-2.3.0.json`](../sidecar/contracts/openapi-2.3.0.json).

## Route

| Area | Endpoint |
| --- | --- |
| Stato/manutenzione | `GET /health`, `POST /db/maintenance`, `POST /cleanup/temp`, `POST /tasks/cancel?task_id=...` |
| Ingestion | `POST /ingest`, `POST /ingest-path`, `POST /ingest-path-stream` |
| Documenti | `GET /documents`, `PUT /documents/{doc_id}`, `DELETE /documents/{doc_id}`, `GET /documents/{doc_id}/page-preview/{page_num}` |
| Traduzione | `POST /documents/{doc_id}/translate-inplace`, `POST /documents/{doc_id}/translate-inplace-stream` |
| Ricerca | `POST /vector/search` |
| Storico prompt | `POST /history/index`, `POST /history/search`, `POST /history/remove` |
| Export | `POST /export` |
| Agent | `POST /agent/logs/analyze` |
| Vocabolario | `POST /vocab/sync`, `GET /vocab/status` |

## Note operative

- `/ingest` usa multipart upload; gli endpoint `ingest-path` ricevono JSON e possono emettere NDJSON.
- Ingestion e re-indicizzazione usano embedding Ollama; in caso di errore possono registrare `status: indexed_fallback`.
- La ricerca combina embedding, matching lessicale e RRF; il reranking usa FlashRank quando disponibile e un fallback locale altrimenti.
- Il Sidecar gestisce LanceDB, OCR RapidOCR/Vision, traduzione PDF/DOCX, export e storico semantico.
- Gli errori non gestiti rispondono `500` con `error_id`; la validazione dei body è Pydantic.

Verifica: `npm run test:sidecar`. Rigenerazione OpenAPI: `npm run generate:openapi`.
