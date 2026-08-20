import pytest
from sidecar.domain.word_segmenter import normalize_ocr_token_spacing, _viterbi_segment_compound

def test_normalize_ocr_token_spacing_splits_camel_and_numbers():
    assert normalize_ocr_token_spacing("ViaLaurentina449") == "Via Laurentina 449"
    assert normalize_ocr_token_spacing("00142Roma") == "00142 Roma"
    assert normalize_ocr_token_spacing("TelepassFamily") == "Telepass Family"

def test_normalize_ocr_token_spacing_segments_fused_latin_words():
    raw = "conlapresentechiedelacessazionedelcontratto"
    result = normalize_ocr_token_spacing(raw)
    assert result == "con la presente chiede la cessazione del contratto"

def test_normalize_ocr_token_spacing_preserves_emails_and_urls():
    raw = "gestionecontratto@telepass.com oppure https://telepass.com/info"
    result = normalize_ocr_token_spacing(raw)
    assert "gestionecontratto@telepass.com" in result
    assert "https://telepass.com/info" in result

def test_normalize_ocr_token_spacing_preserves_unknown_unbroken_words():
    # Regular whole words that are not fused should remain intact
    assert normalize_ocr_token_spacing("extraction") == "extraction"
    assert normalize_ocr_token_spacing("content") == "content"
