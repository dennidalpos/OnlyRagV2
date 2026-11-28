"""Admission must match the desktop's UTF-16 budget without truncating retained data."""
import base64
import html
import json
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from sidecar.domain import document_limits
from sidecar.domain.document_limits import DocumentSizeError
from sidecar.domain.ingestion import assemble_document_markdown
from sidecar.domain.llm_normalizer import NormalizationReviewRequired
from sidecar.infrastructure import db, source_provenance
from sidecar.schemas import DocumentRecord, ExportRequest, IngestResponse, UpdateDocumentRequest
from sidecar.services import ingest_service, search_service


@pytest.mark.parametrize("kind", ["ASCII", "astral"])
@pytest.mark.parametrize("delta", [-1, 0, 1])
def test_request_and_success_contracts_share_the_real_utf16_boundary(kind, delta):
    units = 10_000_000 + delta
    text = "A" * units if kind == "ASCII" else "😀" * (units // 2) + ("A" if units % 2 else "")
    fields = dict(id="doc", filename="doc.md", file_size=1, num_pages=1, num_chunks=0,
                  status="indexed", ingested_at="t1", file_type="md")
    for schema, values in (
            (UpdateDocumentRequest, dict(markdown_content=text, expected_revision="t1")),
            (ExportRequest, dict(markdown_content=text, export_format="html")),
            (IngestResponse, dict(**fields, extracted_markdown=text))):
        try:
            schema(**values)
            accepted = True
        except ValidationError:
            accepted = False
        assert accepted is (delta <= 0), schema.__name__
    # Reading existing canonical data is deliberately not a new-document admission operation.
    record = DocumentRecord(**fields, file_path="doc.md", used_fallback_embeddings=False, extracted_markdown=text)
    assert len(record.extracted_markdown) == len(text)


def snapshot_tables():
    return {name: db.lance_db.open_table(name).to_arrow().to_pylist() for name in db.get_existing_tables()}


@pytest.mark.parametrize("delta", [-1, 0, 1])
@pytest.mark.parametrize("kind", ["ASCII", "astral"])
def test_native_ingestion_boundaries_include_headings_and_preserve_existing_data(
        tmp_path, monkeypatch, sidecar_http_client, delta, kind):
    # A smaller declared budget exercises full extraction/chunking/storage/export, without giant vector fixtures.
    monkeypatch.setattr(document_limits, "MAX_DOCUMENT_TEXT_UNITS", 128)
    monkeypatch.setattr(source_provenance, "SOURCE_ROOT", tmp_path / "sources")
    old = tmp_path / "existing.md"
    old.write_text("Keep this existing document.", encoding="utf-8")
    old_events = [json.loads(event) for event in ingest_service.process_and_index_document_generator(str(old))]
    assert old_events[-1]["type"] == "done"
    old_id = old_events[-1]["data"]["id"]
    old_archive = source_provenance.SOURCE_ROOT / old_id
    archive_before = {path.name: path.read_bytes() for path in old_archive.iterdir()}
    before = snapshot_tables()
    file = tmp_path / "new.md"
    header_units = len(assemble_document_markdown(file.name, [(1, "")]))
    body_units = 128 + delta - header_units
    body = "A" * body_units if kind == "ASCII" else "😀" * (body_units // 2) + ("A" if body_units % 2 else "")
    file.write_text(body, encoding="utf-8")
    original = file.read_bytes()
    embedding = Mock(wraps=ingest_service.generate_embedding_batch)
    chunks = Mock(wraps=ingest_service.create_semantic_chunks)
    monkeypatch.setattr(ingest_service, "generate_embedding_batch", embedding)
    monkeypatch.setattr(ingest_service, "create_semantic_chunks", chunks)
    events = [json.loads(event) for event in ingest_service.process_and_index_document_generator(str(file))]
    if delta > 0:
        assert events[-1]["type"] == "error"
        assert "UTF-16" in events[-1]["error"]
        assert not any(event.get("type") == "done" or event.get("step_code") == "embedding" for event in events)
        embedding.assert_not_called()
        chunks.assert_not_called()
        assert snapshot_tables() == before
    else:
        assert events[-1]["type"] == "done", events[-1]
        doc_id = events[-1]["data"]["id"]
        expected = assemble_document_markdown(file.name, [(1, body)])
        assert events[-1]["data"]["extracted_markdown"] == expected
        assert sidecar_http_client.get(f"/documents/{doc_id}").json()["extracted_markdown"] == expected
        assert source_provenance._archive(doc_id).raw_markdown == expected
        exported = sidecar_http_client.post("/export", json={"markdown_content": expected, "export_format": "html"})
        assert exported.status_code == 200
        exported_html = base64.b64decode(exported.json()["base64_content"]).decode("utf-8")
        recovered = html.unescape(exported_html.partition("<pre>")[2].partition("</pre>")[0]).replace("\r\n", "\n")
        assert recovered == expected
        embedding.assert_called_once()
        chunks.assert_called_once()
    assert file.read_bytes() == original
    assert {path.name: path.read_bytes() for path in old_archive.iterdir()} == archive_before
    assert search_service.get_stored_document(old_id)["extracted_markdown"] == before["documents"][0]["extracted_markdown"]


def test_oversized_original_archive_is_refused_before_chunking_even_with_small_result(tmp_path, monkeypatch):
    monkeypatch.setattr(document_limits, "MAX_DOCUMENT_TEXT_UNITS", 128)
    monkeypatch.setattr(source_provenance, "SOURCE_ROOT", tmp_path / "sources")
    file = tmp_path / "source.md"
    file.write_bytes(b"Preserve the caller's original.")
    def extract(*args, original_pages, **kwargs):
        original_pages.append((1, "A" * 129))
        return "# Small result", 1
    monkeypatch.setattr(ingest_service, "extract_document_markdown", extract)
    chunk = Mock(side_effect=AssertionError("Admission must run before chunking"))
    monkeypatch.setattr(ingest_service, "create_semantic_chunks", chunk)
    before = snapshot_tables()
    events = [json.loads(event) for event in ingest_service.process_and_index_document_generator(str(file))]
    assert events[-1]["type"] == "error" and "UTF-16" in events[-1]["error"]
    chunk.assert_not_called()
    assert snapshot_tables() == before
    retained = list(source_provenance.SOURCE_ROOT.glob("*/original.md"))
    assert len(retained) == 1 and retained[0].read_bytes() == file.read_bytes()


def test_sanitization_expansion_is_refused_before_reindexing_and_preserves_revision(tmp_path, monkeypatch, sidecar_http_client):
    monkeypatch.setattr(document_limits, "MAX_DOCUMENT_TEXT_UNITS", 128)
    monkeypatch.setattr(source_provenance, "SOURCE_ROOT", tmp_path / "sources")
    file = tmp_path / "original.md"
    file.write_text("Keep this original.", encoding="utf-8")
    events = [json.loads(event) for event in ingest_service.process_and_index_document_generator(str(file))]
    doc_id = events[-1]["data"]["id"]
    revision = events[-1]["data"]["ingested_at"]
    before = snapshot_tables()
    chunk = Mock(side_effect=AssertionError("Expanded text must be refused before chunking"))
    monkeypatch.setattr(ingest_service, "create_semantic_chunks", chunk)
    monkeypatch.setattr(ingest_service, "sanitize_extracted_text", lambda text: "A" * 129)
    with pytest.raises(DocumentSizeError, match="UTF-16"):
        ingest_service.update_and_reindex_document(doc_id, "，" * 70, expected_revision=revision)
    response = sidecar_http_client.put(f"/documents/{doc_id}", json={"markdown_content": "Original input", "expected_revision": revision})
    assert response.status_code == 413
    assert "UTF-16" in response.json()["detail"]
    chunk.assert_not_called()
    assert snapshot_tables() == before


def test_review_refuses_oversized_text_or_issue_count_without_invalid_wire_payload(monkeypatch):
    monkeypatch.setattr(document_limits, "MAX_DOCUMENT_TEXT_UNITS", 128)
    with pytest.raises(DocumentSizeError, match="UTF-16"):
        NormalizationReviewRequired("😀" * 65, [{"page": 1, "reason": "truncated"}])
    with pytest.raises(DocumentSizeError, match="10,000-page"):
        NormalizationReviewRequired("Original", [{"page": 1, "reason": "truncated"}] * 10_001)


def test_oversized_review_stream_is_an_explicit_refusal_without_invalid_payload(tmp_path, monkeypatch):
    monkeypatch.setattr(document_limits, "MAX_DOCUMENT_TEXT_UNITS", 128)
    monkeypatch.setattr(source_provenance, "SOURCE_ROOT", tmp_path / "sources")
    file = tmp_path / "review.md"
    file.write_bytes(b"Preserve the original requiring review.")
    def extract(*args, **kwargs):
        raise NormalizationReviewRequired("😀" * 65, [{"page": 1, "reason": "truncated"}])
    monkeypatch.setattr(ingest_service, "extract_document_markdown", extract)
    chunk = Mock(side_effect=AssertionError("A refused review must not reach chunking"))
    monkeypatch.setattr(ingest_service, "create_semantic_chunks", chunk)
    before = snapshot_tables()
    events = [json.loads(event) for event in ingest_service.process_and_index_document_generator(str(file))]
    assert events[-1]["type"] == "error" and "UTF-16" in events[-1]["error"]
    assert "normalization_review" not in events[-1]
    assert not any(event["type"] == "done" for event in events)
    chunk.assert_not_called()
    assert snapshot_tables() == before
    assert list(source_provenance.SOURCE_ROOT.glob("*/original.md"))[0].read_bytes() == file.read_bytes()
