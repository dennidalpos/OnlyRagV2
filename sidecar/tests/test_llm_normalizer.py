import os
import sys
import pytest
from unittest.mock import patch, MagicMock
import urllib.error

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from sidecar.domain.llm_normalizer import (
    should_normalize_page_with_llm,
    normalize_page_markdown_with_llm,
)
from sidecar.domain.ingestion import extract_document_markdown

def test_should_normalize_page_heuristics():
    assert not should_normalize_page_with_llm("")
    assert not should_normalize_page_with_llm("   ")
    assert not should_normalize_page_with_llm("Short text")
    assert not should_normalize_page_with_llm("[Empty Page Content]")
    assert not should_normalize_page_with_llm("[Scanned page - No readable text detected]")
    assert should_normalize_page_with_llm("This is a sufficiently long OCR text block with broken\nword wraps and messy layout that needs normalization.")

def test_normalize_page_markdown_with_llm_success(monkeypatch):
    raw_ocr = "Il pre sente modu lo dovra es sere in viato via e-mail"
    cleaned_expected = "Il presente modulo dovrà essere inviato via e-mail"

    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.read.return_value = f'{{"response": "```markdown\\n{cleaned_expected}\\n```"}}'.encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp

    with patch("urllib.request.urlopen", return_value=mock_resp):
        res = normalize_page_markdown_with_llm(raw_ocr, page_num=1, model="llama3.2")
        assert cleaned_expected in res

def test_normalize_page_markdown_with_llm_graceful_fallback(monkeypatch):
    raw_ocr = "Contratto Telepass numero 123456 con testo lungo sufficiente per la normalizzazione"
    with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("Connection refused")):
        res = normalize_page_markdown_with_llm(raw_ocr, page_num=1, model="llama3.2")
        # Must gracefully return the sanitized raw text without raising
        assert "Contratto Telepass" in res

def test_extract_document_markdown_normalize_with_llm_disabled_by_default(tmp_path):
    txt_file = tmp_path / "sample.txt"
    txt_file.write_text("Hello world text that is long enough for processing in the document pipeline.", encoding="utf-8")

    with patch("sidecar.domain.llm_normalizer.normalize_page_markdown_with_llm") as mock_norm:
        md, num_pages = extract_document_markdown("sample.txt", b"", str(txt_file), normalize_with_llm=False)
        # Verify LLM normalizer was NOT called when disabled
        mock_norm.assert_not_called()
        assert "Hello world text" in md
        assert num_pages == 1

def test_extract_document_markdown_normalize_with_llm_enabled(tmp_path):
    txt_file = tmp_path / "sample.txt"
    txt_file.write_text("Sample OCR content to be processed by LLM normalizer across all page flows.", encoding="utf-8")

    with patch("sidecar.domain.llm_normalizer.normalize_page_markdown_with_llm", return_value="Normalized Content") as mock_norm:
        md, num_pages = extract_document_markdown("sample.txt", b"", str(txt_file), normalize_with_llm=True)
        assert num_pages == 1
