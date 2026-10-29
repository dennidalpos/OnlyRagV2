"""Coordinate real LanceDB operations with paused encoders; no model requests."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi.testclient import TestClient

from sidecar import main
from sidecar.infrastructure import db
from sidecar.schemas import SearchRequest
from sidecar.services import ingest_service, search_service


@pytest.fixture
def document(tmp_path):
    source = tmp_path / "notes.txt"
    source.write_text("The original audit document contains evidence.", encoding="utf-8")
    import json
    events = [json.loads(line) for line in ingest_service.process_and_index_document_generator(str(source))]
    assert events[-1]["type"] == "done"
    return events[-1]["data"]["id"]


def test_paused_update_cannot_resurrect_deleted_document(document, monkeypatch):
    entered, release = Event(), Event()
    build = ingest_service._build_chunk_records
    def paused(*args):
        entered.set()
        assert release.wait(5)
        return build(*args)
    monkeypatch.setattr(ingest_service, "_build_chunk_records", paused)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(ingest_service.update_and_reindex_document, document, "Stale edit", search_service.get_stored_document(document)["ingested_at"])
        try:
            assert entered.wait(2)
            search_service.delete_stored_document(document)
            assert search_service.get_stored_document(document) is None
        finally:
            release.set()
        with pytest.raises(ValueError, match="not found"):
            future.result(timeout=3)
    assert search_service.get_stored_document(document) is None
    assert db.lance_db.open_table("chunks").count_rows() == 0
    assert not db._journal_path.exists()


def test_competing_update_returns_http_conflict_without_losing_winner(document, monkeypatch):
    entered, release = Event(), Event()
    build = ingest_service._build_chunk_records
    def paused(raw_chunks, *args):
        if any("Stale edit" in text for _, text, _ in raw_chunks):
            entered.set()
            assert release.wait(5)
        return build(raw_chunks, *args)
    monkeypatch.setattr(ingest_service, "_build_chunk_records", paused)
    with TestClient(main.app) as client, ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(client.put, f"/documents/{document}", json={"markdown_content": "Stale edit", "expected_revision": search_service.get_stored_document(document)["ingested_at"]})
        try:
            assert entered.wait(2)
            ingest_service.update_and_reindex_document(document, "Winning revision", expected_revision=search_service.get_stored_document(document)["ingested_at"])
        finally:
            release.set()
        response = future.result(timeout=3)
    assert response.status_code == 409
    assert "changed" in response.json()["detail"].lower()
    assert search_service.get_stored_document(document)["extracted_markdown"] == "Winning revision"
    rows = db.lance_db.open_table("chunks").search().limit(None).to_list()
    assert rows and all("Winning revision" in row["text"] for row in rows)
    assert not db._journal_path.exists()


@pytest.mark.parametrize("change", ["none", "update", "delete", "provenance", "recovery"])
def test_search_encoding_releases_lock_and_rechecks_snapshot(document, monkeypatch, change):
    entered, release = Event(), Event()
    encode = search_service.generate_embedding_batch
    def paused(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return encode(*args, **kwargs)
    monkeypatch.setattr(search_service, "generate_embedding_batch", paused)
    with ThreadPoolExecutor(max_workers=3) as pool:
        future = pool.submit(search_service.perform_vector_search, SearchRequest(query="evidence"))
        try:
            assert entered.wait(2)
            assert pool.submit(search_service.list_stored_documents).result(timeout=1)
            assert pool.submit(main.health_check).result(timeout=1)["status"] == "online"
            if change == "update":
                ingest_service.update_and_reindex_document(document, "Changed index", expected_revision=search_service.get_stored_document(document)["ingested_at"])
            elif change == "delete":
                search_service.delete_stored_document(document)
            elif change == "provenance":
                db.lance_db.open_table("chunks").update(values={"embedding_model_digest": "b" * 64})
            elif change == "recovery":
                db._journal_path.write_text("{}", encoding="utf-8")
        finally:
            release.set()
        try:
            if change == "none":
                assert future.result(timeout=3)
            else:
                with pytest.raises(RuntimeError, match="changed|recovery"):
                    future.result(timeout=3)
        finally:
            if change == "recovery":
                db._journal_path.unlink(missing_ok=True)


def test_search_snapshot_conflict_has_explicit_http_status(document, monkeypatch):
    encode = search_service.generate_embedding_batch
    def change_index(*args, **kwargs):
        ingest_service.update_and_reindex_document(document, "Concurrent update", expected_revision=search_service.get_stored_document(document)["ingested_at"])
        return encode(*args, **kwargs)
    monkeypatch.setattr(search_service, "generate_embedding_batch", change_index)
    with TestClient(main.app) as client:
        response = client.post("/vector/search", json={"query": "evidence"})
    assert response.status_code == 409
    assert "changed" in response.json()["detail"].lower()


def test_stale_client_revision_is_rejected_before_encoding(document, monkeypatch):
    revision = search_service.get_stored_document(document)["ingested_at"]
    ingest_service.update_and_reindex_document(document, "Confirmed winning content", revision)
    before_doc = search_service.get_stored_document(document)
    before_chunks = db.lance_db.open_table("chunks").to_arrow().to_pylist()
    def forbidden(*_args, **_kwargs):
        pytest.fail("Stale client must be rejected before encoding")
    monkeypatch.setattr(ingest_service, "_build_chunk_records", forbidden)
    with TestClient(main.app) as client:
        response = client.put(f"/documents/{document}", json={"markdown_content": "Stale client content", "expected_revision": revision})
        missing = client.put(f"/documents/{document}", json={"markdown_content": "Legacy request"})
    assert response.status_code == 409
    assert missing.status_code == 422
    assert search_service.get_stored_document(document) == before_doc
    assert db.lance_db.open_table("chunks").to_arrow().to_pylist() == before_chunks
    assert not db._journal_path.exists()
