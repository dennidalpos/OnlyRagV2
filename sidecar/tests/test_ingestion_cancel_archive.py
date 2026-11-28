import json

import pytest

from sidecar.infrastructure import db, source_provenance as source
from sidecar.services import ingest_service as ingest, search_service
from sidecar.services.task_cancellation import TaskCancelled, cancel_task


@pytest.mark.parametrize("phase", ["copy", "extraction", "indexing", "committed"])
def test_cancel_removes_only_owned_archive_after_rollback(tmp_path, monkeypatch, phase):
    root = tmp_path / "archives"
    monkeypatch.setattr(source, "SOURCE_ROOT", root)
    previous_source = tmp_path / "previous.txt"
    previous_source.write_bytes(b"preserve previous archive")
    seeded = [json.loads(line) for line in ingest.process_and_index_document_generator(str(previous_source))]
    assert seeded[-1]["type"] == "done"
    previous = root / seeded[-1]["data"]["id"]
    before_documents = search_service.list_stored_documents()
    before_chunks = db.lance_db.open_table("chunks").search().limit(None).to_list()
    original = tmp_path / "private.txt"
    original.write_bytes(b"Confidential original document for the cancellation test.")
    if phase == "copy":
        original.write_bytes(b"private" * 200_000)
        check = ingest.raise_if_cancelled
        def cancel_during_copy(task_id):
            if any(path != previous / "original.txt" and path.stat().st_size > 0 for path in root.glob("*/original.txt")):
                cancel_task(task_id)
            check(task_id)
        monkeypatch.setattr(ingest, "raise_if_cancelled", cancel_during_copy)
    elif phase == "extraction":
        def cancel_extraction(*args, **kwargs):
            raise TaskCancelled()
        monkeypatch.setattr(ingest, "extract_document_markdown", cancel_extraction)
    elif phase == "indexing":
        def cancel_index(*args, **kwargs):
            raise TaskCancelled()
        monkeypatch.setattr(ingest, "_build_chunk_records", cancel_index)
    else:
        write = ingest.write_document_records
        def cancel_after_commit(*args, **kwargs):
            write(*args, **kwargs)
            cancel_task("cancel-fixture")
        monkeypatch.setattr(ingest, "write_document_records", cancel_after_commit)
    before = original.read_bytes()
    events = [json.loads(line) for line in ingest.process_and_index_document_generator(str(original), task_id="cancel-fixture")]
    assert events[-1]["type"] == "cancelled"
    assert list(root.iterdir()) == [previous]
    assert original.read_bytes() == before
    assert (previous / "original.txt").read_bytes() == b"preserve previous archive"
    assert search_service.list_stored_documents() == before_documents
    assert db.lance_db.open_table("chunks").search().limit(None).to_list() == before_chunks
    assert not db._journal_path.exists()


@pytest.mark.parametrize("failure", ["rollback", "archive"])
def test_failed_cancel_cleanup_is_an_error_and_preserves_archive(tmp_path, monkeypatch, failure):
    root = tmp_path / "archives"
    monkeypatch.setattr(source, "SOURCE_ROOT", root)
    original = tmp_path / "private.txt"
    original.write_text("Preserve this original", encoding="utf-8")
    def cancel(*args, **kwargs):
        raise TaskCancelled()
    monkeypatch.setattr(ingest, "extract_document_markdown", cancel)
    def refuse(*args, **kwargs):
        raise RuntimeError("cleanup unavailable")
    if failure == "rollback":
        monkeypatch.setattr(ingest, "delete_document_records", refuse)
    else:
        monkeypatch.setattr(source, "remove_owned_archive", refuse, raising=False)
    events = [json.loads(line) for line in ingest.process_and_index_document_generator(str(original), task_id="cancel-failure")]
    assert events[-1]["type"] == "error"
    assert "cleanup" in events[-1]["error"].lower()
    assert list(root.glob("*/original.txt"))
    assert original.read_text(encoding="utf-8") == "Preserve this original"


def test_archive_creation_failure_does_not_claim_an_existing_archive(tmp_path, monkeypatch):
    root = tmp_path / "archives"
    monkeypatch.setattr(source, "SOURCE_ROOT", root)
    previous = root / "existing"
    previous.mkdir(parents=True)
    retained = previous / "original.txt"
    retained.write_bytes(b"previous retained content")
    monkeypatch.setattr(ingest.uuid, "uuid4", lambda: "existing")
    original = tmp_path / "new.txt"
    original.write_bytes(b"new input")
    events = [json.loads(line) for line in ingest.process_and_index_document_generator(str(original))]
    assert events[-1]["type"] == "error"
    assert retained.read_bytes() == b"previous retained content"


def test_failed_database_rollback_keeps_journal_and_original_archive(tmp_path, monkeypatch):
    from lancedb.table import LanceTable
    root = tmp_path / "archives"
    monkeypatch.setattr(source, "SOURCE_ROOT", root)
    monkeypatch.setattr(db, "_journal_path", tmp_path / "recovery.json")
    original = tmp_path / "private.txt"
    original.write_text("Original that must survive a failed rollback", encoding="utf-8")
    write = ingest.write_document_records
    def cancel_after_commit(*args, **kwargs):
        write(*args, **kwargs)
        cancel_task("rollback-failure")
    monkeypatch.setattr(ingest, "write_document_records", cancel_after_commit)
    delete = LanceTable.delete
    def fail_delete(table, predicate):
        if table.name == "chunks":
            raise RuntimeError("deletion unavailable")
        return delete(table, predicate)
    monkeypatch.setattr(LanceTable, "delete", fail_delete)
    def fail_restore(*args):
        raise RuntimeError("rollback unavailable")
    monkeypatch.setattr(db, "_restore_document", fail_restore)
    try:
        events = [json.loads(line) for line in ingest.process_and_index_document_generator(str(original), task_id="rollback-failure")]
        assert events[-1]["type"] == "error"
        assert db._journal_path.exists()
        assert list(root.glob("*/original.txt"))
        with pytest.raises(db.DatabaseRecoveryError):
            search_service.list_stored_documents()
    finally:
        db._recovery_error = None
        db._journal_path.unlink(missing_ok=True)
