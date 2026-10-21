---
name: lancedb-vector-search
description: Change OnlyRag LanceDB chunks, embedding provenance, hybrid retrieval, document filters, or source citations.
triggers: ["lancedb", "vector search", "embedding space", "bm25", "source provenance", "chunk storage"]
tags: ["retrieval", "rag"]
---

# LanceDB retrieval

- Keep document and chunk schemas consistent with `sidecar/infrastructure/db.py` and `sidecar/infrastructure/chunk_storage.py`.
- Preserve model, digest, dimension, normalization and text-preparation identity in `sidecar/infrastructure/embeddings.py`. Generate query vectors in the stored space; never assign current provenance to legacy rows.
- Use `indexed_fallback` only for encoder transport failure. Reject invalid vector metadata and incompatible spaces; require the explicit backed-up rebuild in `scripts/rebuild_embeddings.py` for a policy change.
- Keep dense retrieval, native BM25, RRF and local lexical ranking in `sidecar/services/search_service.py`. Validate `doc_id`/`doc_ids` before constructing LanceDB filters.
- For native lexical indexes, retain `create_index(..., config=FTS(...), replace=False)`, existing-index compatibility checks and the explicit refusal of legacy Tantivy `_indices/fts`. The old `create_fts_index` wrapper is not the current implementation. See `sidecar/tests/test_lexical_retrieval.py` for reuse and refusal regressions.
- Preserve revision-bound source identity through `sidecar/infrastructure/source_provenance.py`; a ranking score is not answer evidence.
- Run targeted pytest in `sidecar/tests/test_embedding_model_consistency.py`, `sidecar/tests/test_lexical_retrieval.py` and `sidecar/tests/test_source_provenance.py` as applicable; use [verification commands](../code-quality-and-linting/SKILL.md) for invocation details.
