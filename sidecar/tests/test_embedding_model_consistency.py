"""The query must be embedded with the same model that embedded each stored chunk.

Before the fix, ingestion always used nomic-embed-text while search embedded the query with the
user's configured model, so a non-default embedding setting compared vectors from unrelated
spaces and returned noise.
"""
import os
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import sidecar.infrastructure.embeddings as embeddings_module  # noqa: E402
from sidecar.config import CHUNKS_TABLE_NAME, DOCS_TABLE_NAME  # noqa: E402
from sidecar.infrastructure.db import ensure_chunk_embedding_model_column, lance_db  # noqa: E402
from sidecar.main import app  # noqa: E402
from sidecar.services import ingest_service, search_service  # noqa: E402
from _stream import ingest_path  # noqa: E402

client = TestClient(app)


def _chunk_models(doc_id: str) -> set:
    rows = lance_db.open_table(CHUNKS_TABLE_NAME).to_arrow().to_pylist()
    return {row["embedding_model"] for row in rows if row["doc_id"] == doc_id}


def _write(tmp_path, name: str, text: str) -> str:
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return str(path)


def test_ingest_tags_chunks_with_the_requested_model(tmp_path):
    doc = ingest_path(client, _write(tmp_path, "a.md", "# Title\n\nAlpha content."), embedding_model="model-b")
    assert _chunk_models(doc["id"]) == {"model-b"}


def test_fallback_vectors_are_tagged_as_fallback(tmp_path, monkeypatch):
    def offline(texts, model="x", ollama_url=""):
        return [embeddings_module.get_fallback_embedding(t) for t in texts], True

    monkeypatch.setattr(ingest_service, "generate_embeddings_with_status", offline)
    doc = ingest_path(client, _write(tmp_path, "b.md", "# Offline\n\nBeta content."), embedding_model="model-b")
    assert doc["status"] == "indexed_fallback"
    assert _chunk_models(doc["id"]) == {embeddings_module.FALLBACK_EMBEDDING_MODEL}


def test_search_embeds_the_query_once_per_stored_model(tmp_path, monkeypatch):
    ingest_path(client, _write(tmp_path, "c.md", "# Gamma\n\nGamma content."), embedding_model="model-a")
    ingest_path(client, _write(tmp_path, "d.md", "# Delta\n\nDelta content."), embedding_model="model-b")

    query_models = []

    def record_query(text, model="", ollama_url=""):
        query_models.append(model)
        return embeddings_module.get_fallback_embedding(text), False

    monkeypatch.setattr(search_service, "generate_embedding_with_status", record_query)
    response = client.post("/vector/search", json={"query": "content", "top_k": 5})

    assert response.status_code == 200
    assert sorted(query_models) == ["model-a", "model-b"]
    assert {r["doc_name"] for r in response.json()} == {"c.md", "d.md"}


def test_search_skips_a_model_whose_query_embedding_fell_back(tmp_path, monkeypatch):
    ingest_path(client, _write(tmp_path, "e.md", "# Epsilon\n\nEpsilon content."), embedding_model="model-a")
    monkeypatch.setattr(
        search_service,
        "generate_embedding_with_status",
        lambda text, model="", ollama_url="": (embeddings_module.get_fallback_embedding(text), True),
    )
    response = client.post("/vector/search", json={"query": "epsilon", "top_k": 5})
    assert response.status_code == 200
    assert response.json() == []


def test_search_rejects_the_removed_embedding_model_field():
    assert client.post("/vector/search", json={"query": "x", "embedding_model": "m"}).status_code == 422


def test_legacy_store_is_migrated_with_default_and_fallback_models():
    vec = embeddings_module.get_fallback_embedding("legacy")
    base = {"vector": vec, "doc_name": "n", "text": "t", "chunk_index": 0, "section_header": "",
            "file_type": "md", "ingested_at": "2026-01-01"}
    lance_db.create_table(CHUNKS_TABLE_NAME, data=[
        {**base, "chunk_id": "real_chunk_0", "doc_id": "real"},
        {**base, "chunk_id": "hash_chunk_0", "doc_id": "hash"},
    ])
    lance_db.create_table(DOCS_TABLE_NAME, data=[
        {"id": "real", "status": "indexed"},
        {"id": "hash", "status": "indexed_fallback"},
    ])

    ensure_chunk_embedding_model_column(
        CHUNKS_TABLE_NAME, DOCS_TABLE_NAME,
        embeddings_module.DEFAULT_EMBEDDING_MODEL, embeddings_module.FALLBACK_EMBEDDING_MODEL,
    )

    assert _chunk_models("real") == {embeddings_module.DEFAULT_EMBEDDING_MODEL}
    assert _chunk_models("hash") == {embeddings_module.FALLBACK_EMBEDDING_MODEL}
