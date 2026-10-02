"""Real retained files, native stores and authenticated-route location semantics."""
import hashlib
import json

import pymupdf
import pytest

from sidecar.infrastructure import db, source_provenance as source
from sidecar.schemas import SearchRequest
from sidecar.services import ingest_service, search_service


@pytest.fixture(autouse=True)
def source_root(tmp_path, monkeypatch):
    monkeypatch.setattr(source, "SOURCE_ROOT", tmp_path / "retained")


def ingest(path, **kwargs):
    events = [json.loads(event) for event in ingest_service.process_and_index_document_generator(str(path), **kwargs)]
    assert events[-1]["type"] == "done", events[-1]
    return events[-1]["data"]["id"]


def result_for(doc_id):
    results = search_service.perform_vector_search(SearchRequest(query="payment", doc_ids=[doc_id]))
    return next(result for result in results if "21 days" in result.text)


def request_for(result):
    p = result.provenance
    return dict(doc_id=result.doc_id, chunk_id=result.chunk_id, source_revision=p.source_revision,
                extraction_revision=p.extraction_revision, index_revision=p.index_revision,
                span_start=p.span_start, span_end=p.span_end)


def test_original_is_retained_and_unicode_spans_open_after_caller_changes(tmp_path):
    file = tmp_path / "contract.md"
    original = "# Terms\n\n😀 Payment is due within 21 days after delivery."
    file.write_bytes(original.encode("utf-8"))
    doc_id = ingest(file)
    result = result_for(doc_id)
    assert result.provenance.location_kind == "original"
    assert result.provenance.page_number is None
    assert result.provenance.source_revision == hashlib.sha256(original.encode()).hexdigest()
    file.write_text("Different personal source", encoding="utf-8")
    location = source.resolve_source_location(**request_for(result))
    assert location.exact_quote == "😀 Payment is due within 21 days after delivery."
    assert location.span_end - location.span_start == len(location.exact_quote)
    assert location.image_base64 is None
    retained = source.SOURCE_ROOT / doc_id / "original.md"
    assert retained.read_text(encoding="utf-8") == original


def test_late_pdf_page_opens_retained_original_not_derived_preview(tmp_path):
    file = tmp_path / "contract.pdf"
    with pymupdf.open() as pdf:
        pdf.new_page().insert_text((72, 72), "Introduction without the deadline.")
        pdf.new_page().insert_text((72, 72), "Payment is due within 21 days after delivery.")
        pdf.save(file)
    result = result_for(ingest(file))
    assert result.provenance.page_number == 2
    location = source.resolve_source_location(**request_for(result))
    assert location.page_number == 2
    assert location.image_base64.startswith("iVBOR")
    file.unlink()
    assert source.resolve_source_location(**request_for(result)).exact_quote == location.exact_quote


@pytest.mark.parametrize("change", ["edit", "delete", "wrong_document", "bad_revision", "bad_span", "tampered_original"])
def test_stale_invalid_and_deleted_references_fail_closed(tmp_path, change):
    file = tmp_path / "contract.md"
    file.write_text("Payment is due within 21 days after delivery.", encoding="utf-8")
    doc_id = ingest(file)
    request = request_for(result_for(doc_id))
    if change == "edit":
        ingest_service.update_and_reindex_document(doc_id, "Payment is due within 30 days.")
    elif change == "delete":
        db.delete_document_records(doc_id)
    elif change == "wrong_document":
        request["doc_id"] = "other_doc"
    elif change == "bad_revision":
        request["source_revision"] = "a" * 64
    elif change == "bad_span":
        request["span_start"] += 1
    else:
        (source.SOURCE_ROOT / doc_id / "original.md").write_text("tampered", encoding="utf-8")
    with pytest.raises(ValueError):
        source.resolve_source_location(**request)


def test_duplicate_names_have_distinct_identity_and_repeated_text_is_ambiguous(tmp_path):
    left = tmp_path / "left"
    right = tmp_path / "right"
    left.mkdir()
    right.mkdir()
    for folder in (left, right):
        (folder / "contract.md").write_text("Payment is due within 21 days after delivery.", encoding="utf-8")
    a, b = ingest(left / "contract.md"), ingest(right / "contract.md")
    assert a != b
    assert result_for(a).doc_id == a and result_for(b).doc_id == b
    ingest_service.update_and_reindex_document(a, "# A\nPayment is due within 30 days.")
    derived = search_service.perform_vector_search(SearchRequest(query="Payment", doc_ids=[a]))[0]
    assert derived.provenance.location_kind == "derived"
    assert derived.provenance.span_start is None
    repeated = tmp_path / "repeated.md"
    repeated.write_text("# A\nPayment is due within 21 days.\n# B\nPayment is due within 21 days.", encoding="utf-8")
    assert result_for(ingest(repeated)).provenance.location_kind == "derived"


def test_normalized_pdf_keeps_original_extraction_without_fabricating_a_span(tmp_path, monkeypatch):
    file = tmp_path / "contract.pdf"
    with pymupdf.open() as pdf:
        pdf.new_page().insert_text((72, 72), "Payment is due within 21 days.")
        pdf.save(file)
    monkeypatch.setattr("sidecar.domain.ingestion.normalize_page_markdown_with_llm", lambda text, **kwargs: "Payment is due within twenty-one days.")
    doc_id = ingest(file, normalize_with_llm=True)
    result = search_service.perform_vector_search(SearchRequest(query="Payment", doc_ids=[doc_id]))[0]
    assert result.provenance.location_kind == "derived"
    assert "21 days" in source._archive(doc_id).raw_markdown
    assert "twenty-one" in search_service.get_stored_document(doc_id)["extracted_markdown"]


def test_route_revalidates_spans_and_missing_archives_are_not_originals(tmp_path, sidecar_http_client):
    file = tmp_path / "contract.md"
    file.write_text("Payment is due within 21 days after delivery.", encoding="utf-8")
    result = result_for(ingest(file))
    request = request_for(result)
    request.pop("doc_id")
    response = sidecar_http_client.get(f"/documents/{result.doc_id}/source-location", params=request)
    assert response.status_code == 200
    assert response.json()["exact_quote"] == result.provenance.exact_quote
    request["span_end"] += 1
    assert sidecar_http_client.get(f"/documents/{result.doc_id}/source-location", params=request).status_code == 404
    (source.SOURCE_ROOT / result.doc_id / "extraction.json").unlink()
    assert result_for(result.doc_id).provenance is None


def test_root_gate_and_copy_budget_preserve_source(tmp_path, monkeypatch):
    file = tmp_path / "source.md"
    file.write_text("original", encoding="utf-8")
    with pytest.raises(ValueError):
        source.retain_original("../outside", str(file), lambda: None)
    monkeypatch.setattr(source, "MAX_SOURCE_BYTES", 2)
    with pytest.raises(ValueError, match="retention limit"):
        source.retain_original("bounded", str(file), lambda: None)
    assert file.read_text(encoding="utf-8") == "original"


def test_recovery_gate_blocks_source_access(tmp_path):
    db._journal_path.write_text("invalid journal", encoding="utf-8")
    try:
        with pytest.raises(db.DatabaseRecoveryError):
            source.chunk_source_provenance("doc", "text", None)
    finally:
        db._journal_path.unlink()


def test_failed_document_commit_preserves_old_store_and_keeps_archive_inaccessible(tmp_path, monkeypatch):
    file = tmp_path / "old.md"
    file.write_text("Payment is due within 21 days after delivery.", encoding="utf-8")
    old_id = ingest(file)
    old_rows = db.lance_db.open_table("documents").to_arrow().to_pylist()
    old_chunks = db.lance_db.open_table("chunks").to_arrow().to_pylist()
    append = db.append_records
    def fail_document(table_name, records, **kwargs):
        if table_name == "documents":
            raise RuntimeError("Injected commit failure")
        return append(table_name, records, **kwargs)
    monkeypatch.setattr(db, "append_records", fail_document)
    events = [json.loads(event) for event in ingest_service.process_and_index_document_generator(str(file))]
    assert events[-1]["type"] == "error"
    assert db.lance_db.open_table("documents").to_arrow().to_pylist() == old_rows
    assert db.lance_db.open_table("chunks").to_arrow().to_pylist() == old_chunks
    assert not db._journal_path.exists()
    archived = [folder.name for folder in source.SOURCE_ROOT.iterdir() if folder.name != old_id]
    assert len(archived) == 1
    assert source.chunk_source_provenance(archived[0], "text", None) is None
    assert source.resolve_source_location(**request_for(result_for(old_id))).exact_quote == "Payment is due within 21 days after delivery."
