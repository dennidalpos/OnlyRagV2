from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi.testclient import TestClient

from sidecar.infrastructure import db
from sidecar.services import ingest_service, search_service, prompt_history_service
from sidecar.schemas import PromptHistorySearchRequest
from sidecar.config import PROMPT_HISTORY_TABLE_NAME
from sidecar.infrastructure.embeddings import FALLBACK_SPACE, get_fallback_embedding
from sidecar import main


@pytest.fixture(autouse=True)
def isolated_recovery(monkeypatch, tmp_path):
    monkeypatch.setattr(db, "_journal_path", tmp_path / "document-recovery.json")
    monkeypatch.setattr(db, "_recovery_error", None)
    yield
    db._recovery_error = None
    db._journal_path.unlink(missing_ok=True)


def document(doc_id="one", text="old"):
    return {"id": doc_id, "filename": "notes.md", "file_path": "notes.md", "file_size": len(text),
            "num_pages": 1, "num_chunks": 1, "extracted_markdown": text, "status": "indexed",
            "ingested_at": "2026-09-30", "file_type": "text", "used_fallback_embeddings": False}


def chunks(doc_id="one", text="old"):
    return [{"chunk_id": f"{doc_id}_chunk_0", "doc_id": doc_id, "text": text, "vector": get_fallback_embedding(text),
             "doc_name": "notes.md", "chunk_index": 0, "section_header": "", "file_type": "text",
             "ingested_at": "2026-09-30", **FALLBACK_SPACE.metadata()}]


def seed():
    db.write_document_records(document(), chunks())
    db.write_document_records(document("other"), chunks("other"))


def rows(name):
    return sorted(db.lance_db.open_table(name).search().limit(None).to_list(), key=lambda row: row.get("id", row.get("chunk_id")))


def test_rejected_atomic_replacement_preserves_previous_record():
    db.append_records("replacement", [{"id": "one", "text": "old"}, {"id": "other", "text": "keep"}])
    with pytest.raises(db.SchemaMismatchError):
        db.append_records("replacement", [{"id": "one", "unexpected": 7}], delete_where="id = 'one'")
    assert rows("replacement") == [{"id": "one", "text": "old"}, {"id": "other", "text": "keep"}]


def test_embedding_failure_preserves_document_and_chunks(monkeypatch):
    seed()
    before = rows("documents"), rows("chunks")
    def fail(*args):
        raise RuntimeError("embedding failure")
    monkeypatch.setattr(ingest_service, "_build_chunk_records", fail)
    with pytest.raises(RuntimeError, match="embedding failure"):
        ingest_service.update_and_reindex_document("one", "replacement")
    assert (rows("documents"), rows("chunks")) == before
    assert not db._journal_path.exists()


def test_second_write_failure_rolls_back_both_tables():
    seed()
    before = rows("documents"), rows("chunks")
    bad_document = {**document(text="new"), "unexpected": 7}
    with pytest.raises(db.SchemaMismatchError):
        db.write_document_records(bad_document, chunks(text="new"))
    assert (rows("documents"), rows("chunks")) == before
    assert not db._journal_path.exists()


def test_chunk_schema_failure_returns_server_error_and_preserves_data(monkeypatch):
    seed()
    bad_chunks = [{**chunks()[0], "unexpected": 7}]
    monkeypatch.setattr(ingest_service, "_build_chunk_records", lambda *args: (bad_chunks, False))
    with TestClient(main.app, raise_server_exceptions=False) as client:
        before = rows("documents"), rows("chunks")
        response = client.put("/documents/one", json={"markdown_content": "new"})
    assert response.status_code == 500
    assert (rows("documents"), rows("chunks")) == before


def test_prompt_embedding_does_not_block_document_reads(monkeypatch):
    seed()
    db.append_records(PROMPT_HISTORY_TABLE_NAME, [{"id": "prompt", "vector": [0.1, 0.2, 0.3]}])
    started = Event()
    release = Event()
    def embed(query):
        started.set()
        assert release.wait(3)
        return [0.1, 0.2, 0.3]
    monkeypatch.setattr(prompt_history_service, "_normalized_embedding", embed)
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(prompt_history_service.search_prompt_history, PromptHistorySearchRequest(query="notes"))
        try:
            assert started.wait(1)
            reader = pool.submit(search_service.get_stored_document, "one")
            assert reader.result(timeout=1)["extracted_markdown"] == "old"
        finally:
            release.set()
        pending.result(timeout=2)


def test_reindex_replaces_only_one_document_and_supports_zero_chunks():
    seed()
    db.write_document_records(document(text="new"), chunks(text="new"))
    assert [row["text"] for row in rows("chunks")] == ["new", "old"]
    db.write_document_records({**document(text="empty"), "num_chunks": 0}, [])
    assert [row["doc_id"] for row in rows("chunks")] == ["other"]


def interrupt_commit():
    with db.document_mutation("one"):
        db.lance_db.open_table("chunks").delete("doc_id = 'one'")
        raise KeyboardInterrupt()


def test_restart_recovers_before_maintenance():
    seed()
    before = rows("documents"), rows("chunks")
    with pytest.raises(KeyboardInterrupt):
        interrupt_commit()
    assert db._journal_path.exists()
    with pytest.raises(db.DatabaseRecoveryError):
        db.run_db_maintenance()
    db.recover_database()
    assert (rows("documents"), rows("chunks")) == before
    assert not db._journal_path.exists()


def test_interrupted_first_ingestion_removes_only_its_new_rows():
    with pytest.raises(KeyboardInterrupt):
        with db.document_mutation("one"):
            db.lance_db.create_table("chunks", data=chunks())
            raise KeyboardInterrupt()
    db.recover_database()
    assert rows("chunks") == []


def test_failed_recovery_preserves_journal_and_blocks_access(monkeypatch):
    seed()
    with pytest.raises(KeyboardInterrupt):
        interrupt_commit()
    original = db._journal_path.read_bytes()
    def fail(recovery):
        raise RuntimeError("restore unavailable")
    monkeypatch.setattr(db, "_restore_document", fail)
    with pytest.raises(db.DatabaseRecoveryError):
        db.recover_database()
    assert db._journal_path.read_bytes() == original
    with pytest.raises(db.DatabaseRecoveryError):
        search_service.list_stored_documents()
    with TestClient(main.app, raise_server_exceptions=False) as client:
        assert client.get("/health").status_code == 503
        assert client.get("/documents").status_code == 500


def test_invalid_journal_is_preserved():
    db._journal_path.write_text('{"version":1,"doc_id":"one","versions":{}}', encoding="utf-8")
    with pytest.raises(db.DatabaseRecoveryError):
        db.recover_database()
    assert db._journal_path.exists()


def test_readers_wait_for_commit():
    seed()
    started = Event()
    finished = Event()
    def read():
        started.set()
        result = search_service.get_stored_document("one")
        finished.set()
        return result
    with ThreadPoolExecutor(max_workers=1) as pool:
        with db.document_mutation("one"):
            pending = pool.submit(read)
            assert started.wait(1)
            assert not finished.wait(0.1)
        assert pending.result(timeout=2)["extracted_markdown"] == "old"


def test_delete_failure_rolls_back_and_is_not_reported_as_success(monkeypatch):
    seed()
    before = rows("documents"), rows("chunks")
    # Fail after the journal was captured and the document delete succeeded.
    from lancedb.table import LanceTable
    original_delete = LanceTable.delete
    def fail_delete(table, predicate):
        if table.name == "chunks":
            raise RuntimeError("delete unavailable")
        return original_delete(table, predicate)
    monkeypatch.setattr(LanceTable, "delete", fail_delete)
    with pytest.raises(RuntimeError, match="delete unavailable"):
        search_service.delete_stored_document("one")
    assert (rows("documents"), rows("chunks")) == before


def test_database_failure_differs_from_empty_archive(monkeypatch):
    assert search_service.list_stored_documents() == []
    def fail():
        raise RuntimeError("store unavailable")
    monkeypatch.setattr(main, "get_existing_tables", fail)
    with TestClient(main.app, raise_server_exceptions=False) as client:
        assert client.get("/health").status_code == 503
    with TestClient(main.app, raise_server_exceptions=False) as client:
        with monkeypatch.context() as failure:
            failure.setattr(db.lance_db, "list_tables", fail)
            with pytest.raises(RuntimeError, match="store unavailable"):
                db.get_existing_tables()
            assert client.get("/documents").status_code == 500
            assert client.delete("/documents/one").status_code == 500
