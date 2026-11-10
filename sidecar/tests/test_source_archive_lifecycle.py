"""Whole source-archive lifecycle on native isolated storage; no real model calls."""
import hashlib
import json
import os
import subprocess

from fastapi.testclient import TestClient
import pytest

from sidecar import main
from sidecar.config import SIDECAR_AUTH_TOKEN
from sidecar.infrastructure import db, source_provenance as source
from sidecar.infrastructure.store_control import StoreControlError
from sidecar.schemas import SearchRequest
from sidecar.services import ingest_service, search_service
from sidecar.services.task_cancellation import TaskCancelled


@pytest.fixture(autouse=True)
def isolated_archives(tmp_path, monkeypatch):
    monkeypatch.setattr(source, "SOURCE_ROOT", tmp_path / "archives")


def file_bytes(directory):
    return {str(path.relative_to(directory)): path.read_bytes() for path in directory.rglob("*") if path.is_file()}


def rows():
    return {name: sorted(db.lance_db.open_table(name).to_arrow().to_pylist(),
                         key=lambda row: row.get("id", row.get("chunk_id", "")))
            for name in db.get_existing_tables()}


def ingest(path):
    events = [json.loads(event) for event in ingest_service.process_and_index_document_generator(str(path))]
    assert events[-1]["type"] == "done", events[-1]
    return events[-1]["data"]["id"]


def reference(doc_id):
    result = search_service.perform_vector_search(SearchRequest(query="Payment", doc_ids=[doc_id]))[0]
    provenance = result.provenance
    assert provenance.location_kind == "original"
    return dict(chunk_id=result.chunk_id, source_revision=provenance.source_revision,
                extraction_revision=provenance.extraction_revision, index_revision=provenance.index_revision,
                span_start=provenance.span_start, span_end=provenance.span_end)


def seed(tmp_path):
    original = tmp_path / "survivor.md"
    original.write_bytes(b"Payment is due within 45 days after delivery.")
    identifier = ingest(original)
    return original, identifier, reference(identifier)


def test_http_create_revise_delete_retains_originals_and_surviving_citations(tmp_path):
    original_b, b, request_b = seed(tmp_path)
    caller = tmp_path / "caller"
    caller.mkdir()
    original_a = caller / "survivor.md"  # Same display name must not confer ownership.
    original_a.write_bytes(b"Payment is due within 21 days after delivery.")
    a = ingest(original_a)
    assert a != b
    request_a = reference(a)
    archives_before, rows_before = file_bytes(source.SOURCE_ROOT), rows()
    callers_before = {path: path.read_bytes() for path in (original_a, original_b)}
    assert request_a["source_revision"] == hashlib.sha256(callers_before[original_a]).hexdigest()
    assert request_b["source_revision"] == hashlib.sha256(callers_before[original_b]).hexdigest()
    assert (source.SOURCE_ROOT / a / "original.md").read_bytes() == callers_before[original_a]
    assert (source.SOURCE_ROOT / b / "original.md").read_bytes() == callers_before[original_b]

    with TestClient(main.app, headers={"X-OnlyRag-Token": SIDECAR_AUTH_TOKEN}) as client:
        location_b = client.get(f"/documents/{b}/source-location", params=request_b)
        assert location_b.status_code == 200
        assert client.get(f"/documents/{a}/source-location", params=request_a).status_code == 200
        revision = search_service.get_stored_document(a)["ingested_at"]
        updated = client.put(f"/documents/{a}", json={
            "markdown_content": "Payment is due within 30 days after delivery.", "expected_revision": revision,
        })
        assert updated.status_code == 200, updated.text
        assert updated.json()["extracted_markdown"] == "Payment is due within 30 days after delivery."
        assert updated.json()["ingested_at"] != revision
        assert client.get(f"/documents/{a}/source-location", params=request_a).status_code == 404
        changed = search_service.perform_vector_search(SearchRequest(query="Payment", doc_ids=[a]))[0]
        assert changed.provenance.location_kind == "derived"
        assert changed.provenance.span_start is None
        assert file_bytes(source.SOURCE_ROOT) == archives_before

        for _ in range(2):
            assert client.delete(f"/documents/{a}").status_code == 200
            assert client.get(f"/documents/{a}").status_code == 404
            assert client.get(f"/documents/{a}/source-location", params=request_a).status_code == 404
            assert search_service.perform_vector_search(SearchRequest(query="Payment", doc_ids=[a])) == []
            assert client.get(f"/documents/{b}/source-location", params=request_b).json() == location_b.json()
            assert file_bytes(source.SOURCE_ROOT) == archives_before
        after = rows()
        for table, column in (("documents", "id"), ("chunks", "doc_id")):
            assert after[table] == [row for row in rows_before[table] if row[column] == b]
        assert {path: path.read_bytes() for path in callers_before} == callers_before
        # Deletion is index removal. The retained archive is not an active/navigable source.
        assert source._archive(a) is not None
        assert source.chunk_source_provenance(a, "Payment is due within 21 days after delivery.", None) is None
        assert not db._journal_path.exists()


def test_failed_ingestion_is_retained_while_cancel_removes_only_its_owned_archive(tmp_path, monkeypatch):
    original, survivor, request = seed(tmp_path)
    before_rows, survivor_before = rows(), file_bytes(source.SOURCE_ROOT)
    failed = tmp_path / "failed.md"
    failed.write_bytes(b"Preserve the original from the failed ingestion.")
    with monkeypatch.context() as patch:
        def refuse(*args, **kwargs):
            raise ValueError("Declared extraction failure")
        patch.setattr(ingest_service, "extract_document_markdown", refuse)
        events = [json.loads(event) for event in ingest_service.process_and_index_document_generator(str(failed))]
    assert events[-1]["type"] == "error"
    orphan = next(directory for directory in source.SOURCE_ROOT.iterdir() if directory.name != survivor)
    assert (orphan / "original.md").read_bytes() == failed.read_bytes()
    assert source._archive(orphan.name) is None
    assert source.chunk_source_provenance(orphan.name, "anything", None) is None
    assert rows() == before_rows
    retained_before_cancel = file_bytes(source.SOURCE_ROOT)
    cancelled = tmp_path / "cancelled.md"
    cancelled.write_bytes(b"Cancel only this new owned archive.")
    with monkeypatch.context() as patch:
        def cancel(*args, **kwargs):
            raise TaskCancelled()
        patch.setattr(ingest_service, "extract_document_markdown", cancel)
        events = [json.loads(event) for event in ingest_service.process_and_index_document_generator(
            str(cancelled), task_id="archive-lifecycle-cancel")]
    assert events[-1]["type"] == "cancelled"
    assert file_bytes(source.SOURCE_ROOT) == retained_before_cancel
    assert rows() == before_rows
    for relative, content in survivor_before.items():
        assert file_bytes(source.SOURCE_ROOT)[relative] == content
    assert source.resolve_source_location(doc_id=survivor, **request).exact_quote == original.read_text(encoding="utf-8")
    assert cancelled.read_bytes() == b"Cancel only this new owned archive."
    assert failed.read_bytes() == b"Preserve the original from the failed ingestion."
    assert not db._journal_path.exists()


def owned_archive(tmp_path):
    original, survivor, request = seed(tmp_path)
    claims = []
    retained, revision = source.retain_original("owned", str(original), lambda: None, claims.append)
    source.save_extraction("owned", retained, revision, original.name, [(1, "Temporary extraction")], False)
    owned = source.SOURCE_ROOT / "owned"
    assert claims == [owned]
    (owned / "extraction.tmp").write_bytes(b"Owned interrupted staging")
    return original, survivor, request, owned


def test_owned_cleanup_removes_only_new_archive_and_is_idempotent(tmp_path):
    original, survivor, request, owned = owned_archive(tmp_path)
    before_rows = rows()
    survivor_before = file_bytes(source.SOURCE_ROOT / survivor)
    source.remove_owned_archive("owned", owned)
    source.remove_owned_archive("owned", owned)
    assert not owned.exists()
    assert file_bytes(source.SOURCE_ROOT / survivor) == survivor_before
    assert rows() == before_rows
    assert source.resolve_source_location(doc_id=survivor, **request).exact_quote == original.read_text(encoding="utf-8")


@pytest.mark.parametrize("refusal", ["ownership", "traversal"])
def test_cleanup_refuses_wrong_owner_and_traversal_without_touching_files(tmp_path, refusal):
    _, _, _, owned = owned_archive(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "original.md").write_bytes(b"Outside the owned archive")
    before, before_rows = file_bytes(tmp_path), rows()
    with pytest.raises(ValueError, match="ownership mismatch|Invalid document ID"):
        source.remove_owned_archive("owned" if refusal == "ownership" else "../outside", outside)
    assert file_bytes(tmp_path) == before
    assert owned.exists()
    assert rows() == before_rows


@pytest.mark.parametrize("artifact", ["file", "directory"])
def test_unexpected_artifact_refuses_all_cleanup_before_any_unlink(tmp_path, artifact):
    _, _, _, owned = owned_archive(tmp_path)
    if artifact == "file":
        (owned / "user-evidence.bin").write_bytes(b"Protected unexpected evidence")
    else:
        nested = owned / "nested"
        nested.mkdir()
        (nested / "original.md").write_bytes(b"Unexpected nested original")
    before, before_rows = file_bytes(tmp_path), rows()
    with pytest.raises(ValueError, match="Unexpected source cleanup artifact"):
        source.remove_owned_archive("owned", owned)
    assert file_bytes(tmp_path) == before
    assert rows() == before_rows


@pytest.mark.skipif(os.name != "nt", reason="Native Windows junction fixture")
@pytest.mark.parametrize("boundary", ["archive", "entry"])
def test_cleanup_refuses_native_junctions_without_touching_their_targets(tmp_path, boundary):
    original, survivor, request, owned = owned_archive(tmp_path)
    outside = tmp_path / "outside"
    if boundary == "archive":
        owned.rename(outside)
        link = owned
    else:
        outside.mkdir()
        (outside / "original.md").write_bytes(b"Outside protected evidence")
        link = owned / "original.escape"
    outside_before, survivor_before, before_rows = file_bytes(outside), file_bytes(source.SOURCE_ROOT / survivor), rows()
    owned_before = file_bytes(owned) if boundary == "entry" else None
    subprocess.run(
        ["pwsh", "-NoProfile", "-NonInteractive", "-Command",
         "New-Item -ItemType Junction -Path $env:ONLYRAG_TEST_JUNCTION_LINK "
         "-Target $env:ONLYRAG_TEST_JUNCTION_TARGET -ErrorAction Stop | Out-Null"],
        env={**os.environ, "ONLYRAG_TEST_JUNCTION_LINK": str(link), "ONLYRAG_TEST_JUNCTION_TARGET": str(outside)},
        check=True, capture_output=True, timeout=15,
    )
    try:
        assert link.is_junction() and link.resolve() == outside.resolve()
        with pytest.raises(StoreControlError, match="Linked store artifacts"):
            source.remove_owned_archive("owned", owned)
    finally:
        if link.is_junction():
            link.rmdir()  # Remove the fixture link only, never its target.
    assert file_bytes(outside) == outside_before
    if owned_before is not None:
        assert file_bytes(owned) == owned_before
    assert file_bytes(source.SOURCE_ROOT / survivor) == survivor_before
    assert rows() == before_rows
    assert source.resolve_source_location(doc_id=survivor, **request).exact_quote == original.read_text(encoding="utf-8")
