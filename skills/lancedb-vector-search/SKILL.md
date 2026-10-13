---
name: lancedb-vector-search
description: Local LanceDB ingestion and retrieval rules for OnlyRag V2.
---

# LanceDB retrieval

- Keep document metadata, chunks and filters consistent with `sidecar/infrastructure/db.py`.
- Ingestion writes provenance-bound chunks. Only an encoder transport failure may use the separate `indexed_fallback` hash space; invalid metadata or vectors fail.
- Search combines dense retrieval, native BM25, RRF and a local lexical score in `sidecar/services/search_service.py`.
- Validate document filters before querying LanceDB and preserve source identity in results.
- Verify ingestion/search changes with `npm run test:sidecar`.
