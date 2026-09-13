---
name: lancedb-vector-search
description: Local LanceDB ingestion and retrieval rules for OnlyRag V2.
---

# LanceDB retrieval

- Keep document metadata, chunks and filters consistent with `sidecar/infrastructure/db.py`.
- Ingestion writes context-aware chunks; a failed Ollama embedding is recorded as `indexed_fallback`.
- Search combines dense retrieval, lexical matching, RRF and optional FlashRank reranking in `sidecar/services/search_service.py`.
- Validate document filters before querying LanceDB and preserve source identity in results.
- Verify ingestion/search changes with `npm run test:sidecar`.
