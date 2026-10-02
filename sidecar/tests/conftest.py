"""Set isolated storage before Sidecar imports resolve and open the database.

Extraction/indexing tests must never write to the real user store. HTTP regressions can
opt into a separately isolated frozen Sidecar.
"""

import atexit
import os
import shutil
import tempfile

_TEST_DATA_DIR = tempfile.mkdtemp(prefix="onlyrag-tests-")
os.environ["ONLYRAG_DATA_DIR"] = _TEST_DATA_DIR
atexit.register(lambda: shutil.rmtree(_TEST_DATA_DIR, ignore_errors=True))

import pytest  # noqa: E402  (import order is load-bearing, see module docstring)
import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import sidecar.infrastructure.embeddings as embeddings_module  # noqa: E402


@pytest.fixture
def sidecar_http_client():
    """Use the local app or an explicitly configured, isolated frozen test server."""
    url = os.environ.get("ONLYRAG_TABULAR_TEST_URL")
    if url:
        with httpx.Client(base_url=url, headers={
            "X-OnlyRag-Token": os.environ["ONLYRAG_TABULAR_TEST_TOKEN"],
        }, timeout=60) as client:
            yield client
    else:
        from sidecar.main import app
        with TestClient(app) as client:
            yield client


@pytest.fixture(autouse=True)
def fast_fallback_embeddings(monkeypatch):
    """Declared word-hash fixture for mechanics, not encoder geometry or semantic quality."""
    from sidecar.services import ingest_service as ingest_service_module
    from sidecar.services import search_service as search_service_module

    def fake_embedding_batch(texts, model="nomic-embed-text", ollama_url="http://127.0.0.1:11434", expected_space=None, *, role="document"):
        space = expected_space or embeddings_module.EmbeddingSpace(model, "f" * 64, embeddings_module.FALLBACK_DIMENSION)
        return embeddings_module.EmbeddingBatch([embeddings_module.get_fallback_embedding(text, space.embedding_dimension) for text in texts], space)

    def fake_generate_embedding_with_status(text, model="nomic-embed-text", ollama_url="http://127.0.0.1:11434"):
        return embeddings_module.get_fallback_embedding(text), False

    def fake_generate_embedding(text, model="nomic-embed-text", ollama_url="http://127.0.0.1:11434"):
        return embeddings_module.get_fallback_embedding(text)

    def fake_generate_embeddings_with_status(texts, model="nomic-embed-text", ollama_url="http://127.0.0.1:11434"):
        return [
            embeddings_module.get_fallback_embedding(text)
            for text in texts
        ], False

    monkeypatch.setattr(embeddings_module, "generate_embedding_with_status", fake_generate_embedding_with_status)
    monkeypatch.setattr(embeddings_module, "generate_embedding", fake_generate_embedding)
    monkeypatch.setattr(embeddings_module, "generate_embeddings_with_status", fake_generate_embeddings_with_status)
    monkeypatch.setattr(embeddings_module, "generate_embedding_batch", fake_embedding_batch)
    monkeypatch.setattr(ingest_service_module, "generate_embedding_batch", fake_embedding_batch)
    monkeypatch.setattr(search_service_module, "generate_embedding_batch", fake_embedding_batch)


@pytest.fixture(autouse=True)
def isolated_lancedb_tables():
    """
    Drops every LanceDB table between tests.

    The connection is process-wide, so without this a document ingested by one test stays
    visible to the next one — and a table written under one schema makes a later ingest with a
    different schema fail outright.
    """
    import lancedb
    from sidecar.config import LANCEDB_DIR
    from sidecar.infrastructure.db import get_existing_tables, lance_db

    # A fresh native session prevents cached indexes surviving drop/recreate at the same URI.
    lance_db.__init__(LANCEDB_DIR, session=lancedb.Session())
    yield

    for table_name in get_existing_tables():
        lance_db.drop_table(table_name)
