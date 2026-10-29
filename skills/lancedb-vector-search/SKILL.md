---
name: lancedb-vector-search
description: Change OnlyRag LanceDB chunks, embedding provenance, hybrid retrieval, document filters, or source citations.
triggers: ["lancedb", "vector search", "embedding space", "bm25", "source provenance", "chunk storage"]
tags: ["retrieval", "rag"]
---

# LanceDB retrieval

- Keep document and chunk schemas consistent with `sidecar/infrastructure/db.py` and `sidecar/infrastructure/chunk_storage.py`.
- Preserve model, digest, dimension, normalization and text-preparation identity in `sidecar/infrastructure/embeddings.py`. Generate query vectors in the stored space; never assign current provenance to legacy rows.
- Ingestion may record `indexed_fallback` for an allowed encoder transport failure; query encoding must not silently switch spaces when the configured encoder fails. Reject invalid vector metadata and incompatible spaces; use the explicit backed-up rebuild in `scripts/rebuild_embeddings.py` for a space change.
- Keep dense retrieval, native BM25, RRF and local lexical ranking in `sidecar/services/search_service.py`. Validate `doc_id`/`doc_ids` before constructing LanceDB filters.
- For native lexical indexes, retain `create_index(..., config=FTS(...), replace=False)`, existing-index compatibility checks and the explicit refusal of legacy Tantivy `_indices/fts`. The old `create_fts_index` wrapper is not the current implementation. See `sidecar/tests/test_lexical_retrieval.py` for reuse and refusal regressions.
- Preserve revision-bound source identity through `sidecar/infrastructure/source_provenance.py`; a ranking score is not answer evidence.
- Prompt history in `sidecar/services/prompt_history_service.py` also stores encoder provenance. Do not infer a digest or preparation identity for legacy history rows, or treat a document-store rebuild as a history rebuild; check `sidecar/tests/test_history_encoder_provenance.py`.
- Select embedding consistency, lexical retrieval and source-provenance regressions under `sidecar/tests/` as applicable. Use [retrieval.md](../../docs/retrieval.md) for the data flow and [verification commands](../code-quality-and-linting/SKILL.md) for invocation details.
