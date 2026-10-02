import os

import pymupdf
import pytest

from sidecar.domain import llm_normalizer, ingestion
from sidecar.domain.llm_normalizer import NormalizationReviewRequired
from _normalization_fixture import normalization_server
from _stream import read_events, done_payload


@pytest.fixture
def normalization_ollama(monkeypatch):
    url = os.environ.get("ONLYRAG_TEST_OLLAMA_URL")
    if url:
        monkeypatch.setattr(llm_normalizer, "OLLAMA_BASE_URL", url)
        yield []
    else:
        with normalization_server() as (url, requests):
            monkeypatch.setattr(llm_normalizer, "OLLAMA_BASE_URL", url)
            yield requests


def write_pdf(tmp_path, pages):
    path = tmp_path / "normalization.pdf"
    with pymupdf.open() as doc:
        for text in pages:
            doc.new_page().insert_text((72, 72), text, fontsize=10)
        doc.save(path)
    return path


@pytest.mark.parametrize("model,reason", [
    ("normalizer-truncated", "truncated"),
    ("normalizer-entities", "entities_changed"),
    ("normalizer-omission", "content_changed"),
    ("normalizer-empty", "empty_response"),
    ("normalizer-incomplete", "incomplete_response"),
])
def test_normalization_stream_rejection_retains_the_original(
    sidecar_http_client, normalization_ollama, tmp_path, model, reason,
):
    source = "Reference AB123 remains valid. Payment is not due without a signature."
    path = write_pdf(tmp_path, [source])
    original = path.read_bytes()
    before = sidecar_http_client.get("/health").json()
    events = read_events(sidecar_http_client.post("/ingest-path-stream", json={
        "file_path": str(path), "normalize_with_llm": True, "normalization_model": model,
    }))
    assert events[-1]["type"] == "error"
    assert events[-1]["normalization_review"] == {
        "original_markdown": f"# {path.name}\n\n## Page 1\n\n{source}",
        "issues": [{"page": 1, "reason": reason}],
    }
    assert not any(event["type"] == "done" for event in events)
    assert not any(event.get("step_code") == "embedding" for event in events)
    after = sidecar_http_client.get("/health").json()
    assert (after["documents_count"], after["chunks_count"]) == (before["documents_count"], before["chunks_count"])
    assert path.read_bytes() == original


def test_normalization_stream_review_includes_all_original_pages(
    sidecar_http_client, normalization_ollama, tmp_path,
):
    pages = [
        "The first original clause needs a signature and must remain unchanged.",
        "Reference AB123 is valid. Payment is not due without a signature.",
        "The final original clause requires consent before delivery.",
    ]
    path = write_pdf(tmp_path, pages)
    original = path.read_bytes()
    events = read_events(sidecar_http_client.post("/ingest-path-stream", json={
        "file_path": str(path), "normalize_with_llm": True,
        "normalization_model": "normalizer-last-page", "normalization_think": True,
    }))
    assert events[-1]["type"] == "error"
    review = events[-1]["normalization_review"]
    assert review["issues"] == [{"page": 2, "reason": "entities_changed"}]
    expected = f"# {path.name}\n\n" + "\n\n".join(f"## Page {i+1}\n\n{text}" for i, text in enumerate(pages))
    assert review["original_markdown"] == expected
    assert path.read_bytes() == original
    if normalization_ollama:
        assert len(normalization_ollama) == 3
        assert all(request["think"] is True for request in normalization_ollama)


def test_normalization_stream_valid_cleanup_indexes(sidecar_http_client, normalization_ollama, tmp_path):
    source = "Reference AB123 requires a signature before payment."
    path = write_pdf(tmp_path, [source])
    original = path.read_bytes()
    payload = done_payload(sidecar_http_client.post("/ingest-path-stream", json={
        "file_path": str(path), "normalize_with_llm": True, "normalization_model": "normalizer-cleanup",
    }))
    assert f"# {source}" in payload["extracted_markdown"]
    assert payload["num_chunks"] > 0
    assert sidecar_http_client.delete(f"/documents/{payload['id']}").status_code == 200
    assert path.read_bytes() == original


def test_pdf_extractor_preserves_every_page_on_review(normalization_ollama, tmp_path):
    path = write_pdf(tmp_path, [
        "The original first clause requires explicit consent for delivery.",
        "Reference AB123 requires consent and must remain unchanged.",
    ])
    with pytest.raises(NormalizationReviewRequired) as rejected:
        ingestion.extract_document_markdown(
            path.name, b"", str(path), normalize_with_llm=True, normalization_model="normalizer-last-page",
        )
    assert "## Page 1\n\nThe original first clause" in rejected.value.original_markdown
    assert "## Page 2\n\nReference AB123" in rejected.value.original_markdown
    assert rejected.value.issues == [{"page": 2, "reason": "entities_changed"}]


def test_image_extractor_retains_original_on_review(monkeypatch):
    source = "Reference AB123 requires a signature and must remain unchanged."
    monkeypatch.setattr(ingestion, "run_page_ocr", lambda *_args, **_kwargs: source)
    def reject(*_args, **_kwargs):
        raise NormalizationReviewRequired(source, [{"page": 1, "reason": "truncated"}])
    monkeypatch.setattr(ingestion, "normalize_page_markdown_with_llm", reject)
    with pytest.raises(NormalizationReviewRequired) as rejected:
        ingestion.extract_document_markdown("source.png", b"fixture", normalize_with_llm=True, normalization_model="fixture")
    assert rejected.value.original_markdown == f"# source.png\n\n## Page 1\n\n{source}"
