---
name: lancedb-vector-search
description: Change OnlyRag LanceDB chunks, embedding provenance, hybrid retrieval, document filters, or source citations.
triggers: ["lancedb", "vector search", "embedding space", "bm25", "source provenance", "chunk storage"]
tags: ["retrieval", "rag"]
---

# LanceDB retrieval

- Keep document and chunk schemas consistent with `sidecar/infrastructure/db.py` and `chunk_storage.py`.
- Preserve model, digest, dimension, normalization and text-preparation identity in `embeddings.py`. Generate query vectors in the stored space; never assign current provenance to legacy rows.
- Use `indexed_fallback` only for encoder transport failure. Reject invalid vector metadata and incompatible spaces; require the explicit backed-up rebuild in `scripts/rebuild_embeddings.py` for a policy change.
- Keep dense retrieval, native BM25, RRF and local lexical ranking in `sidecar/services/search_service.py`. Validate `doc_id`/`doc_ids` before constructing LanceDB filters.
- Preserve revision-bound source identity through `sidecar/infrastructure/source_provenance.py`; a ranking score is not answer evidence.
- Run targeted Sidecar tests for ingestion, search and provenance changes.
