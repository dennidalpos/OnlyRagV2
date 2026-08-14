import os
import sys
import pytest
from fastapi.testclient import TestClient

# Ensure root workspace directory is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from sidecar.main import app
from sidecar.domain.sanitizer import sanitize_extracted_text
from sidecar.domain.router import classify_file_type, DocumentCategory

client = TestClient(app)

def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert "engine" in data
    assert "version" in data
    assert "vector_db" in data
    assert "documents_count" in data
    assert "chunks_count" in data

def test_text_sanitizer():
    dirty_text = "Hello\x00World\x07!\r\nLine 2\ufeff\n\n\n\n\nLine 3   "
    clean_text = sanitize_extracted_text(dirty_text)
    assert "\x00" not in clean_text
    assert "\x07" not in clean_text
    assert "\ufeff" not in clean_text
    assert "\r" not in clean_text
    assert "HelloWorld!" in clean_text
    assert "Line 2" in clean_text

def test_router_classification():
    assert classify_file_type("document.pdf") == DocumentCategory.PDF
    assert classify_file_type("photo.png") == DocumentCategory.IMAGE
    assert classify_file_type("report.docx") == DocumentCategory.DOCX
    assert classify_file_type("data.csv") == DocumentCategory.TABULAR
    assert classify_file_type("notes.md") == DocumentCategory.TEXT

def test_export_markdown_pdf():
    payload = {
        "markdown_content": "# Unit Test Document\n\nThis is a test document export.",
        "export_format": "pdf"
    }
    response = client.post("/export", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "base64_content" in data
    assert "file_name" in data

def test_export_empty_markdown_raises_400():
    payload = {
        "markdown_content": "   ",
        "export_format": "pdf"
    }
    response = client.post("/export", json=payload)
    assert response.status_code == 400

def test_vector_search_endpoint():
    payload = {
        "query": "test query",
        "top_k": 3
    }
    response = client.post("/vector/search", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)

def test_vector_search_with_doc_ids():
    payload = {
        "query": "architecture overview",
        "top_k": 3,
        "doc_ids": ["doc-123", "doc-456"]
    }
    response = client.post("/vector/search", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)

def test_vector_search_empty_query():
    payload = {
        "query": "   ",
        "top_k": 3
    }
    response = client.post("/vector/search", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data == []

def test_tasks_cancel_endpoint():
    response = client.post("/tasks/cancel?task_id=test-123")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "test-123" in data["message"]

def test_cleanup_temp_endpoint():
    response = client.post("/cleanup/temp")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "cleaned_files" in data

def test_deterministic_fallback_embeddings():
    from sidecar.infrastructure.embeddings import get_fallback_embedding
    vec1 = get_fallback_embedding("Sample query for deterministic test", dim=384)
    vec2 = get_fallback_embedding("Sample query for deterministic test", dim=384)
    assert len(vec1) == 384
    assert len(vec2) == 384
    assert vec1 == vec2  # Exactly reproducible across runs

def test_ocr_prepare_image_resizing():
    from sidecar.infrastructure.ocr import _prepare_image_for_ocr
    from PIL import Image
    import io
    
    # Create large 3000x2000 image
    large_img = Image.new("RGB", (3000, 2000), color="blue")
    buf = io.BytesIO()
    large_img.save(buf, format="PNG")
    raw_bytes = buf.getvalue()
    
    resized_bytes = _prepare_image_for_ocr(raw_bytes, max_dim=1500)
    resized_img = Image.open(io.BytesIO(resized_bytes))
    assert max(resized_img.size) <= 1500

def test_extract_tabular_document_csv_and_json():
    from sidecar.domain.ingestion import extract_tabular_document
    csv_bytes = b"ColA,ColB,ColC\nVal1,Val2,Val3\nVal4,Val5|Pipe,Val6"
    csv_res = extract_tabular_document("data.csv", csv_bytes, None)
    assert len(csv_res) == 1
    assert "| ColA | ColB | ColC |" in csv_res[0][1]
    assert "Val5\\|Pipe" in csv_res[0][1]

    json_bytes = b'{"name": "OnlyRag", "version": 2}'
    json_res = extract_tabular_document("config.json", json_bytes, None)
    assert len(json_res) == 1
    assert "```json" in json_res[0][1]

def test_semantic_chunks_oversized_line_splitting():
    from sidecar.domain.ingestion import create_semantic_chunks
    long_line = "This is a very long text sentence. " * 100  # ~3500 chars
    md = f"# LargeDoc\n\n## Section 1\n\n{long_line}"
    chunks = create_semantic_chunks("LargeDoc.md", md)
    assert len(chunks) > 1
    for idx, c_text, header in chunks:
        assert len(c_text) < 1500
        assert "LargeDoc" in header
