import os
import sys
import docx
import pymupdf
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from sidecar.main import app
from sidecar.domain import translator as translator_module

client = TestClient(app)


def _make_pdf(path: str, text: str = "SUPERSECRETMARKER12345") -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_textbox(pymupdf.Rect(40, 40, 400, 80), text, fontsize=14, fontname="helv", color=(0, 0, 0))
    doc.save(path)
    doc.close()


def _make_docx(path: str) -> None:
    doc = docx.Document()
    doc.add_heading("Test Document", level=1)
    p = doc.add_paragraph()
    run = p.add_run("Hello world")
    run.bold = True
    doc.add_paragraph("Second paragraph text")

    table = doc.add_table(rows=1, cols=2)
    table.rows[0].cells[0].text = "Cell one"
    table.rows[0].cells[1].text = "Cell two"

    doc.save(path)


def test_collect_docx_runs_covers_paragraphs_and_tables(tmp_path):
    path = str(tmp_path / "sample.docx")
    _make_docx(path)
    doc = docx.Document(path)

    runs = translator_module._collect_docx_runs(doc)
    texts = [r.text for r in runs]

    assert "Test Document" in texts
    assert "Hello world" in texts
    assert "Second paragraph text" in texts
    assert "Cell one" in texts
    assert "Cell two" in texts


def test_batch_runs_respects_max_chars(tmp_path):
    path = str(tmp_path / "sample.docx")
    _make_docx(path)
    doc = docx.Document(path)
    runs = translator_module._collect_docx_runs(doc)

    batches = translator_module._batch_runs(runs, max_chars=15)
    assert len(batches) > 1
    # Every run must appear in exactly one batch, in original order.
    flattened = [r for batch in batches for r in batch]
    assert flattened == runs


def test_translate_batch_happy_path_reassigns_run_text(tmp_path, monkeypatch):
    path = str(tmp_path / "sample.docx")
    _make_docx(path)
    doc = docx.Document(path)
    runs = translator_module._collect_docx_runs(doc)[:2]  # "Test Document", "Hello world"

    def fake_call(text, source_lang, target_lang, model):
        assert translator_module._RUN_SEPARATOR in text
        parts = text.split(f"\n{translator_module._RUN_SEPARATOR}\n")
        return f"\n{translator_module._RUN_SEPARATOR}\n".join(f"[{p}]" for p in parts)

    monkeypatch.setattr(translator_module, "_call_ollama_translate", fake_call)
    translator_module._translate_batch(runs, "English", "Italian", "llama3.2")

    assert runs[0].text == "[Test Document]"
    assert runs[1].text == "[Hello world]"


def test_translate_batch_falls_back_on_segment_mismatch(tmp_path, monkeypatch):
    path = str(tmp_path / "sample.docx")
    _make_docx(path)
    doc = docx.Document(path)
    runs = translator_module._collect_docx_runs(doc)[:2]
    original_texts = [r.text for r in runs]

    call_log = []

    def fake_call(text, source_lang, target_lang, model):
        call_log.append(text)
        if translator_module._RUN_SEPARATOR in text:
            return "only one segment back"  # wrong count on purpose
        return f"TR:{text}"

    monkeypatch.setattr(translator_module, "_call_ollama_translate", fake_call)
    translator_module._translate_batch(runs, "English", "Italian", "llama3.2")

    # Fallback path: one batch call + one per-run call each.
    assert len(call_log) == 1 + len(runs)
    for run, original in zip(runs, original_texts):
        assert run.text == f"TR:{original}"


def test_translate_docx_inplace_end_to_end(tmp_path, monkeypatch):
    path = str(tmp_path / "e2e_sample.docx")
    _make_docx(path)

    def fake_call(text, source_lang, target_lang, model):
        if translator_module._RUN_SEPARATOR in text:
            parts = text.split(f"\n{translator_module._RUN_SEPARATOR}\n")
            return f"\n{translator_module._RUN_SEPARATOR}\n".join(f"TR-{p}" for p in parts)
        return f"TR-{text}"

    monkeypatch.setattr(translator_module, "_call_ollama_translate", fake_call)

    doc_id = None
    try:
        ingest_res = client.post("/ingest-path", json={"file_path": path})
        assert ingest_res.status_code == 200
        doc_id = ingest_res.json()["id"]

        res = client.post(
            f"/documents/{doc_id}/translate-inplace",
            json={"source_lang": "English", "target_lang": "Italian"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "indexed"

        # Original file on disk was overwritten in place with translated run text.
        translated_doc = docx.Document(path)
        translated_texts = [r.text for r in translator_module._collect_docx_runs(translated_doc)]
        assert all(t.startswith("TR-") for t in translated_texts)

        # Re-indexed markdown reflects the translated content.
        assert "TR-Hello world" in data["extracted_markdown"]
    finally:
        if doc_id:
            client.delete(f"/documents/{doc_id}")


def test_translate_inplace_rejects_missing_document():
    with pytest.raises(ValueError, match="not found"):
        translator_module.translate_docx_inplace("nonexistent-doc-id-xyz", "English", "Italian")


def test_translate_inplace_rejects_non_docx_file_type(tmp_path):
    txt_path = str(tmp_path / "plain.txt")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("Just a plain text file, not a DOCX.")

    doc_id = None
    try:
        ingest_res = client.post("/ingest-path", json={"file_path": txt_path})
        assert ingest_res.status_code == 200
        doc_id = ingest_res.json()["id"]

        with pytest.raises(ValueError, match="DOCX"):
            translator_module.translate_docx_inplace(doc_id, "English", "Italian")
    finally:
        if doc_id:
            client.delete(f"/documents/{doc_id}")


# --- PDF fine-mode (Fase 2) ---------------------------------------------------------------


def test_extract_pdf_page_blocks_reads_bbox_text_size_color(tmp_path):
    path = str(tmp_path / "sample.pdf")
    _make_pdf(path, text="Hello PDF world")
    doc = pymupdf.open(path)
    try:
        blocks = translator_module._extract_pdf_page_blocks(doc[0])
        assert len(blocks) == 1
        assert "Hello PDF world" in blocks[0]["text"]
        assert blocks[0]["size"] > 0
        assert len(blocks[0]["bbox"]) == 4
    finally:
        doc.close()


def test_redact_and_reinsert_pdf_blocks_erases_original_text_from_raw_stream(tmp_path):
    """Verifies real redaction, not a visual overlay: the original marker must be absent from
    both the parsed text layer AND the raw saved PDF bytes after apply_redactions()."""
    marker = "SUPERSECRETMARKER12345"
    src_path = str(tmp_path / "src.pdf")
    out_path = str(tmp_path / "out.pdf")
    _make_pdf(src_path, text=marker)

    doc = pymupdf.open(src_path)
    try:
        page = doc[0]
        blocks = translator_module._extract_pdf_page_blocks(page)
        assert any(marker in b["text"] for b in blocks)
        for b in blocks:
            b["text"] = "REPLACED"
        translator_module._redact_and_reinsert_pdf_blocks(page, blocks)
        doc.save(out_path)
    finally:
        doc.close()

    reopened = pymupdf.open(out_path)
    try:
        assert marker not in reopened[0].get_text()
        assert "REPLACED" in reopened[0].get_text()
    finally:
        reopened.close()

    with open(out_path, "rb") as f:
        raw = f.read()
    assert marker.encode() not in raw


def test_translate_pdf_blocks_happy_path(tmp_path, monkeypatch):
    path = str(tmp_path / "sample.pdf")
    _make_pdf(path, text="Hello world")
    doc = pymupdf.open(path)
    try:
        blocks = translator_module._extract_pdf_page_blocks(doc[0])
    finally:
        doc.close()

    def fake_call(text, source_lang, target_lang, model):
        return f"[{text}]"

    monkeypatch.setattr(translator_module, "_call_ollama_translate", fake_call)
    translator_module._translate_pdf_blocks(blocks, "English", "Italian", "llama3.2")
    assert blocks[0]["text"].startswith("[") and "Hello world" in blocks[0]["text"]


def test_translate_pdf_inplace_fine_end_to_end(tmp_path, monkeypatch):
    # Same-length transform (reversal) so the "translated" text fits the original bbox width at
    # the original font size -- this test covers the happy path, not the Fase 2 overflow-clipping
    # limitation, which is covered separately by test_translate_pdf_inplace_fine_clips_overflow.
    marker = "UNIQUEMARKERXYZ"
    translated_marker = marker[::-1]
    path = str(tmp_path / "e2e_sample.pdf")
    _make_pdf(path, text=marker)

    def fake_call(text, source_lang, target_lang, model):
        if translator_module._RUN_SEPARATOR in text:
            parts = text.split(f"\n{translator_module._RUN_SEPARATOR}\n")
            return f"\n{translator_module._RUN_SEPARATOR}\n".join(p[::-1] for p in parts)
        return text[::-1]

    monkeypatch.setattr(translator_module, "_call_ollama_translate", fake_call)

    doc_id = None
    try:
        ingest_res = client.post("/ingest-path", json={"file_path": path})
        assert ingest_res.status_code == 200
        doc_id = ingest_res.json()["id"]

        res = client.post(
            f"/documents/{doc_id}/translate-inplace",
            json={"source_lang": "English", "target_lang": "Italian"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "indexed"
        assert translated_marker in data["extracted_markdown"]

        translated_doc = pymupdf.open(path)
        try:
            page_text = translated_doc[0].get_text()
        finally:
            translated_doc.close()
        assert translated_marker in page_text

        # Original marker was genuinely erased, not just overlaid: it must be absent even from
        # the raw saved bytes (page content streams may be compressed, so this is a stronger
        # check than the parsed-text assertion above -- it can't find a compressed match either).
        with open(path, "rb") as f:
            raw = f.read()
        assert marker.encode() not in raw
    finally:
        if doc_id:
            client.delete(f"/documents/{doc_id}")


def test_translate_pdf_inplace_fine_clips_overflow_without_crashing(tmp_path, monkeypatch):
    """Fase 2 has no auto-fit: translated text that doesn't fit the original bbox at the original
    font size is clipped (dropped), not resized. This must not raise or corrupt the document --
    it's a documented limitation, not an error condition."""
    marker = "UNIQUEMARKERXYZ"
    path = str(tmp_path / "overflow_sample.pdf")
    _make_pdf(path, text=marker)

    def fake_call(text, source_lang, target_lang, model):
        # Much longer than the original -- guaranteed to overflow the tight original bbox.
        if translator_module._RUN_SEPARATOR in text:
            parts = text.split(f"\n{translator_module._RUN_SEPARATOR}\n")
            return f"\n{translator_module._RUN_SEPARATOR}\n".join(f"TRANSLATED-{p}-VERY-LONG-OUTPUT" for p in parts)
        return f"TRANSLATED-{text}-VERY-LONG-OUTPUT"

    monkeypatch.setattr(translator_module, "_call_ollama_translate", fake_call)

    doc_id = None
    try:
        ingest_res = client.post("/ingest-path", json={"file_path": path})
        assert ingest_res.status_code == 200
        doc_id = ingest_res.json()["id"]

        res = client.post(
            f"/documents/{doc_id}/translate-inplace",
            json={"source_lang": "English", "target_lang": "Italian"},
        )
        assert res.status_code == 200

        with open(path, "rb") as f:
            raw = f.read()
        # The original was still genuinely erased even though the replacement got clipped.
        assert marker.encode() not in raw
    finally:
        if doc_id:
            client.delete(f"/documents/{doc_id}")


def test_translate_document_inplace_rejects_unsupported_file_type(tmp_path):
    txt_path = str(tmp_path / "plain.txt")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("Just a plain text file.")

    doc_id = None
    try:
        ingest_res = client.post("/ingest-path", json={"file_path": txt_path})
        assert ingest_res.status_code == 200
        doc_id = ingest_res.json()["id"]

        with pytest.raises(translator_module.UnsupportedDocumentTypeError):
            translator_module.translate_document_inplace(doc_id, "English", "Italian")

        res = client.post(
            f"/documents/{doc_id}/translate-inplace",
            json={"source_lang": "English", "target_lang": "Italian"},
        )
        assert res.status_code == 400
    finally:
        if doc_id:
            client.delete(f"/documents/{doc_id}")


def test_translate_document_inplace_returns_404_for_missing_document():
    res = client.post(
        "/documents/nonexistent-doc-id-xyz/translate-inplace",
        json={"source_lang": "English", "target_lang": "Italian"},
    )
    assert res.status_code == 404
