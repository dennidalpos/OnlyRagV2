"""The retired command must refuse before any storage, recovery or encoder access."""

import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import sys

import lancedb
import pytest

from sidecar.config import CHUNKS_TABLE_NAME
from sidecar.infrastructure.embeddings import EmbeddingSpace, get_fallback_embedding


_COMMAND = Path(__file__).resolve().parents[2] / "scripts" / "migrate_chunk_context.py"


def _invoke(root: Path | None, args: list[str]):
    environment = os.environ.copy()
    environment.pop("ONLYRAG_DATA_DIR", None)
    if root is not None:
        environment["ONLYRAG_DATA_DIR"] = str(root)
    return subprocess.run(
        [sys.executable, str(_COMMAND), *args],
        env=environment,
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )


@pytest.mark.parametrize("args", [[], ["--apply"], ["--help"]])
@pytest.mark.parametrize("configured", [False, True])
def test_retired_cli_refuses_without_creating_storage(tmp_path, args, configured):
    root = tmp_path / "must-not-be-created"
    result = _invoke(root if configured else None, args)
    assert result.returncode == 2
    assert "Retired:" in result.stderr
    assert "No storage was opened or changed" in result.stderr
    assert "RAG-EMBEDDING-REBUILD-01 remains deferred" in result.stderr
    assert not result.stdout
    assert not root.exists()


def _hashes(root: Path) -> dict[str, str]:
    return {
        str(file.relative_to(root)): hashlib.sha256(file.read_bytes()).hexdigest()
        for file in root.rglob("*")
        if file.is_file()
    }


@pytest.mark.parametrize("preparation", ["legacy-context-v0", "nomic-search-v1"])
def test_retired_cli_preserves_legacy_and_versioned_stores_and_recovery(tmp_path, preparation):
    root = tmp_path / "isolated-profile"
    store = lancedb.connect(root / "data" / "lancedb_store", session=lancedb.Session())
    text = "[Documento: doc.md | Sezione: doc.md]\nRetained original"
    space = EmbeddingSpace("nomic-embed-text", "a" * 64, 768, embedding_preparation=preparation)
    table = store.create_table(CHUNKS_TABLE_NAME, data=[{
        "chunk_id": "retained_chunk_0", "doc_id": "retained", "text": text,
        "vector": get_fallback_embedding(text, 768), **space.metadata(),
    }])
    history = store.create_table("prompt_history", data=[{"id": "retained", "prompt": "Original prompt"}])
    original = root / "data" / "source-documents" / "retained" / "original.md"
    original.parent.mkdir(parents=True, exist_ok=True)
    original.write_text(text, encoding="utf-8")
    journal = root / "data" / "document-recovery.json"
    journal.write_bytes(b"{invalid-recovery-journal")
    rows_before = table.to_arrow().to_pylist(), history.to_arrow().to_pylist()
    hashes_before = _hashes(root)

    result = _invoke(root, ["--apply"])

    assert result.returncode == 2
    assert "Retired:" in result.stderr
    assert (table.to_arrow().to_pylist(), history.to_arrow().to_pylist()) == rows_before
    assert _hashes(root) == hashes_before


def test_in_place_migration_service_is_removed():
    assert importlib.util.find_spec("sidecar.services.chunk_context_migration") is None
