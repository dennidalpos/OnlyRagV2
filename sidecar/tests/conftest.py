"""Set isolated storage before Sidecar imports resolve and open the database.

Extraction/indexing tests must never write to the real user store. HTTP regressions can
opt into a separately isolated frozen Sidecar.
"""

import atexit
import os
import tempfile
import re
import json
from pathlib import Path
from scripts.test.fixture_runtime import create_fixture_directory, retain_fixture

_TEST_DATA_DIR = create_fixture_directory("onlyrag-tests-")
os.environ["ONLYRAG_DATA_DIR"] = str(_TEST_DATA_DIR)
atexit.register(retain_fixture, _TEST_DATA_DIR)

import pytest  # noqa: E402  (import order is load-bearing, see module docstring)
import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import sidecar.infrastructure.embeddings as embeddings_module  # noqa: E402


@pytest.hookimpl(tryfirst=True)
def pytest_configure(config):
    if config.pluginmanager.hasplugin("junitxml") and not config.option.xmlpath:
        config.option.xmlpath = str(_TEST_DATA_DIR / "pytest.xml")


class RetainedTempFactory:
    def getbasetemp(self):
        return _TEST_DATA_DIR / "cases"

    def mktemp(self, basename, numbered=True):
        if not basename or Path(basename).name != basename or basename in (".", ".."):
            raise ValueError("Temporary fixture name must be a single component")
        parent = self.getbasetemp()
        parent.mkdir(exist_ok=True)
        if numbered:
            return Path(tempfile.mkdtemp(prefix=basename + "-", dir=parent))
        directory = parent / basename
        directory.mkdir()
        return directory


@pytest.fixture(scope="session")
def tmp_path_factory():
    return RetainedTempFactory()


@pytest.fixture
def tmp_path(tmp_path_factory, request):
    # Keep room for native database/version paths on Windows; case.json keeps the full node ID.
    return tmp_path_factory.mktemp(re.sub(r'[\x00-\x1f/\\<>:"|?*]', '_', request.node.name)[:24])


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
    from sidecar.services import prompt_history_service as prompt_history_service_module

    def fake_embedding_batch(texts, model="nomic-embed-text", ollama_url="http://127.0.0.1:11434", expected_space=None, *, role="document"):
        space = expected_space or embeddings_module.EmbeddingSpace(model, "f" * 64, embeddings_module.FALLBACK_DIMENSION)
        return embeddings_module.EmbeddingBatch([embeddings_module.get_fallback_embedding(text, space.embedding_dimension) for text in texts], space)

    monkeypatch.setattr(embeddings_module, "generate_embedding_batch", fake_embedding_batch)
    monkeypatch.setattr(ingest_service_module, "generate_embedding_batch", fake_embedding_batch)
    monkeypatch.setattr(search_service_module, "generate_embedding_batch", fake_embedding_batch)
    monkeypatch.setattr(prompt_history_service_module, "generate_embedding_batch", fake_embedding_batch)


@pytest.fixture(autouse=True)
def isolated_lancedb_tables(tmp_path, tmp_path_factory, monkeypatch, request):
    """
    Bind the process-wide connection to a new retained database for every test.
    This isolates schemas and documents without deleting the previous test's tables.
    """
    import lancedb
    from sidecar import config
    from sidecar.infrastructure import db

    database_root = tmp_path_factory.mktemp("database")
    directory = database_root / "lancedb_store"
    (database_root / "case.json").write_text(json.dumps({"nodeId": request.node.nodeid, "scenario": str(tmp_path)}), encoding="utf-8")
    monkeypatch.setattr(config, "LANCEDB_DIR", str(directory))
    monkeypatch.setattr(db, "LANCEDB_DIR", str(directory))
    monkeypatch.setattr(db, "_journal_path", database_root / "document-recovery.json")
    db.lance_db.__init__(str(directory), session=lancedb.Session())
