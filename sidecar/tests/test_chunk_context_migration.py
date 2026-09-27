from pathlib import Path

import pytest

from sidecar.config import CHUNKS_TABLE_NAME, LANCEDB_DIR
from sidecar.infrastructure.db import lance_db
from sidecar.infrastructure.embeddings import FALLBACK_EMBEDDING_MODEL, get_fallback_embedding
from sidecar.services import chunk_context_migration


def _row(chunk_id: str, text: str, model: str = FALLBACK_EMBEDDING_MODEL) -> dict:
    return {
        "chunk_id": chunk_id,
        "doc_id": "doc",
        "doc_name": "doc.md",
        "text": text,
        "vector": get_fallback_embedding(text),
        "chunk_index": 0,
        "section_header": "doc.md",
        "file_type": "md",
        "ingested_at": "2026-09-27",
        "embedding_model": model,
    }


def test_migrates_legacy_prefix_and_vector_with_backup():
    old = "[Documento: doc.md | Sezione: doc.md]\nLegacy content"
    current = "[Document: doc.md | Section: doc.md]\nCurrent content"
    table = lance_db.create_table(CHUNKS_TABLE_NAME, data=[_row("old_chunk_0", old), _row("new_chunk_0", current)])

    count, backup = chunk_context_migration.migrate_chunk_context(table, Path(LANCEDB_DIR))

    assert count == 1
    assert backup is not None and backup.is_dir()
    rows = {row["chunk_id"]: row for row in table.to_arrow().to_pylist()}
    migrated = "[Document: doc.md | Section: doc.md]\nLegacy content"
    assert rows["old_chunk_0"]["text"] == migrated
    assert rows["old_chunk_0"]["vector"] == pytest.approx(get_fallback_embedding(migrated))
    assert rows["new_chunk_0"]["text"] == current
    assert chunk_context_migration.migrate_chunk_context(table, Path(LANCEDB_DIR)) == (0, None)


def test_unavailable_embedding_model_aborts_before_backup_or_write(monkeypatch):
    old = "[Documento: doc.md | Sezione: doc.md]\nLegacy content"
    table = lance_db.create_table(CHUNKS_TABLE_NAME, data=[_row("old_chunk_0", old, "missing-model")])
    monkeypatch.setattr(chunk_context_migration, "generate_embeddings_with_status", lambda texts, model: ([get_fallback_embedding(t) for t in texts], True))
    backups_before = set(Path(LANCEDB_DIR).parent.glob("lancedb_store.before-context-en-*"))

    with pytest.raises(RuntimeError, match="unavailable"):
        chunk_context_migration.migrate_chunk_context(table, Path(LANCEDB_DIR))

    assert table.to_arrow().to_pylist()[0]["text"] == old
    assert set(Path(LANCEDB_DIR).parent.glob("lancedb_store.before-context-en-*")) == backups_before


def test_context_conversion_preserves_document_and_section_content():
    old = "[Documento: report.md | Sezione: report.md > Parte A]\nDocumento: body"
    assert chunk_context_migration.updated_context_text(old) == "[Document: report.md | Section: report.md > Parte A]\nDocumento: body"
    assert chunk_context_migration.updated_context_text("Ordinary text") is None
