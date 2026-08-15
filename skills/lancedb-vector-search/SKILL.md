---
name: lancedb-vector-search
description: "LanceDB vector embeddings, hybrid full-text search, and embedding index optimization."
version: "1.1.0"
author: "OnlyRag Team"
triggers: ["lancedb", "vector", "embedding", "rag", "lance"]
tags: ["lancedb", "rag", "embeddings", "vector-db"]
origin_hub: "OnlyRag Official Core Hub"
origin_hub_id: "official-core"
origin_checksum: "6c22a801a87612ce"
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
