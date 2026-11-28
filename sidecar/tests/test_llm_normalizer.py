import os
import json
import sys
import pytest
from unittest.mock import patch, MagicMock
import urllib.error

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from sidecar.domain.llm_normalizer import (
    NormalizationReviewRequired,
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

def test_word_repairs_preserve_the_original_for_review():
    raw_ocr = "Il pre sente modu lo dovra es sere in viato via e-mail"
    cleaned_expected = "Il presente modulo dovrà essere inviato via e-mail"

    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.read.return_value = f'{{"response": "```markdown\\n{cleaned_expected}\\n```", "done": true, "done_reason": "stop"}}'.encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp

    with patch("urllib.request.urlopen", return_value=mock_resp):
        with pytest.raises(NormalizationReviewRequired) as rejected:
            normalize_page_markdown_with_llm(raw_ocr, page_num=1, model="llama3.2", num_ctx=4096)
        assert rejected.value.original_markdown == raw_ocr
        assert rejected.value.issues == [{"page": 1, "reason": "content_changed"}]

def test_normalizer_sends_thinking_separately_from_content():
    raw_ocr = "Long OCR content with broken spacing and layout requiring normalization here."
    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.read.return_value = json.dumps({"response": raw_ocr, "thinking": "Private trace", "done": True, "done_reason": "stop"}).encode()
    mock_resp.__enter__.return_value = mock_resp

    with patch("urllib.request.urlopen", return_value=mock_resp) as urlopen:
        assert normalize_page_markdown_with_llm(raw_ocr, model="llama3.2", think=True, num_ctx=4096) == raw_ocr
        request = urlopen.call_args.args[0]
        assert json.loads(request.data)["think"] is True

def test_normalize_page_markdown_with_llm_failure_requires_review():
    raw_ocr = "Contratto Telepass numero 123456 con testo lungo sufficiente per la normalizzazione"
    with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("Connection refused")):
        with pytest.raises(NormalizationReviewRequired) as rejected:
            normalize_page_markdown_with_llm(raw_ocr, page_num=1, model="llama3.2", num_ctx=4096)
        assert rejected.value.original_markdown == raw_ocr
        assert rejected.value.issues == [{"page": 1, "reason": "request_failed"}]

def test_extract_document_markdown_normalize_with_llm_disabled_by_default(tmp_path):
    txt_file = tmp_path / "sample.txt"
    txt_file.write_text("Hello world text that is long enough for processing in the document pipeline.", encoding="utf-8")

    with patch("sidecar.domain.llm_normalizer.normalize_page_markdown_with_llm") as mock_norm:
        md, num_pages = extract_document_markdown("sample.txt", b"", str(txt_file), normalize_with_llm=False)
        # Verify LLM normalizer was NOT called when disabled
        mock_norm.assert_not_called()
        assert "Hello world text" in md
        assert num_pages == 1

def test_normalizer_without_a_model_never_calls_ollama():
    raw_ocr = "Contratto Telepass con testo abbastanza lungo da essere normalizzato dal modello locale."
    with patch("urllib.request.urlopen") as urlopen:
        with pytest.raises(NormalizationReviewRequired) as rejected:
            normalize_page_markdown_with_llm(raw_ocr, page_num=1, model=None)
        assert rejected.value.original_markdown == raw_ocr
        assert rejected.value.issues == [{"page": 1, "reason": "model_missing"}]
        urlopen.assert_not_called()


@pytest.mark.parametrize("body,reason", [
    ({"response": "original", "done": True, "done_reason": "length"}, "truncated"),
    ({"response": "original", "done": False, "done_reason": "stop"}, "incomplete_response"),
    ({"response": "original"}, "incomplete_response"),
    ({"response": "", "done": True, "done_reason": "stop"}, "empty_response"),
    ({"response": 42, "done": True, "done_reason": "stop"}, "empty_response"),
    ([], "incomplete_response"),
])
def test_normalizer_requires_complete_nonempty_response(body, reason):
    source = "Reference AB123 is valid for the complete original clause."
    with patch("urllib.request.urlopen") as urlopen:
        response = urlopen.return_value.__enter__.return_value
        response.status = 200
        response.read.return_value = json.dumps(body).encode()
        with pytest.raises(NormalizationReviewRequired) as rejected:
            normalize_page_markdown_with_llm(source, model="fixture", page_num=3, num_ctx=4096)
    assert rejected.value.original_markdown == source
    assert rejected.value.issues == [{"page": 3, "reason": reason}]


@pytest.mark.parametrize("source,candidate,reason", [
    ("Reference AB123 requires payment of 1.50 euros within 30 days.", "Reference AB123 requires payment of 15 euros within 30 days.", "entities_changed"),
    ("Reference AB123 requires payment within 30 days.", "Reference requires payment within 30 days.", "entities_changed"),
    ("Reference AB123 requires payment within 30 days.", "Reference AB123 requires payment within 30 days. Extra fee 50 euros.", "entities_changed"),
    ("The amount is -100 euros and must remain unchanged.", "The amount is 100 euros and must remain unchanged.", "entities_changed"),
    ("Payment is not due without a signature. Delivery requires consent.", "Payment is due without a signature. Delivery requires consent.", "content_changed"),
    ("Payment requires a signature. Delivery requires consent.", "Payment requires a signature.", "content_changed"),
    ("Payment requires a signature. Delivery requires consent.", "Payment requires consent. Delivery requires a signature.", "content_changed"),
    ("The supplier is Mario Rossi. Delivery requires consent.", "The supplier is Maria Rossi. Delivery requires consent.", "content_changed"),
    ("The inspector said: the contractor is liable. Ada denied it.", "The inspector, said the contractor, is liable. Ada denied it.", "content_changed"),
    ("The therapist contacted Ada Neri about the complete report.", "The the rapist contacted Ada Neri about the complete report.", "content_changed"),
    ("The complete con-\ntract AB123 preserves the original clause.", "The complete contract AB123 preserves the original clause.", "content_changed"),
    ("Il papa legge il documento completo alla presenza di Ada Neri.", "Il papà legge il documento completo alla presenza di Ada Neri.", "content_changed"),
    ("Reference AB123 requires the Contractor to give consent.", "Reference AB123 requires the contractor to give consent.", "content_changed"),
    ("Reference AB123\nAmount 42\nPayment requires consent.", "# Reference AB123\n\n- Amount 42\n- Payment requires consent.", "content_changed"),
    ("```python\nif ready:\n    deliver()\n```", "```python\nif ready:\ndeliver()\n```", "content_changed"),
    ("| Order | Status |\n| AB123 | Ready |", "| Order |\nStatus | | AB123 | Ready |", "content_changed"),
    ("Reference AB123 requires explicit consent before payment.", "```markdown\nReference AB123 requires explicit consent before payment.\n```", "content_changed"),
    ("The **complete original report** requires consent before payment.", "The **complete\n\noriginal report** requires consent before payment.", "content_changed"),
    ("The [complete original report](local) requires consent before payment.", "The [complete\n\noriginal report](local) requires consent before payment.", "content_changed"),
    ("1) Preserve explicit consent.\n2) Preserve the complete original report.", "1) Preserve explicit consent. 2) Preserve the complete original report.", "content_changed"),
])
def test_normalizer_rejects_content_loss_or_replacement(source, candidate, reason):
    with patch("urllib.request.urlopen") as urlopen:
        response = urlopen.return_value.__enter__.return_value
        response.status = 200
        response.read.return_value = json.dumps({"response": candidate, "done": True, "done_reason": "stop"}).encode()
        with pytest.raises(NormalizationReviewRequired) as rejected:
            normalize_page_markdown_with_llm(source, model="fixture", num_ctx=4096)
    assert rejected.value.original_markdown == source
    assert rejected.value.issues[0]["reason"] == reason


@pytest.mark.parametrize("source,candidate", [
    ("Reference AB123\nAmount 42\nPayment requires consent.", "Reference AB123 Amount 42\n\nPayment requires consent."),
    ("Ada Neri  requires   consent before delivery of the complete report.", "Ada Neri requires consent before delivery of the complete report."),
    ("```python\nif ready:\n    deliver()\n```", "```python\nif ready:\n    deliver()\n```"),
])
def test_normalizer_allows_conservative_layout_cleanup(source, candidate):
    with patch("urllib.request.urlopen") as urlopen:
        response = urlopen.return_value.__enter__.return_value
        response.status = 200
        response.read.return_value = json.dumps({"response": candidate, "done": True, "done_reason": "stop"}).encode()
        assert normalize_page_markdown_with_llm(source, model="fixture", num_ctx=4096) == candidate


@pytest.mark.parametrize("context", [None, 256, 512])
def test_missing_or_insufficient_context_refuses_before_model_call(context):
    source = "Reference AB123 requires explicit consent before payment of the complete invoice."
    with patch("urllib.request.urlopen") as urlopen:
        with pytest.raises(NormalizationReviewRequired) as rejected:
            normalize_page_markdown_with_llm(source, model="fixture", num_ctx=context)
        urlopen.assert_not_called()
    assert rejected.value.original_markdown == source
    assert rejected.value.issues[0]["reason"] == ("context_missing" if context is None else "context_budget_exceeded")


def test_context_and_output_reservation_are_explicit_without_changing_timeout():
    source = "A" * 1400
    with patch("urllib.request.urlopen") as urlopen:
        response = urlopen.return_value.__enter__.return_value
        response.status = 200
        response.read.return_value = json.dumps({"response": source, "done": True, "done_reason": "stop"}).encode()
        assert normalize_page_markdown_with_llm(source, model="fixture", num_ctx=4096) == source
        payload = json.loads(urlopen.call_args.args[0].data)
        assert payload["options"]["num_ctx"] == 4096
        assert len(source.encode("utf-8")) + 64 <= payload["options"]["num_predict"] < 2048
        assert len(payload["prompt"].encode("utf-8")) + payload["options"]["num_predict"] + 128 <= 4096
        assert urlopen.call_args.kwargs["timeout"] == 25.0


def test_unicode_input_cannot_exceed_existing_output_limit_even_with_large_context():
    source = "界" * 800
    with patch("urllib.request.urlopen") as urlopen:
        with pytest.raises(NormalizationReviewRequired) as rejected:
            normalize_page_markdown_with_llm(source, model="fixture", num_ctx=32768)
        urlopen.assert_not_called()
    assert rejected.value.original_markdown == source
    assert rejected.value.issues[0]["reason"] == "context_budget_exceeded"
