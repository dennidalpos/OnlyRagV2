"""
Pytest bootstrap for the sidecar suite.

The environment override MUST be set before anything imports sidecar.config: that module
resolves DATA_DIR / LANCEDB_DIR at import time and infrastructure.db opens the LanceDB
connection at import time too, so a later monkeypatch would arrive after the connection is
already pointed somewhere else.

Without it the suite ran against the user's real document store. That is not just untidy —
ingest_service drops and re-creates the `documents` table when a schema mismatch stops a row
being added, so a test run could delete every document the user had actually indexed, and the
tests themselves failed against whatever schema happened to be on disk ("Table 'documents'
already exists", 8 failures in test_translator.py).
"""

import atexit
import os
import shutil
import tempfile

_TEST_DATA_DIR = tempfile.mkdtemp(prefix="onlyrag-tests-")
os.environ["ONLYRAG_DATA_DIR"] = _TEST_DATA_DIR
atexit.register(lambda: shutil.rmtree(_TEST_DATA_DIR, ignore_errors=True))

import pytest  # noqa: E402  (import order is load-bearing, see module docstring)
import sidecar.infrastructure.embeddings as embeddings_module  # noqa: E402


@pytest.fixture(autouse=True)
def fast_fallback_embeddings(monkeypatch):
    """Ensure unit and regression tests run instantly using deterministic embeddings without external network timeouts."""
    def fake_generate_embedding_with_status(text, model="nomic-embed-text", ollama_url="http://127.0.0.1:11434"):
        return embeddings_module.get_fallback_embedding(text, dim=embeddings_module.EMBEDDING_DIM), False

    def fake_generate_embedding(text, model="nomic-embed-text", ollama_url="http://127.0.0.1:11434"):
        return embeddings_module.get_fallback_embedding(text, dim=embeddings_module.EMBEDDING_DIM)

    monkeypatch.setattr(embeddings_module, "generate_embedding_with_status", fake_generate_embedding_with_status)
    monkeypatch.setattr(embeddings_module, "generate_embedding", fake_generate_embedding)


@pytest.fixture(autouse=True)
def isolated_lancedb_tables():
    """
    Drops every LanceDB table between tests.

    The connection is process-wide, so without this a document ingested by one test stays
    visible to the next one — and a table written under one schema makes a later ingest with a
    different schema fail outright.
    """
    yield

    from sidecar.infrastructure.db import get_existing_tables, lance_db

    for table_name in get_existing_tables():
        try:
            lance_db.drop_table(table_name)
        except Exception:
            pass
