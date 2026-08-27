---
name: lancedb-vector-search
description: "LanceDB vector embeddings, hybrid full-text search, and embedding index optimization."
version: "1.1.0"
author: "OnlyRag Team"
triggers: ["lancedb", "vector", "embedding", "rag", "lance"]
tags: ["lancedb", "rag", "embeddings", "vector-db"]
origin_hub: "OnlyRag Official Core Hub"
origin_hub_id: "official-core"
origin_checksum: "8c7a28385d7e8f47"
is_modified: false
---

# LanceDB Vector Database Guidelines

## 1. Embedding & Schema Integrity
- Ensure fixed dimensionality across document chunks (e.g. 768 for nomic-embed-text / bge-large).
- Always normalize vector queries before cosine similarity matching.
- Store metadata (file_path, chunk_index, timestamp) alongside dense vector arrays.

## 2. Query Optimization
- Use IVF-PQ or scalar indices when collection exceeds 50,000 chunks.
- Combine dense vector distance search with BM25 / keyword filtering for high-precision retrieval.

## 3. Retrieval Correctness
- Keep embedding model and vector dimensions in the collection metadata; reject mismatches before writing rows.
- Preserve `doc_id`, source path, chunk index, and section context with every chunk so results remain explainable.
- Apply workspace or document filters before returning results, never only in the renderer.
- Return an explicit empty result for a valid empty query scope and a distinct error for an unavailable database.

## 4. Operations
- Create or migrate tables idempotently and avoid destructive schema changes during normal ingestion.
- Test ingestion, dimension mismatch, filtered search, empty collections, and persistence across process restarts.
