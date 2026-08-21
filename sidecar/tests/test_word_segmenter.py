import os
import sys
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

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
    assert normalize_ocr_token_spacing("extraction") == "extraction"
    assert normalize_ocr_token_spacing("content") == "content"

def test_normalize_ocr_token_spacing_handles_uppercase_compounds():
    assert "CODICE FISCALE *" in normalize_ocr_token_spacing("CODICEFISCALE*")
    assert "INDIRIZZO RESIDENZA *" in normalize_ocr_token_spacing("INDIRIZZORESIDENZA*")
    assert "VIA ROMA NORD" in normalize_ocr_token_spacing("VIAROMANORD")
    assert "LUOGO E DATA" in normalize_ocr_token_spacing("LUOGOEDATA")
    assert "FIRMA LEGGIBILE DEL CLIENTE" in normalize_ocr_token_spacing("FIRMALEGGIBILEDELCLIENTE")

def test_normalize_ocr_token_spacing_preserves_italian_fiscal_code():
    cf = "PNTLDN49D56E818T"
    result = normalize_ocr_token_spacing(f"CODICEFISCALE* {cf}")
    assert cf in result
    assert "CODICE FISCALE *" in result

def test_normalize_ocr_token_spacing_separates_fused_email_prefixes_and_tlds():
    raw = "Ipresentemodulodovraessereinviatoallacasellae-mailgestionecontratto@telepass.com,oppureallindirizzoPEC assistenza@pec.telepass.comovvero"
    result = normalize_ocr_token_spacing(raw)
    assert "gestionecontratto@telepass.com" in result
    assert "assistenza@pec.telepass.com" in result
    assert "ovvero" in result
    assert "presente modulo" in result
    assert "oppure all indirizzo PEC" in result

def test_normalize_ocr_token_spacing_handles_apostrophes_without_duplication():
    raw = "oppure all'indirizzo PEC"
    result = normalize_ocr_token_spacing(raw)
    assert result == "oppure all'indirizzo PEC"
    assert "oppure all oppure all'" not in result

    raw2 = "A seguito dell'esercizio del diritto di recesso"
    result2 = normalize_ocr_token_spacing(raw2)
    assert result2 == "A seguito dell'esercizio del diritto di recesso"
    assert "A seguito dell A seguito dell'" not in result2

def test_normalize_ocr_token_spacing_defragments_spaced_words():
    raw = "LOCALITA * BORGOMANTOVANOLoc.VillaPoma PROV * MANTOVA"
    result = normalize_ocr_token_spacing(raw)
    assert "MANTOVANO" in result
    assert "MANTOVA" in result

