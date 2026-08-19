import os
import sys
import docx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from sidecar.main import app
from sidecar.domain import translator as translator_module

client = TestClient(app)


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
