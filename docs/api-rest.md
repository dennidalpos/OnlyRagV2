# REST Sidecar

[`sidecar/main.py`](../sidecar/main.py) registra FastAPI e le route; [`schemas.py`](../sidecar/schemas.py) definisce i payload. Il contratto generato è [`openapi-2.5.0.json`](../sidecar/contracts/openapi-2.5.0.json). Il Sidecar ascolta normalmente su `127.0.0.1:8000`; ogni route salvo `/health` richiede il token di avvio `X-OnlyRag-Token` quando configurato da Main.

## Route

| Ambito | Endpoint |
| --- | --- |
| Stato e annullamento | `GET /health`, `POST /tasks/cancel` |
| Ingestion e documenti | `POST /ingest-path-stream`, `GET /documents`, `GET/PUT/DELETE /documents/{doc_id}`, `GET /documents/{doc_id}/page-preview/{page_num}`, `GET /documents/{doc_id}/source-location` |
| Traduzione ed export | `POST /documents/{doc_id}/translate-inplace-stream`, `POST /export` |
| Ricerca e cronologia | `POST /vector/search`, `POST /history/index`, `POST /history/search`, `POST /history/remove` |

## Regole operative

- Ingestion e traduzione inviano eventi NDJSON. `task_id` collega progresso e cancellazione; una risposta di accettazione della cancellazione non afferma che il task sia già terminato.
- Ingestion con normalizzazione LLM richiede `normalization_model`; traduzione richiede `model`. Una normalizzazione rifiutata restituisce l'originale da rivedere senza indicizzarlo.
- La ricerca verifica lo spazio embedding completo e può restituire provenance. `source-location` accetta solo ID, revisioni e span, mai percorsi forniti dal chiamante.
- `/health` risponde 503 quando database o recovery non sono disponibili. Errori di lettura/scrittura/ricerca non diventano liste vuote; errori interni espongono un ID e tengono i dettagli nel log.

Per comportamento e limiti: [`ingestion.md`](./ingestion.md), [`retrieval.md`](./retrieval.md), [`translation.md`](./translation.md). Rigenerare OpenAPI con `npm run generate:openapi` solo dopo una modifica del contratto.
