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
    try:
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
    except ImportError:
        # Gracefully test passthrough fallback when PIL is not present
        dummy_bytes = b"non-image-binary-payload"
        assert _prepare_image_for_ocr(dummy_bytes, max_dim=1500) == dummy_bytes

def test_rapid_ocr_extracts_text_from_image():
    """RapidOCR (Tier 1, fast local GPU-capable engine) must actually recognize rendered text."""
    from sidecar.infrastructure.ocr import run_rapid_ocr
    from PIL import Image, ImageDraw
    import io

    img = Image.new("RGB", (400, 100), color="white")
    draw = ImageDraw.Draw(img)
    draw.text((10, 10), "ONLYRAG INVOICE TOTAL 4200", fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    text_out = run_rapid_ocr(buf.getvalue())
    assert "ONLYRAG" in text_out.upper()
    assert "4200" in text_out

def test_run_layout_ocr_prefers_rapidocr_and_skips_vision_fallback(monkeypatch):
    """run_layout_ocr must not fall back to the (slower) Ollama Vision tier when RapidOCR already
    produced usable text -- the vision tier exists for layout-heavy content and RapidOCR failures."""
    from sidecar.infrastructure import ocr as ocr_module

    def fail_if_called(*args, **kwargs):
        raise AssertionError("run_vision_ocr should not be called when RapidOCR succeeds")

    monkeypatch.setattr(ocr_module, "run_vision_ocr", fail_if_called)

    from PIL import Image, ImageDraw
    import io
    img = Image.new("RGB", (400, 100), color="white")
    ImageDraw.Draw(img).text((10, 10), "Fast tier only please", fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    result = ocr_module.run_layout_ocr(buf.getvalue())
    assert "Fast tier only please".lower().split()[0] in result.lower()

def test_ocr_vision_fallback_sets_keep_alive_zero():
    """run_vision_ocr must evict the vision model immediately after use (keep_alive: 0),
    per the documented Ephemeral Eviction policy for OCR support models, to avoid VRAM
    thrashing against the pinned primary model."""
    from sidecar.infrastructure import ocr as ocr_module

    captured_payloads = []

    class FakeResponse:
        status_code = 200
        def json(self):
            return {"response": "Extracted text"}

    class FakeHttpxClient:
        def post(self, url, json=None, timeout=None):
            captured_payloads.append(json)
            return FakeResponse()

    original_client = ocr_module.httpx_client
    ocr_module.httpx_client = FakeHttpxClient()
    try:
        result = ocr_module.run_vision_ocr(b"fake-image-bytes", model="llama3.2-vision")
    finally:
        ocr_module.httpx_client = original_client

    assert result == "Extracted text"
    assert captured_payloads, "Expected at least one call to the Ollama /api/generate endpoint"
    assert captured_payloads[0]["keep_alive"] == 0

def test_extract_pdf_document_native_text_page():
    """extract_pdf_document (shared by the plain and NDJSON-streaming ingestion entry points via
    render_pdf_page_content) must still extract native page text and report the correct page number."""
    import pymupdf
    from sidecar.domain.ingestion import extract_pdf_document

    doc = pymupdf.open()
    try:
        page = doc.new_page(width=595, height=842)
        # Kept above the 40-char OCR_REQUIRED threshold (analyze_pdf_page_structure) so this
        # exercises the native-text path deterministically, without depending on a running
        # OCR/vision backend for the OCR_REQUIRED branch (covered separately, with a mock, below).
        page.insert_text((50, 72), "Hello OnlyRag native text extraction page content", fontsize=12)

        pages = extract_pdf_document(doc)
        assert len(pages) == 1
        page_num, page_text = pages[0]
        assert page_num == 1
        assert "Hello OnlyRag native text extraction page content" in page_text
    finally:
        doc.close()

def test_extract_pdf_document_parallelizes_ocr_pages(monkeypatch):
    """extract_pdf_document must run the OCR rendering phase concurrently (bounded by
    PDF_PAGE_RENDER_CONCURRENCY) instead of one page at a time, and still return pages in the
    correct order despite the underlying work overlapping. Proven by wall clock: 6 pages each with
    a fixed 0.3s OCR delay must finish well under 6*0.3s=1.8s (fully sequential) -- with the default
    concurrency of 3, two overlapped rounds should land near ~0.6s."""
    import time
    import pymupdf
    from sidecar.domain import ingestion as ingestion_module

    def slow_ocr(image_bytes):
        time.sleep(0.3)
        return "OCR page text"
    monkeypatch.setattr(ingestion_module, "run_layout_ocr", slow_ocr)

    doc = pymupdf.open()
    try:
        for _ in range(6):
            doc.new_page(width=200, height=200)  # blank page -> under the 40-char threshold -> OCR_REQUIRED

        start = time.monotonic()
        pages = ingestion_module.extract_pdf_document(doc)
        elapsed = time.monotonic() - start

        assert [p[0] for p in pages] == [1, 2, 3, 4, 5, 6], "Page order must be preserved despite concurrent rendering"
        assert all("OCR page text" in p[1] for p in pages)
        assert elapsed < 1.2, f"Expected concurrent OCR rendering to overlap, but took {elapsed:.2f}s (sequential would be ~1.8s)"
    finally:
        doc.close()

def test_render_pdf_page_content_ocr_path(monkeypatch):
    """render_pdf_page_content must route to run_layout_ocr (rather than raw_text/md_tables)
    when used_ocr=True, matching the OCR_REQUIRED routing decision made by callers."""
    import pymupdf
    from sidecar.domain import ingestion as ingestion_module

    monkeypatch.setattr(ingestion_module, "run_layout_ocr", lambda img_bytes: "OCR-extracted markdown")

    doc = pymupdf.open()
    try:
        page = doc.new_page(width=595, height=842)
        result = ingestion_module.render_pdf_page_content(
            doc, page, page_num=1, raw_text="", md_tables=[], used_ocr=True
        )
        assert "OCR-extracted markdown" in result
    finally:
        doc.close()

def _new_pdf_page_with_embedded_image(doc):
    """Test helper: a page with >=40 chars of native text plus one significant embedded image,
    which analyze_pdf_page_structure classifies as HYBRID_VISION (native text + real image)."""
    from PIL import Image
    import pymupdf
    import io

    page = doc.new_page(width=595, height=842)
    page.insert_text((50, 72), "Report narrative text long enough to skip the OCR threshold", fontsize=10)

    img = Image.new("RGB", (200, 200), color="red")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    page.insert_image(pymupdf.Rect(50, 100, 250, 300), stream=buf.getvalue())
    return page

def test_analyze_pdf_page_structure_classifies_text_plus_image_as_hybrid_vision():
    """Router precondition for the two tests below: a page with native text AND a significant
    embedded image must be classified HYBRID_VISION, not NATIVE_TEXT."""
    import pymupdf
    from sidecar.domain.router import analyze_pdf_page_structure, PageRoutingStrategy

    doc = pymupdf.open()
    try:
        page = _new_pdf_page_with_embedded_image(doc)
        struct_info = analyze_pdf_page_structure(page)
        assert struct_info["strategy"] == PageRoutingStrategy.HYBRID_VISION
    finally:
        doc.close()

def test_render_pdf_page_content_describes_figures_with_vision_when_hybrid(monkeypatch):
    """render_pdf_page_content(describe_figures_with_vision=True) must call the Vision model on
    each significant embedded image and fold its description into the figure caption, so diagram
    content becomes part of the searchable chunk instead of only a resolution placeholder."""
    import pymupdf
    from sidecar.domain import ingestion as ingestion_module

    monkeypatch.setattr(ingestion_module, "run_vision_ocr", lambda image_bytes, prompt="": "Bar chart showing Q1-Q4 revenue growth")

    doc = pymupdf.open()
    try:
        page = _new_pdf_page_with_embedded_image(doc)
        raw_text = page.get_text("text").strip()
        result = ingestion_module.render_pdf_page_content(
            doc, page, page_num=1, raw_text=raw_text, md_tables=[], used_ocr=False,
            describe_figures_with_vision=True
        )
        assert "Report narrative text" in result
        assert "Bar chart showing Q1-Q4 revenue growth" in result
    finally:
        doc.close()

def test_render_pdf_page_content_skips_vision_description_when_not_hybrid(monkeypatch):
    """Without describe_figures_with_vision, figures must stay as the plain placeholder caption --
    the Vision model must not be called at all (avoids the extra latency for ordinary NATIVE_TEXT pages)."""
    import pymupdf
    from sidecar.domain import ingestion as ingestion_module

    def fail_if_called(*args, **kwargs):
        raise AssertionError("run_vision_ocr should not be called when describe_figures_with_vision=False")
    monkeypatch.setattr(ingestion_module, "run_vision_ocr", fail_if_called)

    doc = pymupdf.open()
    try:
        page = _new_pdf_page_with_embedded_image(doc)
        raw_text = page.get_text("text").strip()
        result = ingestion_module.render_pdf_page_content(
            doc, page, page_num=1, raw_text=raw_text, md_tables=[], used_ocr=False,
            describe_figures_with_vision=False
        )
        assert "Figura / Diagramma" in result
    finally:
        doc.close()

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
        assert "[Documento: LargeDoc.md | Sezione:" in c_text


def test_reciprocal_rank_fusion_k60():
    from sidecar.services.search_service import reciprocal_rank_fusion
    dense_ranks = {"chunk_1": 1, "chunk_2": 2, "chunk_3": 3}
    sparse_ranks = {"chunk_2": 1, "chunk_1": 2, "chunk_4": 3}

    rrf = reciprocal_rank_fusion(dense_ranks, sparse_ranks, k=60)

    # chunk_1: 1/(60+1) + 1/(60+2) = 1/61 + 1/62 = 0.016393 + 0.016129 = 0.032522
    # chunk_2: 1/(60+2) + 1/(60+1) = 0.032522
    # chunk_3: 1/(60+3) = 1/63 = 0.015873
    # chunk_4: 1/(60+3) = 1/63 = 0.015873
    assert pytest.approx(rrf["chunk_1"], rel=1e-3) == (1/61 + 1/62)
    assert pytest.approx(rrf["chunk_2"], rel=1e-3) == (1/61 + 1/62)
    assert pytest.approx(rrf["chunk_3"], rel=1e-3) == (1/63)
    assert pytest.approx(rrf["chunk_4"], rel=1e-3) == (1/63)
    assert rrf["chunk_1"] > rrf["chunk_3"]


def test_reranker_cross_scoring():
    from sidecar.infrastructure.reranker import calculate_cross_score, rerank_candidates
    query = "quantum computing error correction"
    relevant_text = "This paper investigates quantum computing error correction algorithms in superconducting qubits."
    irrelevant_text = "The recipe for pasta includes flour, eggs, and a pinch of salt."

    score_rel = calculate_cross_score(query, relevant_text, header="Quantum Physics")
    score_irrel = calculate_cross_score(query, irrelevant_text, header="Cooking")

    assert score_rel > score_irrel
    assert score_rel > 0.5
    assert score_irrel < 0.2

    candidates = [
        {"chunk_id": "c_irr", "text": irrelevant_text, "score": 0.6, "doc_name": "cook.md"},
        {"chunk_id": "c_rel", "text": relevant_text, "score": 0.4, "doc_name": "quantum.md"}
    ]

    reranked = rerank_candidates(query, candidates, top_k=2)
    assert len(reranked) == 2
    assert reranked[0]["chunk_id"] == "c_rel"
    assert reranked[0]["score"] > reranked[1]["score"]


if __name__ == "__main__":
    import inspect
    import sys
    current_module = sys.modules[__name__]
    test_functions = [obj for name, obj in inspect.getmembers(current_module) if inspect.isfunction(obj) and name.startswith("test_")]
    passed = 0
    failed = 0
    print(f"Running {len(test_functions)} sidecar test functions...")
    for fn in test_functions:
        try:
            fn()
            passed += 1
            print(f"  [PASS] {fn.__name__}")
        except Exception as e:
            failed += 1
            print(f"  [FAIL] {fn.__name__}: {e}")
    print(f"\nResult: {passed} passed, {failed} failed.")
    if failed > 0:
        sys.exit(1)


