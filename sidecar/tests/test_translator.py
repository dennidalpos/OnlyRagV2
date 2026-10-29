import json
import os
import re
import sys
import docx
import numpy as np
import pymupdf
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from sidecar.main import app
from sidecar.domain import translator as translator_module
from _stream import done_payload, ingest_path, read_events, retained_translation_record

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


class _FakeResponse:
    def __init__(self, status_code=200, body=None):
        self.status_code = status_code
        self._body = body or {}

    def json(self):
        return self._body


def test_call_ollama_translate_retries_once_on_timeout_then_succeeds(monkeypatch):
    """A timeout is usually transient Ollama/GPU contention (e.g. a concurrent coding agent task
    holding the model queue) rather than a permanent failure -- reproduces the production incident
    where an in-place translation lost a segment because a single 120s timeout gave up outright."""
    import httpx

    call_count = {"n": 0}

    class FakeHttpxClient:
        def post(self, url, json=None, timeout=None):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise httpx.TimeoutException("simulated contention timeout")
            return _FakeResponse(200, {"response": "translated text"})

    monkeypatch.setattr(translator_module, "httpx_client", FakeHttpxClient())
    monkeypatch.setattr(translator_module.time, "sleep", lambda *_: None)

    result = translator_module._call_ollama_translate("hello", "English", "Italian", "llama3.2")

    assert result == "translated text"
    assert call_count["n"] == 2


def test_call_ollama_translate_sends_binary_thinking_choice(monkeypatch):
    sent = []

    class FakeHttpxClient:
        def post(self, url, json=None, timeout=None):
            sent.append(json)
            return _FakeResponse(200, {"message": {"content": "translated", "thinking": "private"}})

    monkeypatch.setattr(translator_module, "httpx_client", FakeHttpxClient())
    assert translator_module._call_ollama_translate("hello", "English", "Italian", "qwen3:4b", think=True) == "translated"
    assert sent[0]["think"] is True


def test_translation_sends_the_chosen_reasoning_level_not_true(monkeypatch):
    # `true` would run the model's default level ("medium" for qwen3.8:27b), not the one chosen in Settings.
    from schemas import TranslateInplaceRequest

    sent = []

    class FakeHttpxClient:
        def post(self, url, json=None, timeout=None):
            sent.append(json)
            return _FakeResponse(200, {"message": {"content": "translated"}})

    monkeypatch.setattr(translator_module, "httpx_client", FakeHttpxClient())
    assert translator_module._translate_texts_with_fallback(["hello"], "English", "Italian", "qwen3.8:27b", think="low") == ["translated"]
    assert sent[0]["think"] == "low"

    request = TranslateInplaceRequest(source_lang="English", target_lang="Italian", model="qwen3.8:27b", think="low")
    assert request.think == "low"
    assert TranslateInplaceRequest(source_lang="English", target_lang="Italian", model="qwen3.8:27b", think=True).think is True


def test_call_ollama_translate_gives_up_after_max_attempts_on_repeated_timeout(monkeypatch):
    import httpx

    call_count = {"n": 0}

    class FakeHttpxClient:
        def post(self, url, json=None, timeout=None):
            call_count["n"] += 1
            raise httpx.TimeoutException("simulated persistent timeout")

    monkeypatch.setattr(translator_module, "httpx_client", FakeHttpxClient())
    monkeypatch.setattr(translator_module.time, "sleep", lambda *_: None)

    result = translator_module._call_ollama_translate("hello", "English", "Italian", "llama3.2")

    assert result == ""
    assert call_count["n"] == translator_module._TRANSLATE_MAX_ATTEMPTS


def test_call_ollama_translate_does_not_retry_on_non_timeout_failure(monkeypatch):
    """A bad HTTP status (e.g. model not found) or a non-timeout exception won't be fixed by
    retrying, so only one attempt should be made."""
    call_count = {"n": 0}

    class FakeHttpxClient:
        def post(self, url, json=None, timeout=None):
            call_count["n"] += 1
            return _FakeResponse(404, {})

    monkeypatch.setattr(translator_module, "httpx_client", FakeHttpxClient())

    result = translator_module._call_ollama_translate("hello", "English", "Italian", "llama3.2")

    assert result == ""
    assert call_count["n"] == 1


def test_clean_translated_segment_strips_preambles_and_refusals():
    # Preamble stripping
    assert translator_module._clean_translated_segment("The translation of the given word is:\n\nSongs") == "Songs"
    assert translator_module._clean_translated_segment("Here is the translation of the text:\n\nDear Sirs") == "Dear Sirs"
    assert translator_module._clean_translated_segment("Translation: Electronic") == "Electronic"
    assert translator_module._clean_translated_segment("Translates to: Publish your books") == "Publish your books"
    assert translator_module._clean_translated_segment("```\nDirect translation: Hello\n```") == "Hello"
    # Refusal handling
    assert translator_module._clean_translated_segment("I cannot translate a tax code. Is there something else I can help you with?", source_text="CODICE FISCALE * PNTLDN49D56E818T") == "CODICE FISCALE * PNTLDN49D56E818T"
    # Delimiter stripping without corrupting words with 'ep'
    assert translator_module._clean_translated_segment("Telepass S.p.A. next step in development") == "Telepass S.p.A. next step in development"
    assert translator_module._clean_translated_segment("<<<RUN_SEP>>> Telepass Family <<<RUN_SEP>>>") == "Telepass Family"
    assert translator_module._clean_translated_segment("<seg id=\"1\">Telepass S.p.A.</seg>") == "Telepass S.p.A."


def test_immutable_entity_masking_and_unmasking():
    text = "Inviare modulo a assistenza@pec.telepass.com o visitare https://www.telepass.com per dettagli."
    masked, token_map = translator_module._mask_immutable_entities(text)
    assert "assistenza@pec.telepass.com" not in masked
    assert "https://www.telepass.com" not in masked
    assert len(token_map) == 2

    # Simulate translation preserving token placeholders
    translated_sim = masked.replace("Inviare modulo a", "Send form to").replace("o visitare", "or visit").replace("per dettagli", "for details")
    unmasked = translator_module._unmask_immutable_entities(translated_sim, token_map)
    assert "Send form to assistenza@pec.telepass.com or visit https://www.telepass.com for details." == unmasked


@pytest.mark.parametrize("contact", ["first@example.com", "second@pec.EXAMPLE.com", "https://example.com/forms/123"])
def test_contact_masking_is_atomic_when_company_matches_domain(contact):
    source = f"Example S.p.A. inviare a {contact}."
    masked, tokens = translator_module._mask_immutable_entities(source)
    assert contact in tokens.values()
    assert contact not in masked
    assert not any("__PROT_" in value for value in tokens.values())
    assert translator_module._unmask_immutable_entities(masked, tokens) == source


def test_multiple_company_domain_contacts_restore_exactly():
    source = "Example S.p.A.: First@example.com oppure second@pec.example.com entro 18/06/2024."
    masked, tokens = translator_module._mask_immutable_entities(source)
    assert {"First@example.com", "second@pec.example.com"} <= set(tokens.values())
    translated = masked.replace("oppure", "or").replace("entro", "by")
    assert translator_module._validated_translation(translated, masked, tokens) == source.replace("oppure", "or").replace("entro", "by")


def test_written_notice_term_does_not_invent_objection():
    source = "Il rimborso non è dovuto senza diffida scritta."
    masked, tokens = translator_module._mask_immutable_entities(source, "Italian", "English")
    assert "written notice" in tokens.values()
    translated = masked.replace("Il rimborso non è dovuto senza", "No refund is due without")
    assert translator_module._validated_translation(translated, masked, tokens, "Italian", "English") == "No refund is due without written notice."
    _, tokens = translator_module._mask_immutable_entities(source, "Italian", "German")
    assert "written notice" not in tokens.values()


def test_order_return_instruction_keeps_verb_and_variable_order_deadline():
    source = "Return order AB-923 within 7 working days after written confirmation."
    masked, tokens = translator_module._mask_immutable_entities(source, "English", "Italian")
    assert "Restituire l'ordine" in tokens.values()
    translated = masked.replace("within", "entro").replace("working days after written confirmation", "giorni lavorativi dopo la conferma scritta")
    assert translator_module._validated_translation(translated, masked, tokens, "English", "Italian") == "Restituire l'ordine AB-923 entro 7 giorni lavorativi dopo la conferma scritta."
    for text in ("Return order status AB-923", "Return order form", "A Return order AB-923", "Order a return AB-923 within 7 days"):
        _, other_tokens = translator_module._mask_immutable_entities(text, "English", "Italian")
        assert "Restituire l'ordine" not in other_tokens.values()


def test_known_brand_is_protected_next_to_han_without_matching_other_latin_words():
    source = "按照Example提供的指示归还Example装置；SomeExample Exampled"
    masked, tokens = translator_module._mask_immutable_entities(source, company_names=("Example",))
    assert list(tokens.values()) == ["Example", "Example"]
    assert "SomeExample Exampled" in masked
    assert translator_module._unmask_immutable_entities(masked, tokens) == source


def test_portuguese_nome_cognate_preserves_strict_marker_validation(monkeypatch):
    monkeypatch.setattr(translator_module, "_call_ollama_translate", lambda text, *a, **kw: text)
    assert translator_module._translate_texts_with_fallback(["NOME *"], "Italian", "Portuguese", "fixture") == ["NOME *"]
    with pytest.raises(ValueError, match="untranslated"):
        translator_module._translate_texts_with_fallback(["NOME *"], "Italian", "English", "fixture")
    with pytest.raises(ValueError, match="untranslated"):
        translator_module._translate_texts_with_fallback(["CAP *"], "Italian", "Portuguese", "fixture")
    monkeypatch.setattr(translator_module, "_call_ollama_translate", lambda *a, **kw: "NOME")
    with pytest.raises(ValueError, match="marker"):
        translator_module._translate_texts_with_fallback(["NOME *"], "Italian", "Portuguese", "fixture")


@pytest.mark.parametrize("addition", ["other@example.net", "https://other.example.net"])
def test_translation_refuses_added_contact_after_valid_placeholder_restore(addition):
    masked, tokens = translator_module._mask_immutable_entities("Inviare a first@example.com.")
    output = masked.replace("Inviare a", "Send to") + " " + addition
    with pytest.raises(ValueError, match="contact"):
        translator_module._validated_translation(output, masked, tokens)


def test_translation_refuses_unchanged_nonmarker_instruction(monkeypatch):
    monkeypatch.setattr(translator_module, "_call_ollama_translate", lambda text, *a, **kw: text)
    with pytest.raises(ValueError, match="untranslated"):
        translator_module._translate_texts_with_fallback(["FIRMA LEGGIBILE DEL CLIENTE"], "Italian", "Spanish", "fixture")


def test_translation_refuses_confident_wrong_language_and_uses_existing_fallback(monkeypatch):
    calls = []

    def translate(text, *args, is_batch=False, **kwargs):
        calls.append(is_batch)
        if is_batch:
            return '<seg id="1">The customer requests cancellation of the previously identified contract.</seg><seg id="2">Zweiter Titel</seg>'
        return "Der Kunde beantragt die Kündigung des zuvor angegebenen Vertrags."

    monkeypatch.setattr(translator_module, "_call_ollama_translate", translate)
    result = translator_module._translate_texts_with_fallback(
        ["Il cliente chiede la cessazione del contratto sopra indicato.", "Secondo titolo"], "Italian", "German", "fixture"
    )
    assert result == ["Der Kunde beantragt die Kündigung des zuvor angegebenen Vertrags.", "Zweiter Titel"]
    assert calls == [True, False]


@pytest.mark.parametrize("phrase, expected", [
    ("raccomandata a.r. entro", "registered mail with advice of delivery entro"),
    ("Raccomandata A/R", "Registered mail with advice of delivery"),
    ("RACCOMANDATA CON A.R.", "REGISTERED MAIL WITH ADVICE OF DELIVERY."),
])
def test_postal_receipt_term_uses_verified_english_meaning(phrase, expected):
    masked, tokens = translator_module._mask_immutable_entities(phrase, "Italian", "English")
    assert translator_module._unmask_immutable_entities(masked, tokens) == expected
    assert "__PROT_ENT_0__" in masked


@pytest.mark.parametrize("source, source_lang, target_lang", [
    ("A.R. autorizza il modulo AR-0042.", "Italian", "English"),
    ("raccomandata a.r.", "English", "Italian"),
    ("https://example.com/raccomandata a.r.", "Italian", "English"),
])
def test_postal_term_does_not_rewrite_other_languages_initials_or_urls(source, source_lang, target_lang):
    masked, tokens = translator_module._mask_immutable_entities(source, source_lang, target_lang)
    assert translator_module._unmask_immutable_entities(masked, tokens) == source


@pytest.mark.parametrize("language, expected", [
    ("German", "Einschreiben mit Rückschein"),
    ("French", "courrier recommandé avec avis de réception"),
    ("Spanish", "correo certificado con aviso de recibo"),
    ("Portuguese", "correio registado com aviso de receção"),
    ("Russian", "заказное письмо с уведомлением о вручении"),
    ("Chinese", "附回执的挂号邮件"),
    ("Japanese", "受取通知付き書留郵便"),
])
def test_postal_receipt_survives_target_languages_and_missing_token_refuses(language, expected):
    source = "Restituire per raccomandata a.r. entro 18/06/2024."
    masked, tokens = translator_module._mask_immutable_entities(source, "Italian", language)
    assert expected in tokens.values()
    assert "raccomandata a.r." not in masked
    assert expected in translator_module._unmask_immutable_entities(masked, tokens)
    postal_token = next(token for token, value in tokens.items() if value == expected)
    with pytest.raises(ValueError, match="protected"):
        translator_module._unmask_immutable_entities(masked.replace(postal_token, ""), tokens)


@pytest.mark.parametrize("texts", [["Inviare per raccomandata a.r. entro il 18/06/2024."], [
    "Inviare per raccomandata a.r. entro il 18/06/2024.", "Non inviare a help@example.com."
]])
def test_single_and_batch_translation_protect_delivery_term_and_literal_values(monkeypatch, texts):
    def translate(text, *args, **kwargs):
        assert "raccomandata" not in text
        return text.replace("Inviare per", "Send by").replace("entro il", "by").replace("Non inviare a", "Do not send to")

    monkeypatch.setattr(translator_module, "_call_ollama_translate", translate)
    result = translator_module._translate_texts_with_fallback(texts, "Italian", "English", "test-model")
    assert result[0] == "Send by registered mail with advice of delivery by 18/06/2024."
    if len(texts) > 1:
        assert result[1] == "Do not send to help@example.com."


def test_missing_protected_postal_term_fails_instead_of_dropping_receipt(monkeypatch):
    monkeypatch.setattr(translator_module, "_call_ollama_translate", lambda *args, **kwargs: "Send by registered mail.")
    with pytest.raises(ValueError, match="protected"):
        translator_module._translate_texts_with_fallback(["Inviare per raccomandata a.r."], "Italian", "English", "test-model")


@pytest.mark.parametrize("label", ["CODICE FISCALE *", "N° CIVICO *\nLOCALITÀ *"])
def test_short_form_labels_are_not_mistaken_for_target_language(label):
    assert translator_module.is_block_in_target_lang(label, "English") is False


def test_translation_rejects_missing_contact_instead_of_reusing_source(monkeypatch):
    source = "Inviare a first@example.com oppure second@example.com entro il 18/06/2024."
    monkeypatch.setattr(translator_module, "_call_ollama_translate", lambda *a, **kw: "Send to __PROT_ENT_0__.")
    with pytest.raises(ValueError, match="protected"):
        translator_module._translate_texts_with_fallback([source], "Italian", "English", "test-model")


def test_translation_preserves_dates_codes_numbers_and_contacts(monkeypatch):
    source = "Contratto 123456, codice ABC12XYZ, data 18/06/2024, inviare a help@example.com."
    seen = []

    def translate(text, *args, **kwargs):
        seen.append(text)
        return text.replace("Contratto", "Contract").replace("codice", "code").replace("data", "date").replace("inviare a", "send to")

    monkeypatch.setattr(translator_module, "_call_ollama_translate", translate)
    result = translator_module._translate_texts_with_fallback([source], "Italian", "English", "test-model")
    assert result == ["Contract 123456, code ABC12XYZ, date 18/06/2024, send to help@example.com."]
    assert all(value not in seen[0] for value in ("123456", "ABC12XYZ", "18/06/2024", "help@example.com"))


def test_translation_rejects_empty_response(monkeypatch):
    monkeypatch.setattr(translator_module, "_call_ollama_translate", lambda *a, **kw: "")
    with pytest.raises(ValueError, match="empty"):
        translator_module._translate_texts_with_fallback(["Inviare il modulo compilato."], "Italian", "English", "test-model")


def test_required_field_marker_is_protected_with_explicit_meaning():
    masked, tokens = translator_module._mask_immutable_entities("CAP*")
    assert masked == "CAP__PROT_ASTERISK_0__"
    assert tokens == {"__PROT_ASTERISK_0__": "*"}
    assert translator_module._validated_translation("POSTAL CODE__PROT_ASTERISK_0__", masked, tokens) == "POSTAL CODE*"
    with pytest.raises(ValueError, match="marker"):
        translator_module._validated_translation("POSTAL CODE", masked, tokens)


@pytest.mark.parametrize("texts", [["CAP*"], ["CAP*", "LOCALITÀ**"]])
def test_translation_preserves_required_and_footnote_markers(monkeypatch, texts):
    def translate(text, *args, **kwargs):
        # A model treating raw asterisks as Markdown would omit them.
        assert "__PROT_ASTERISK_0__" in text
        return text.replace("*", "").replace("CAP", "POSTAL CODE").replace("LOCALITÀ", "LOCATION")

    monkeypatch.setattr(translator_module, "_call_ollama_translate", translate)
    result = translator_module._translate_texts_with_fallback(texts, "Italian", "English", "test-model")
    assert result == ["POSTAL CODE*"] + (["LOCATION**"] if len(texts) > 1 else [])


@pytest.mark.parametrize("output", [
    "POSTAL CODE", "POSTAL CODE*", "POSTAL CODE__PROT_ASTERISK_0____PROT_ASTERISK_0__",
    "POSTAL CODE__PROT_ASTERISK_0____PROT_ASTERISK_1__", "**POSTAL CODE**__PROT_ASTERISK_0__",
])
def test_translation_rejects_lost_duplicate_unknown_or_added_markers(monkeypatch, output):
    monkeypatch.setattr(translator_module, "_call_ollama_translate", lambda *a, **kw: output)
    with pytest.raises(ValueError, match="marker|placeholder"):
        translator_module._translate_texts_with_fallback(["CAP*"], "Italian", "English", "test-model")


def test_translation_rejects_unknown_marker_when_source_has_no_markers(monkeypatch):
    monkeypatch.setattr(translator_module, "_call_ollama_translate", lambda *a, **kw: "POSTAL CODE__PROT_ASTERISK_0__")
    with pytest.raises(ValueError, match="unknown protected placeholder"):
        translator_module._translate_texts_with_fallback(["CAP"], "Italian", "English", "test-model")


@pytest.mark.parametrize("file_type", ["pdf", "docx"])
@pytest.mark.parametrize("lose_marker", [False, True])
def test_layout_translation_restores_markers_or_refuses_export(tmp_path, monkeypatch, file_type, lose_marker):
    source = tmp_path / f"form.{file_type}"
    if file_type == "pdf":
        with pymupdf.open() as document:
            page = document.new_page()
            assert page.insert_textbox(pymupdf.Rect(40, 40, 350, 120), "Nome*\n*Campo richiesto.", fontsize=14) >= 0
            document.save(source)
    else:
        document = docx.Document()
        document.add_paragraph().add_run("Nome*").bold = True
        document.add_paragraph("*Campo richiesto.")
        document.save(source)
    original_bytes = source.read_bytes()
    sent = []

    class FakeHttpxClient:
        def post(self, url, json=None, timeout=None):
            sent.append(json)
            system, user = json["messages"]
            assert "__PROT_ASTERISK_N__ represents a literal source asterisk" in system["content"]
            text = user["content"].split("\n\n", 1)[1]
            text = text.replace("*", "").replace("Nome", "Name").replace("Campo richiesto", "Required field")
            if lose_marker:
                text = re.sub(r'__PROT_ASTERISK_\d+__', '', text)
            return _FakeResponse(200, {"message": {"content": text}})

    monkeypatch.setattr(translator_module, "httpx_client", FakeHttpxClient())
    record = retained_translation_record(source)
    events = [json.loads(line) for line in translator_module.translate_document_stream(
        record, "Italian", "English", "test-model", num_ctx=8192,
    )]
    assert source.read_bytes() == original_bytes
    assert sent and all(request["options"]["num_ctx"] == 8192 and request["think"] is False for request in sent)
    if lose_marker:
        assert events[-1]["type"] == "error"
        assert "marker" in events[-1]["error"]
        assert not any(event["type"] == "done" for event in events)
        assert list(tmp_path.iterdir()) == [source]
    else:
        assert events[-1]["type"] == "done"
        output = events[-1]["data"]["filePath"]
        if file_type == "pdf":
            with pymupdf.open(output) as document:
                text = document[0].get_text()
        else:
            document = docx.Document(output)
            text = "\n".join(paragraph.text for paragraph in document.paragraphs)
            assert document.paragraphs[0].runs[0].bold is True
        assert text.count("*") == 2
        assert "Name*" in text and "*Required field." in text
        assert "__PROT_" not in text


def test_unchanged_form_label_uses_existing_individual_fallback(monkeypatch):
    calls = []

    def translate(text, *args, is_batch=False, **kwargs):
        calls.append(is_batch)
        if is_batch:
            return text.replace("LOCALITÀ", "LOCATION")
        return text.replace("CAP", "POSTAL CODE")

    monkeypatch.setattr(translator_module, "_call_ollama_translate", translate)
    result = translator_module._translate_texts_with_fallback(["CAP*", "LOCALITÀ*"], "Italian", "English", "test-model")
    assert result == ["POSTAL CODE*", "LOCATION*"]
    assert calls == [True, False]


def test_company_products_and_postal_addresses_are_not_translated():
    source = "Restituire Acme/Acme Europeo a Acme S.p.A., Via Esempio 49-00142 Roma."
    masked, tokens = translator_module._mask_immutable_entities(source)
    assert "Acme" not in masked
    assert "Via Esempio" not in masked
    result = translator_module._unmask_immutable_entities(masked.replace("Restituire", "Return"), tokens)
    assert result == source.replace("Restituire", "Return")


def test_address_value_without_space_after_marker_stays_literal():
    source = "INDIRIZZO RESIDENZA*VIA ESEMPIO NORD"
    masked, tokens = translator_module._mask_immutable_entities(source)
    assert "VIA ESEMPIO NORD" in tokens.values()
    assert "INDIRIZZO RESIDENZA" in masked
    assert translator_module._unmask_immutable_entities(masked, tokens) == source


def test_document_company_context_protects_product_in_separate_block(monkeypatch):
    blocks = [
        {"text": "Example S.p.A.", "preserve_literal": True},
        {"text": "CONTRATTO EXAMPLE FAMILY N.* 12345"},
    ]

    def translate(text, *args, **kwargs):
        assert "EXAMPLE FAMILY" not in text
        return text.replace("CONTRATTO", "CONTRACT")

    monkeypatch.setattr(translator_module, "_call_ollama_translate", translate)
    translator_module._translate_pdf_blocks(blocks, "Italian", "English", "fixture")
    assert blocks[1]["text"] == "CONTRACT EXAMPLE FAMILY N.* 12345"


def test_merged_contract_label_keeps_company_product_atomic():
    source = "CONTRATTOEXAMPLE FAMILY N.* 12345"
    masked, tokens = translator_module._mask_immutable_entities(source, company_names=("Example",))
    assert "EXAMPLE FAMILY" in tokens.values()
    assert "CONTRATTO __PROT_" in masked
    assert "CONTRATTO EXAMPLE FAMILY" in translator_module._unmask_immutable_entities(masked, tokens)


@pytest.mark.parametrize("language, expected", [
    ("English", "POSTAL CODE*"), ("German", "POSTLEITZAHL*"),
    ("French", "CODE POSTAL*"), ("Spanish", "CÓDIGO POSTAL*"),
    ("Portuguese", "CÓDIGO POSTAL*"), ("Russian", "ПОЧТОВЫЙ ИНДЕКС*"),
    ("Chinese", "邮政编码*"), ("Japanese", "郵便番号*"),
])
def test_personal_form_postcode_uses_reviewed_role_without_model(language, expected, monkeypatch):
    monkeypatch.setattr(translator_module, "_call_ollama_translate", lambda *a, **kw: pytest.fail("Known label must not use a model"))
    result = translator_module._translate_texts_with_fallback(["CAP*"], "Italian", language, "fixture", personal_form=True)
    assert result == [expected]


def test_personal_form_unknown_text_still_requires_model_and_markers(monkeypatch):
    seen = []
    monkeypatch.setattr(translator_module, "_call_ollama_translate", lambda text, *a, **kw: seen.append(text) or text.replace("ALTRO CAMPO", "OTHER FIELD"))
    assert translator_module._translate_texts_with_fallback(["ALTRO CAMPO*"], "Italian", "English", "fixture", personal_form=True) == ["OTHER FIELD*"]
    assert seen == ["ALTRO CAMPO__PROT_ASTERISK_0__"]


def test_personal_form_glossary_requires_both_name_roles_and_italian_source():
    assert translator_module._is_personal_form(["NOME*", "COGNOME*"], "Italian")
    assert not translator_module._is_personal_form(["NOME*", "ALTRO*"], "Italian")
    assert not translator_module._is_personal_form(["NOME*", "COGNOME*"], "Portuguese")


def test_personal_form_glossary_unknown_language_keeps_model_path():
    assert translator_module._translated_form_label("N. __PROT_ENT_0__", "Korean") is None
    assert translator_module._translated_form_label("CAP__PROT_ASTERISK_0__", "Korean") is None


def test_personal_form_pec_and_address_share_one_protected_span():
    source = "Inviare alla PEC\nsecond@pec.example.com ovvero per posta."
    masked, tokens = translator_module._mask_immutable_entities(source, "Italian", "German", personal_form=True)
    assert any("second@pec.example.com" in value and "(PEC)" in value for value in tokens.values())
    assert len(tokens) == 1


def test_inline_postcode_and_place_are_literal():
    masked, tokens = translator_module._mask_immutable_entities("Casella 123 - 12345 EXAMPLECITY Via Example 9 - 54321 OTHERCITY.")
    assert "12345 EXAMPLECITY" in tokens.values()
    assert "OTHERCITY" not in masked


def test_partial_or_changed_return_clauses_still_require_model():
    for source in ("il cui elenco è disponibile tramite sito web e Call Center di Example", "spedendolo con posta ordinaria a Example S.p.A. Customer Care, Via Example 9 - 12345 Roma."):
        assert translator_module._translated_form_clause(source, "English", ("Example",)) is None


def test_pdf_personal_form_translates_delivery_alternatives_separately(monkeypatch):
    calls = []

    def translate(texts, *args):
        calls.extend(texts)
        return [text.replace("Inviare", "Send").replace("all'indirizzo", "to the address").replace("via posta", "by post") for text in texts]

    monkeypatch.setattr(translator_module, "_translate_texts_with_fallback", translate)
    blocks = [{"text": "NOME*"}, {"text": "COGNOME*"}, {"text": "Inviare all'indirizzo first@example.com, oppure all'indirizzo PEC second@example.com ovvero via posta Via Example 9."}]
    translator_module._translate_pdf_blocks(blocks, "Italian", "English", "fixture")
    assert len(calls) == 5
    assert "oppure" not in " ".join(calls) and "ovvero" not in " ".join(calls)
    assert blocks[-1]["text"] == "Send to the address first@example.com; or to the address PEC second@example.com; or by post Via Example 9."


def test_personal_form_postal_box_cannot_be_interpreted_as_postcode():
    source = "Customer Care, Casella Postale\n1234 succursale 56 - 12345 EXAMPLECITY"
    masked, tokens = translator_module._mask_immutable_entities(source, "Italian", "Japanese", personal_form=True)
    assert "私書箱1234、支局56" in tokens.values()
    assert "12345 EXAMPLECITY" in tokens.values()
    assert "1234" not in masked and "56" not in masked


@pytest.mark.parametrize("language,points,website,telephone", [
    ("English", "sales or assistance points", "website", "Call Center"),
    ("German", "Verkaufsstellen oder Servicestellen", "Website", "Callcenter"),
    ("French", "vente ou d'assistance", "site web", "centre d'appels"),
    ("Spanish", "venta o de asistencia", "sitio web", "atención telefónica"),
    ("Portuguese", "venda ou de assistência", "site", "atendimento telefónico"),
    ("Russian", "продаж или обслуживания", "сайте", "телефонный"),
    ("Chinese", "销售或服务", "网站", "电话客服中心"),
    ("Japanese", "販売店またはサポート", "ウェブサイト", "コールセンター"),
])
def test_exact_return_clause_preserves_all_options_and_variable_brands(language, points, website, telephone, monkeypatch):
    source = "A seguito dell'esercizio del diritto di recesso dal Contratto Example Family, il dispositivo Example/Example Europeo dovrà essere riconsegnato secondo le indicazioni fornite da Example, recandosi direttamente presso i punti vendita o di assistenza il cui elenco è disponibile tramite sito web e Call Center di Example"
    monkeypatch.setattr(translator_module, "_call_ollama_translate", lambda *a, **kw: pytest.fail("An exact reviewed clause must not use the model"))
    result = translator_module._translate_texts_with_fallback([source], "Italian", language, "fixture", company_names=("Example",), personal_form=True)[0]
    assert "Example Family" in result and "Example/Example Europeo" in result
    assert points in result and website in result and telephone in result
    assert translator_module._translated_form_clause(source + " entro domani", language, ("Example",)) is None
    assert translator_module._translated_form_clause(source.replace("Example", "Other"), language, ("Example",)) is None


@pytest.mark.parametrize("language,receipt", [("English", "advice of delivery"), ("German", "Rückschein"), ("French", "avis de réception"), ("Spanish", "aviso de recibo"), ("Portuguese", "aviso de receção"), ("Russian", "уведомлением о вручении"), ("Chinese", "回执"), ("Japanese", "受取通知")])
def test_exact_postal_return_preserves_delivery_receipt_and_full_address(language, receipt, monkeypatch):
    source = "spedendolo con raccomandata a.r. a Example S.p.A. Customer Care, Via Example 9 – 12345 Roma."
    monkeypatch.setattr(translator_module, "_call_ollama_translate", lambda *a, **kw: pytest.fail("An exact reviewed clause must not use the model"))
    result = translator_module._translate_texts_with_fallback([source], "Italian", language, "fixture", company_names=("Example",), personal_form=True)[0]
    assert "Example S.p.A. Customer Care" in result and "Via Example 9 – 12345 Roma" in result
    assert receipt in result
    assert translator_module._translated_form_clause(source + " Non inviare prima di lunedì.", language, ("Example",)) is None


@pytest.mark.parametrize("language,post", [("English", "postal mail"), ("German", "per Post"), ("French", "courrier postal"), ("Spanish", "correo postal"), ("Portuguese", "correio postal"), ("Russian", "обычной почтой"), ("Chinese", "邮政寄送"), ("Japanese", "郵便で")])
def test_exact_postal_submission_does_not_become_email(language, post, monkeypatch):
    source = "inviato via posta all'indirizzo EXAMPLE S.p.A. - Customer Care, Casella Postale 1234 succursale 56 - 54321 EXAMPLECITY Via Example 9 - 12345 ROMA."
    monkeypatch.setattr(translator_module, "_call_ollama_translate", lambda *a, **kw: pytest.fail("Reviewed postal submission must not use the model"))
    result = translator_module._translate_texts_with_fallback([source], "Italian", language, "fixture", company_names=("EXAMPLE",), personal_form=True)[0]
    assert post in result
    for value in ("EXAMPLE S.p.A.", "1234", "56", "54321 EXAMPLECITY", "Via Example 9 - 12345 ROMA"):
        assert value in result
    assert translator_module._translated_form_clause(source.replace("via posta", "via e-mail"), language, ("EXAMPLE",)) is None


def test_pec_glossary_does_not_change_contacts_or_unknown_source_context():
    source = "PEC first@example.com"
    masked, tokens = translator_module._mask_immutable_entities(source, "Italian", "Japanese", personal_form=True)
    assert translator_module._unmask_immutable_entities(masked, tokens) == "認証電子メール（PEC） first@example.com"
    masked, tokens = translator_module._mask_immutable_entities(source, "Italian", "Japanese")
    assert translator_module._unmask_immutable_entities(masked, tokens) == source


def test_ocr_place_date_value_is_preserved_under_its_label(monkeypatch):
    from sidecar.infrastructure import ocr
    monkeypatch.setattr(ocr, "run_rapid_ocr_with_boxes", lambda image: [
        {"bbox": (100, 200, 700, 250), "text": "LUOGO E DATA", "score": .99},
        {"bbox": (100, 420, 700, 470), "text": "Borgo Esempio 18/06/2024", "score": .99},
    ])
    seen = []

    def translate(text, *args, **kwargs):
        seen.append(text)
        return text.replace("LUOGO E DATA", "PLACE AND DATE")

    monkeypatch.setattr(translator_module, "_call_ollama_translate", translate)
    with pymupdf.open() as doc:
        blocks = translator_module._extract_ocr_page_blocks(doc.new_page())
        translator_module._translate_pdf_blocks(blocks, "Italian", "English", "fixture")
    assert blocks[-1]["preserve_literal"] is True
    assert blocks[-1]["text"] == "Borgo Esempio 18/06/2024"
    assert seen == ["LUOGO E DATA"]


def test_address_protection_does_not_hide_delivery_instructions():
    source = "Via posta inviare a Via Esempio 49 entro domani."
    masked, tokens = translator_module._mask_immutable_entities(source)
    assert "Via posta inviare a" in masked
    assert "entro domani." in masked
    assert "Via Esempio 49" in tokens.values()


def test_protected_url_backslashes_are_restored_literally():
    source = r"Inviare a https://example.com/docs?ref=\1"
    masked, tokens = translator_module._mask_immutable_entities(source)
    assert translator_module._unmask_immutable_entities(masked.replace("Inviare a", "Send to"), tokens) == source.replace("Inviare a", "Send to")


def test_document_notes_are_translated_without_being_removed():
    source = "Nota: Inviare il modulo.\nNota: Conservare una copia."
    translation = "Note: Send the form.\nNote: Keep a copy."
    assert translator_module._clean_translated_segment(translation, source) == translation


def test_invalid_batch_ids_use_individual_fallback(monkeypatch):
    calls = []

    def translate(text, *args, is_batch=False, **kwargs):
        calls.append(is_batch)
        if is_batch:
            return '<seg id="1">Wrong first</seg><seg id="1">Wrong duplicate</seg><seg id="2">Wrong second</seg>'
        return "TR-" + text

    monkeypatch.setattr(translator_module, "_call_ollama_translate", translate)
    assert translator_module._translate_texts_with_fallback(["Primo titolo", "Secondo titolo"], "Italian", "English", "test-model") == ["TR-Primo titolo", "TR-Secondo titolo"]
    assert calls == [True, False, False]


def test_translate_batch_happy_path_reassigns_run_text(tmp_path, monkeypatch):
    path = str(tmp_path / "sample.docx")
    _make_docx(path)
    doc = docx.Document(path)
    runs = translator_module._collect_docx_runs(doc)[:2]  # "Test Document", "Hello world"

    def fake_call(text, source_lang, target_lang, model, is_batch=False, expected_items=1, *args, **kwargs):
        if is_batch:
            # Emits XML segments
            return "<seg id=\"1\">TR-Test Document</seg>\n<seg id=\"2\">TR-Hello world</seg>"
        return f"TR-{text}"

    monkeypatch.setattr(translator_module, "_call_ollama_translate", fake_call)
    translator_module._translate_batch(runs, "English", "Italian", "llama3.2")

    assert runs[0].text == "TR-Test Document"
    assert runs[1].text == "TR-Hello world"


def test_translate_batch_falls_back_on_segment_mismatch(tmp_path, monkeypatch):
    path = str(tmp_path / "sample.docx")
    _make_docx(path)
    doc = docx.Document(path)
    runs = translator_module._collect_docx_runs(doc)[:2]
    original_texts = [r.text for r in runs]

    call_log = []

    def fake_call(text, source_lang, target_lang, model, is_batch=False, expected_items=1, *args, **kwargs):
        call_log.append(text)
        if is_batch:
            return "[1] only one segment back"  # wrong count on purpose
        return f"TR:{text}"

    monkeypatch.setattr(translator_module, "_call_ollama_translate", fake_call)
    translator_module._translate_batch(runs, "English", "Italian", "llama3.2")

    # Fallback path: one batch call + one per-run call each.
    assert len(call_log) == 1 + len(runs)
    for run, original in zip(runs, original_texts):
        assert run.text == f"TR:{original}"


def test_translate_docx_end_to_end(tmp_path, monkeypatch):
    path = str(tmp_path / "e2e_sample.docx")
    _make_docx(path)

    def fake_call(text, source_lang, target_lang, model, is_batch=False, expected_items=1, *args, **kwargs):
        if is_batch:
            matches = re.findall(r'<seg\s+id=[\'"]?(\d+)[\'"]?>([\s\S]*?)</seg>', text)
            if matches:
                return "\n".join([f'<seg id="{idx}">TR-{val.strip()}</seg>' for idx, val in matches])
            return "\n".join([f'<seg id="{i+1}">TR-{line.strip()}</seg>' for i, line in enumerate(text.splitlines()) if line.strip()])
        return f"TR-{text}"

    monkeypatch.setattr(translator_module, "_call_ollama_translate", fake_call)

    doc_id = None
    try:
        doc_id = ingest_path(client, path)["id"]

        res = client.post(
            f"/documents/{doc_id}/translate-inplace-stream",
            json={"source_lang": "English", "target_lang": "Italian", "model": "test-model"},
        )
        data = done_payload(res)
        assert data["status"] == "translated"

        # Original file on disk remains intact and unchanged
        orig_doc = docx.Document(path)
        orig_texts = [r.text for r in translator_module._collect_docx_runs(orig_doc)]
        assert "Hello world" in orig_texts

        # Translated file on disk contains translated run text
        translated_file_path = str(tmp_path / data["filename"])
        translated_doc = docx.Document(translated_file_path)
        translated_texts = [r.text for r in translator_module._collect_docx_runs(translated_doc)]
        assert all(t.startswith("TR-") for t in translated_texts)

        # In-place translation separates flows: original extracted markdown in RAG DB is preserved.
        assert "Hello world" in data["extracted_markdown"]
    finally:
        if doc_id:
            client.delete(f"/documents/{doc_id}")


def test_prepare_translation_rejects_missing_document():
    with pytest.raises(ValueError, match="not found"):
        translator_module.prepare_translation("nonexistent-doc-id-xyz")


# --- PDF fine-mode (Fase 2) ---------------------------------------------------------------


def test_resolve_autofit_font_size_keeps_original_size_when_it_already_fits():
    rect = pymupdf.Rect(40, 40, 400, 80)
    size = translator_module._resolve_autofit_font_size(rect, "short", 14.0, "helv")
    assert size == 14.0


def test_resolve_autofit_font_size_shrinks_to_fit_longer_text():
    # Tight rect matching a real single-word block's padded bbox at 14pt (see
    # _padded_block_rect) -- a much longer translated sentence doesn't fit at 14pt here.
    rect = pymupdf.Rect(37.9, 37.9, 181.4, 61.3)
    longer_text = "This translated text is considerably longer than the original short marker sentence"
    original_size = 14.0

    assert not translator_module._fits_at_font_size(rect, longer_text, original_size, "helv")

    fit_size = translator_module._resolve_autofit_font_size(rect, longer_text, original_size, "helv")

    assert fit_size < original_size
    floor = max(translator_module._PDF_AUTOFIT_MIN_SIZE, original_size * translator_module._PDF_AUTOFIT_MIN_RATIO)
    assert fit_size >= floor
    assert translator_module._fits_at_font_size(rect, longer_text, fit_size, "helv")


def test_resolve_autofit_font_size_never_shrinks_below_floor():
    rect = pymupdf.Rect(0, 0, 10, 10)  # too small to ever fit any of this text
    huge_text = "word " * 200
    fit_size = translator_module._resolve_autofit_font_size(rect, huge_text, 14.0, "helv")
    floor = max(translator_module._PDF_AUTOFIT_MIN_SIZE, 14.0 * translator_module._PDF_AUTOFIT_MIN_RATIO)
    assert fit_size == floor


def test_redact_and_reinsert_pdf_blocks_autofits_instead_of_clipping(tmp_path):
    """A translated sentence that would have been clipped at the original font size (Fase 2
    behavior) must now be fully reinserted at a smaller auto-fit size (Fase 3), not truncated."""
    path = str(tmp_path / "autofit_src.pdf")
    out_path = str(tmp_path / "autofit_out.pdf")
    _make_pdf(path, text="Short marker text here")

    longer_text = "This translated text is considerably longer than the original short marker sentence"
    doc = pymupdf.open(path)
    try:
        page = doc[0]
        blocks = translator_module._extract_pdf_page_blocks(page)
        for b in blocks:
            b["text"] = longer_text
        translator_module._redact_and_reinsert_pdf_blocks(page, blocks, translator_module._PDF_FALLBACK_FONT_FILE)
        doc.save(out_path)
    finally:
        doc.close()

    reopened = pymupdf.open(out_path)
    try:
        # get_text() joins wrapped lines with '\n' at the point insert_textbox broke them, so normalize whitespace before comparing -- the point being verified is that the full sentence survived (auto-fit), not that it landed on a single physical line.
        page_text = " ".join(reopened[0].get_text().split())
    finally:
        reopened.close()
    assert longer_text in page_text


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


def test_ocr_extraction_rejects_uncertain_printed_text(monkeypatch):
    from sidecar.infrastructure import ocr
    monkeypatch.setattr(ocr, "run_rapid_ocr_with_boxes", lambda image: [{
        "bbox": (50, 80, 300, 100), "text": "Unreadable instructions", "score": 0.4,
    }])
    with pymupdf.open() as doc:
        page = doc.new_page()
        with pytest.raises(ValueError, match="OCR confidence"):
            translator_module._extract_ocr_page_blocks(page)


def test_ocr_graphic_marks_are_kept_out_of_translation(monkeypatch):
    from sidecar.infrastructure import ocr
    monkeypatch.setattr(ocr, "run_rapid_ocr_with_boxes", lambda image: [
        {"bbox": (200, 300, 1200, 400), "text": "Firma leggibile", "score": 0.99},
        {"bbox": (200, 410, 1200, 650), "text": "Handwriting noise", "score": 0.5, "is_graphic": True},
    ])
    with pymupdf.open() as doc:
        page = doc.new_page()
        blocks = translator_module._extract_ocr_page_blocks(page)
    assert len(blocks) == 1
    assert blocks[0]["text"] == "Firma leggibile"
    assert len(blocks[0]["protected_rects"]) == 1
    assert len(blocks[0]["redaction_rects"]) == 1


def test_unrecognized_scan_is_not_silently_skipped(monkeypatch):
    from sidecar.infrastructure import ocr
    monkeypatch.setattr(ocr, "run_rapid_ocr_with_boxes", lambda image: [])
    with pymupdf.open() as source, pymupdf.open() as doc:
        original = source.new_page()
        original.insert_text((40, 60), "Source instructions")
        page = doc.new_page()
        page.insert_image(page.rect, stream=original.get_pixmap().tobytes("png"))
        with pytest.raises(ValueError, match="No text was recognized"):
            translator_module._extract_ocr_page_blocks(page)
        assert translator_module._extract_ocr_page_blocks(doc.new_page()) == []


def test_unrenderable_translation_fails_before_erasing_original():
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_text((40, 60), "Original text")
        before = page.get_text()
        blocks = [{"bbox": (40, 40, 41, 41), "size": 10.0, "color": 0, "text": "word " * 500}]
        with pytest.raises(ValueError, match="does not fit"):
            translator_module._redact_and_reinsert_pdf_blocks(page, blocks, translator_module._PDF_FALLBACK_FONT_FILE)
        assert page.get_text() == before


def test_scanned_graphics_outside_text_lines_survive_translation():
    from PIL import Image, ImageDraw
    import io
    image = Image.new("RGB", (400, 400), "white")
    draw = ImageDraw.Draw(image)
    draw.line([(50, 105), (110, 75), (130, 115), (160, 85)], fill=(20, 40, 160), width=3)
    image_bytes = io.BytesIO()
    image.save(image_bytes, format="PNG")
    with pymupdf.open() as doc:
        page = doc.new_page(width=400, height=400)
        page.insert_image(page.rect, stream=image_bytes.getvalue())
        signature = pymupdf.Rect(40, 70, 170, 120)
        before = page.get_pixmap(clip=signature).samples
        blocks = [{
            "bbox": (40, 40, 170, 120), "size": 10.0, "color": 0,
            "text": "Client signature", "is_ocr": True,
            "redaction_rects": [(40, 40, 170, 60)], "protected_rects": [tuple(signature)],
        }]
        # The insertion bbox must also stay above the protected graphic.
        blocks[0]["bbox"] = (40, 40, 170, 60)
        translator_module._redact_and_reinsert_pdf_blocks(page, blocks, translator_module._PDF_FALLBACK_FONT_FILE)
        assert page.get_pixmap(clip=signature).samples == before
        assert "Client signature" in page.get_text()


def test_scanned_signature_ink_touching_a_label_survives_redaction():
    import io
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (400, 400), "white")
    ImageDraw.Draw(image).line([(50, 85), (110, 55), (130, 95), (160, 65)], fill=(20, 40, 160), width=3)
    image_bytes = io.BytesIO()
    image.save(image_bytes, format="PNG")
    with pymupdf.open() as doc:
        page = doc.new_page(width=400, height=400)
        page.insert_image(page.rect, stream=image_bytes.getvalue())
        signature = pymupdf.Rect(40, 50, 170, 100)

        def blue_pixels():
            pix = page.get_pixmap(dpi=300, clip=signature)
            pixels = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).astype(np.int16)
            return (pixels[:, :, 2] - pixels[:, :, 0] > 45).sum()

        before = blue_pixels()
        blocks = [{
            "bbox": (40, 40, 170, 60), "size": 10.0, "color": 0,
            "text": "Client signature", "is_ocr": True,
            "redaction_rects": [(40, 40, 170, 60)], "protected_rects": [tuple(signature)],
        }]
        translator_module._redact_and_reinsert_pdf_blocks(page, blocks, translator_module._PDF_FALLBACK_FONT_FILE)
        assert blue_pixels() >= before * 0.98
        assert "Client signature" in page.get_text()


def test_ocr_form_values_are_preserved_verbatim(monkeypatch):
    from sidecar.infrastructure import ocr
    monkeypatch.setattr(ocr, "run_rapid_ocr_with_boxes", lambda image: [
        {"bbox": (100, 200, 500, 250), "text": "LOCALITÀ*", "score": 0.99},
        {"bbox": (600, 200, 1200, 250), "text": "BORGO ESEMPIO Loc. Villa Verde", "score": 0.99},
    ])
    seen = []

    def translate(text, *args, **kwargs):
        seen.append(text)
        return text.replace("LOCALITÀ", "LOCALITY")

    monkeypatch.setattr(translator_module, "_call_ollama_translate", translate)
    with pymupdf.open() as doc:
        blocks = translator_module._extract_ocr_page_blocks(doc.new_page())
        translator_module._translate_pdf_blocks(blocks, "Italian", "English", "test-model")
    assert [block["text"] for block in blocks] == ["LOCALITY*", "BORGO ESEMPIO Loc. Villa Verde"]
    assert seen == ["LOCALITÀ__PROT_ASTERISK_0__"]


def test_translation_does_not_overwrite_previous_output(tmp_path):
    source = tmp_path / "source.pdf"
    source.write_bytes(b"original")
    previous = tmp_path / "source_english.pdf"
    previous.write_bytes(b"previous translation")
    path = translator_module._resolve_output_filepath(str(source), source.name, "English")
    assert path != str(previous)
    assert previous.read_bytes() == b"previous translation"


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
        translator_module._redact_and_reinsert_pdf_blocks(page, blocks, translator_module._PDF_FALLBACK_FONT_FILE)
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

    def fake_call(text, source_lang, target_lang, model, is_batch=False, expected_items=1, *args, **kwargs):
        if is_batch:
            matches = re.findall(r'<seg\s+id=[\'"]?(\d+)[\'"]?>([\s\S]*?)</seg>', text)
            if matches:
                return "\n".join([f'<seg id="{idx}">[{val.strip()}]</seg>' for idx, val in matches])
            return "\n".join([f'<seg id="{i+1}">[{line.strip()}]</seg>' for i, line in enumerate(text.splitlines()) if line.strip()])
        return f"[{text}]"

    monkeypatch.setattr(translator_module, "_call_ollama_translate", fake_call)
    translator_module._translate_pdf_blocks(blocks, "English", "Italian", "llama3.2")
    assert blocks[0]["text"].startswith("[") and "Hello world" in blocks[0]["text"]


def test_translate_pdf_end_to_end(tmp_path, monkeypatch):
    marker = "UNIQUEMARKERXYZ"
    translated_marker = marker[::-1]
    path = str(tmp_path / "e2e_sample.pdf")
    _make_pdf(path, text=marker)

    def fake_call(text, source_lang, target_lang, model, is_batch=False, expected_items=1, *args, **kwargs):
        if is_batch:
            matches = re.findall(r'<seg\s+id=[\'"]?(\d+)[\'"]?>([\s\S]*?)</seg>', text)
            if matches:
                return "\n".join([f'<seg id="{idx}">{val.strip()[::-1]}</seg>' for idx, val in matches])
            return "\n".join([f'<seg id="{i+1}">{line.strip()[::-1]}</seg>' for i, line in enumerate(text.splitlines()) if line.strip()])
        return text[::-1]

    monkeypatch.setattr(translator_module, "_call_ollama_translate", fake_call)

    doc_id = None
    try:
        doc_id = ingest_path(client, path)["id"]

        res = client.post(
            f"/documents/{doc_id}/translate-inplace-stream",
            json={"source_lang": "English", "target_lang": "Italian", "model": "test-model"},
        )
        data = done_payload(res)
        assert data["status"] == "translated"
        # In-place translation separates flows: original extracted markdown in RAG DB is preserved.
        assert marker in data["extracted_markdown"]

        # Original file remains intact
        orig_doc = pymupdf.open(path)
        try:
            assert marker in orig_doc[0].get_text()
        finally:
            orig_doc.close()

        # Translated document contains translated text
        translated_file_path = str(tmp_path / data["filename"])
        translated_doc = pymupdf.open(translated_file_path)
        try:
            page_text = translated_doc[0].get_text()
        finally:
            translated_doc.close()
        assert translated_marker in page_text
    finally:
        if doc_id:
            client.delete(f"/documents/{doc_id}")


def test_translate_pdf_clips_overflow_without_crashing(tmp_path, monkeypatch):
    marker = "UNIQUEMARKERXYZ"
    path = str(tmp_path / "overflow_sample.pdf")
    _make_pdf(path, text=marker)
    replacement = "Testo tradotto estremamente lungo che supera la larghezza del testo originale."

    def fake_call(text, source_lang, target_lang, model, is_batch=False, expected_items=1, *args, **kwargs):
        if is_batch:
            matches = re.findall(r'<seg\s+id=[\'"]?(\d+)[\'"]?>([\s\S]*?)</seg>', text)
            if matches:
                return "\n".join([f'<seg id="{idx}">{replacement}</seg>' for idx, _ in matches])
            return "\n".join([f'<seg id="{i+1}">{replacement}</seg>' for i, line in enumerate(text.splitlines()) if line.strip()])
        return replacement

    monkeypatch.setattr(translator_module, "_call_ollama_translate", fake_call)

    doc_id = None
    try:
        doc_id = ingest_path(client, path)["id"]

        res = client.post(
            f"/documents/{doc_id}/translate-inplace-stream",
            json={"source_lang": "English", "target_lang": "Italian", "model": "test-model"},
        )
        data = done_payload(res)

        # The oversized replacement is auto-fitted into the redacted bbox instead of failing the job.
        translated = pymupdf.open(str(tmp_path / data["filename"]))
        try:
            assert "".join(replacement.split()) in "".join(translated[0].get_text().split())
        finally:
            translated.close()
    finally:
        if doc_id:
            client.delete(f"/documents/{doc_id}")


def test_translate_stream_rejects_unsupported_file_type(tmp_path):
    txt_path = str(tmp_path / "plain.txt")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("Just a plain text file.")

    doc_id = None
    try:
        doc_id = ingest_path(client, txt_path)["id"]

        with pytest.raises(translator_module.UnsupportedDocumentTypeError):
            translator_module.prepare_translation(doc_id)

        res = client.post(
            f"/documents/{doc_id}/translate-inplace-stream",
            json={"source_lang": "English", "target_lang": "Italian", "model": "test-model"},
        )
        assert res.status_code == 400
    finally:
        if doc_id:
            client.delete(f"/documents/{doc_id}")


def test_translate_stream_returns_404_for_missing_document():
    res = client.post(
        "/documents/nonexistent-doc-id-xyz/translate-inplace-stream",
        json={"source_lang": "English", "target_lang": "Italian", "model": "test-model"},
    )
    assert res.status_code == 404


# --- PDF fine-mode Fase 4: bundled CJK / universal fonts -----------------------------------


def test_resolve_pdf_font_file_selects_bundled_fonts_by_language():
    assert "NotoSansCJKjp" in translator_module._resolve_pdf_font_file("Japanese")
    assert "NotoSansCJKkr" in translator_module._resolve_pdf_font_file("Korean")
    assert "NotoSansCJKsc" in translator_module._resolve_pdf_font_file("Chinese")
    assert "NotoSansCJKtc" in translator_module._resolve_pdf_font_file("Traditional Chinese")
    # Non-CJK languages and unrecognized/empty strings fall back to the bundled Latin/Cyrillic/Greek font.
    assert translator_module._resolve_pdf_font_file("Italian") == translator_module._PDF_FALLBACK_FONT_FILE
    assert translator_module._resolve_pdf_font_file("Russian") == translator_module._PDF_FALLBACK_FONT_FILE
    assert translator_module._resolve_pdf_font_file("") == translator_module._PDF_FALLBACK_FONT_FILE


def test_bundled_pdf_fonts_exist_on_disk():
    """Guards against a packaging/path mistake: every font _resolve_pdf_font_file can return must
    actually be present under sidecar/assets/fonts."""
    font_files = {f for _, f in translator_module._PDF_LANG_FONT_RULES} | {translator_module._PDF_FALLBACK_FONT_FILE}
    for font_file in font_files:
        assert os.path.isfile(font_file), f"missing bundled font: {font_file}"


def test_redact_and_reinsert_pdf_blocks_renders_cjk_glyphs(tmp_path):
    """The reinserted text must round-trip through PyMuPDF's parsed text layer using real CJK
    glyphs, not tofu/notdef boxes -- proves the bundled CJK font is actually wired into
    insert_textbox, not just present on disk (see test_bundled_pdf_fonts_exist_on_disk)."""
    path = str(tmp_path / "cjk_src.pdf")
    out_path = str(tmp_path / "cjk_out.pdf")
    _make_pdf(path, text="Hello world")
    chinese_text = "你好"

    doc = pymupdf.open(path)
    try:
        page = doc[0]
        blocks = translator_module._extract_pdf_page_blocks(page)
        for b in blocks:
            b["text"] = chinese_text
        font_file = translator_module._resolve_pdf_font_file("Chinese")
        translator_module._redact_and_reinsert_pdf_blocks(page, blocks, font_file)
        doc.save(out_path)
    finally:
        doc.close()

    reopened = pymupdf.open(out_path)
    try:
        assert chinese_text in reopened[0].get_text()
    finally:
        reopened.close()


def test_redact_and_reinsert_pdf_blocks_renders_cyrillic_fallback(tmp_path):
    """Non-CJK languages (e.g. Russian) use the bundled Latin/Cyrillic/Greek fallback font. Before
    Fase 4, the base14 'helv' font used for every PDF language could not render Cyrillic at all
    (verified separately: it silently degrades to '?????' notdef placeholders)."""
    path = str(tmp_path / "cyr_src.pdf")
    out_path = str(tmp_path / "cyr_out.pdf")
    _make_pdf(path, text="Hello world")
    russian_text = "Привет"

    doc = pymupdf.open(path)
    try:
        page = doc[0]
        blocks = translator_module._extract_pdf_page_blocks(page)
        for b in blocks:
            b["text"] = russian_text
        font_file = translator_module._resolve_pdf_font_file("Russian")
        assert font_file == translator_module._PDF_FALLBACK_FONT_FILE
        translator_module._redact_and_reinsert_pdf_blocks(page, blocks, font_file)
        doc.save(out_path)
    finally:
        doc.close()

    reopened = pymupdf.open(out_path)
    try:
        assert russian_text in reopened[0].get_text()
    finally:
        reopened.close()


@pytest.mark.parametrize("language", ["Chinese", "Traditional Chinese", "Japanese", "Korean"])
def test_pdf_reinsertion_preserves_cjk_punctuation_unicode(tmp_path, language):
    source = tmp_path / "source.pdf"
    output = tmp_path / "translated.pdf"
    _make_pdf(str(source), text="Source form instructions")
    source_bytes = source.read_bytes()
    text = "ABC-123 • 姓名… (A\\B)"
    with pymupdf.open(source) as doc:
        page = doc[0]
        blocks = translator_module._extract_pdf_page_blocks(page)
        for block in blocks:
            block["text"] = text
        translator_module._redact_and_reinsert_pdf_blocks(
            page, blocks, translator_module._resolve_pdf_font_file(language)
        )
        pixels = page.get_pixmap().samples
        with pymupdf.open() as reference:
            reference_page = reference.new_page(width=page.rect.width, height=page.rect.height)
            assert reference_page.insert_textbox(
                translator_module._padded_block_rect(blocks[0]), text,
                fontsize=page.get_texttrace()[0]["size"],
                fontname=translator_module._font_alias(translator_module._resolve_pdf_font_file(language)),
                fontfile=translator_module._resolve_pdf_font_file(language),
            ) >= 0
            expected = np.frombuffer(reference_page.get_pixmap().samples, dtype=np.uint8).astype(np.int16)
            actual = np.frombuffer(pixels, dtype=np.uint8).astype(np.int16)
            # Independent native rendering: subpixel roundoff may differ by one gray level.
            assert np.max(np.abs(actual - expected)) <= 1
        doc.save(output, deflate=True, garbage=4, clean=True)
    with pymupdf.open(output) as doc:
        assert "".join(text.split()) == "".join(doc[0].get_text().split())
        assert doc[0].get_pixmap().samples == pixels
    assert source.read_bytes() == source_bytes


def test_pdf_reinsertion_preserves_literal_code_in_cjk_form(tmp_path):
    with pymupdf.open() as doc:
        page = doc.new_page()
        blocks = [
            {"bbox": (40, 40, 160, 70), "size": 10., "color": 0,
             "text": "姓名 *", "is_ocr": True},
            {"bbox": (180, 40, 360, 70), "size": 10., "color": 0,
             "text": "CODE-123", "is_ocr": True, "preserve_literal": True},
        ]
        translator_module._redact_and_reinsert_pdf_blocks(
            page, blocks, translator_module._resolve_pdf_font_file("Chinese")
        )
        output = tmp_path / "form.pdf"
        doc.save(output, deflate=True, garbage=4, clean=True)
    with pymupdf.open(output) as doc:
        assert "CODE-123" in "".join(doc[0].get_text().split())
        assert "姓名*" in "".join(doc[0].get_text().split())
        assert {span["type"] for span in doc[0].get_texttrace()} == {0, 3}


def test_pdf_autofit_rejects_native_fit_with_glyphs_outside_bounds():
    rect = pymupdf.Rect(40, 40, 510, 90.9)
    text = "\n".join(["あ" * 30 + " C"] * 4)
    font = translator_module._resolve_pdf_font_file("Japanese")
    assert not translator_module._fits_at_font_size(rect, text, 8., font)


@pytest.mark.parametrize("language", ["Chinese", "Traditional Chinese", "Japanese", "Korean"])
def test_pdf_reinsertion_autofits_complete_cjk_glyph_bounds(tmp_path, language):
    size = 8.
    block = {"bbox": (41.2, 41.2, 508.8, 89.7),
             "size": size, "color": 0, "text": "\n".join(["あ" * 30 + " C-"] * 4)}
    font = translator_module._resolve_pdf_font_file(language)
    rect = translator_module._padded_block_rect(block)
    with pymupdf.open() as native:
        page = native.new_page()
        assert page.insert_textbox(rect, block["text"], fontsize=size, fontfile=font, fontname="native") >= 0
        assert any(not (rect + (-.01, -.01, .01, .01)).contains(pymupdf.Rect(bbox))
                   for span in page.get_texttrace() for code, _, _, bbox in span["chars"]
                   if not chr(code).isspace())
    output = tmp_path / "translated.pdf"
    with pymupdf.open() as doc:
        page = doc.new_page()
        translator_module._redact_and_reinsert_pdf_blocks(page, [block], font)
        assert all(span["size"] < size for span in page.get_texttrace())
        assert all((rect + (-.01, -.01, .01, .01)).contains(pymupdf.Rect(bbox))
                   for span in page.get_texttrace() for code, _, _, bbox in span["chars"]
                   if not chr(code).isspace())
        doc.save(output, deflate=True, garbage=4, clean=True)
    with pymupdf.open(output) as doc:
        assert "".join(doc[0].get_text().split()) == "".join(block["text"].split())


def test_pdf_translation_stream_exports_cjk_punctuation(tmp_path, monkeypatch):
    source = tmp_path / "source.pdf"
    _make_pdf(str(source), text="Source form instructions")
    source_bytes = source.read_bytes()
    text = "姓名 - ABC123 • 地址…"
    monkeypatch.setattr(translator_module, "_call_ollama_translate", lambda *args, **kwargs: text)
    events = [json.loads(event) for event in translator_module.translate_document_stream(
        retained_translation_record(source),
        "Italian", "Chinese", "fixture-model", target_dir=str(tmp_path),
    )]
    assert events[-1]["type"] == "done"
    with pymupdf.open(events[-1]["data"]["filePath"]) as doc:
        assert "".join(text.split()) == "".join(doc[0].get_text().split())
        assert "Source form instructions" not in doc[0].get_text()
    assert source.read_bytes() == source_bytes


def test_pdf_reinsertion_refuses_missing_rendered_glyph_even_with_text_metadata(tmp_path, monkeypatch):
    source = tmp_path / "source.pdf"
    _make_pdf(str(source), text="Source form instructions")
    source_bytes = source.read_bytes()
    text = "姓名-ABC"
    monkeypatch.setattr(translator_module, "_call_ollama_translate", lambda *args, **kwargs: text)
    insert_text = pymupdf.Shape.insert_text

    def drop_glyph(shape, origin, buffer, **kwargs):
        if buffer == "-":
            return 0
        return insert_text(shape, origin, buffer, **kwargs)

    monkeypatch.setattr(pymupdf.Shape, "insert_text", drop_glyph)
    events = [json.loads(event) for event in translator_module.translate_document_stream(
        retained_translation_record(source),
        "Italian", "Chinese", "fixture-model", target_dir=str(tmp_path),
    )]
    assert events[-1]["type"] == "error"
    assert "reinsertion lost translated text" in events[-1]["error"]
    assert source.read_bytes() == source_bytes
    assert list(tmp_path.glob("*.pdf")) == [source]


def test_pdf_reinsertion_refuses_unsupported_glyph_before_redaction():
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_text((40, 60), "Original text")
        before = page.get_text()
        blocks = [{"bbox": (40, 40, 360, 100), "size": 10., "color": 0, "text": "Unsupported \U0001fae0"}]
        with pytest.raises(ValueError, match="unsupported glyph"):
            translator_module._redact_and_reinsert_pdf_blocks(
                page, blocks, translator_module._PDF_FALLBACK_FONT_FILE
            )
        assert page.get_text() == before


def test_translate_pdf_end_to_end_japanese(tmp_path, monkeypatch):
    """Full pipeline end-to-end with a CJK target language: verifies the font-selection wiring
    from the streaming endpoint all the way through to the saved file and reindexed markdown."""
    # Short phrase, sized to comfortably fit the narrow bbox of the "Hello world" source text (this test verifies the font-selection wiring, not overflow/clipping behavior -- that's covered separately by test_translate_pdf_clips_overflow_without_crashin
    japanese_text = "日本語"
    path = str(tmp_path / "jp_e2e.pdf")
    _make_pdf(path, text="Hello world")

    def fake_call(text, source_lang, target_lang, model, is_batch=False, expected_items=1, *args, **kwargs):
        if is_batch:
            matches = re.findall(r'<seg\s+id=[\'"]?(\d+)[\'"]?>([\s\S]*?)</seg>', text)
            if matches:
                return "\n".join([f'<seg id="{idx}">{japanese_text}</seg>' for idx, _ in matches])
            return "\n".join([f'<seg id="{i+1}">{japanese_text}</seg>' for i, _ in enumerate(text.splitlines()) if _.strip()])
        return japanese_text

    monkeypatch.setattr(translator_module, "_call_ollama_translate", fake_call)

    doc_id = None
    try:
        doc_id = ingest_path(client, path)["id"]

        res = client.post(
            f"/documents/{doc_id}/translate-inplace-stream",
            json={"source_lang": "English", "target_lang": "Japanese", "model": "test-model"},
        )
        data = done_payload(res)
        assert data["status"] == "translated"

        # Original file remains intact
        orig_doc = pymupdf.open(path)
        try:
            assert "Hello world" in orig_doc[0].get_text()
        finally:
            orig_doc.close()

        translated_file_path = str(tmp_path / data["filename"])
        translated_doc = pymupdf.open(translated_file_path)
        try:
            page_text = translated_doc[0].get_text()
        finally:
            translated_doc.close()
        assert japanese_text in page_text
        # In-place translation separates flows: original extracted markdown is preserved.
        assert "Hello world" in data["extracted_markdown"]
    finally:
        if doc_id:
            client.delete(f"/documents/{doc_id}")


def test_translate_inplace_with_backup_and_target_dir(monkeypatch, tmp_path):
    monkeypatch.setattr(
        translator_module,
        "_call_ollama_translate",
        lambda text, s, t, m, *args, **kwargs: f"TR-{text}",
    )
    src_file = tmp_path / "sample.docx"
    doc = docx.Document()
    doc.add_paragraph("Original paragraph text")
    doc.save(str(src_file))

    out_dir = tmp_path / "translated_output"
    out_dir.mkdir()

    doc_id = None
    try:
        doc_id = ingest_path(client, str(src_file))["id"]

        # Test target_dir saving without altering original
        res = client.post(
            f"/documents/{doc_id}/translate-inplace-stream",
            json={
                "source_lang": "English",
                "target_lang": "Spanish",
                "model": "test-model",
                "target_dir": str(out_dir),
            },
        )
        done_payload(res)
        target_files = list(out_dir.glob("*.docx"))
        assert len(target_files) == 1
        assert "sample_spanish.docx" in target_files[0].name

        # Verify original file was not mutated
        orig_doc = docx.Document(str(src_file))
        orig_texts = [r.text for r in translator_module._collect_docx_runs(orig_doc)]
        assert "Original paragraph text" in orig_texts
    finally:
        if doc_id:
            client.delete(f"/documents/{doc_id}")


@pytest.mark.parametrize("coordinate_type", [int, np.float32, np.float64])
def test_translate_scanned_pdf_inplace_with_ocr_fallback(monkeypatch, tmp_path, coordinate_type):
    """Scanned PDF with zero native text layer must detect text blocks via OCR fallback and translate in-place."""
    from sidecar.domain import ingestion as ingestion_module
    from sidecar.infrastructure import ocr as ocr_infra

    monkeypatch.setattr(
        translator_module,
        "_call_ollama_translate",
        lambda text, s, t, m, *args, **kwargs: f"TR-{text}",
    )
    monkeypatch.setattr(
        ingestion_module,
        "run_layout_ocr",
        lambda img: "Richiesta Cessazione Contratto",
    )
    monkeypatch.setattr(
        ocr_infra,
        "run_rapid_ocr_with_boxes",
        lambda img: [{
            "bbox": [coordinate_type(value) for value in (200, 300, 1200, 400)],
            "text": "Richiesta Cessazione Contratto",
            "score": 0.99,
        }],
    )

    # 1. Create a pure raster image page (no text layer)
    img_doc = pymupdf.open()
    img_page = img_doc.new_page(width=595, height=842)
    img_page.draw_rect(pymupdf.Rect(0, 0, 595, 842), color=(1, 1, 1), fill=(1, 1, 1))
    img_page.insert_text(pymupdf.Point(50, 80), "Richiesta Cessazione Contratto", fontsize=18, color=(0, 0, 0))
    pix = img_page.get_pixmap(dpi=200)
    img_bytes = pix.tobytes(output="png")
    img_doc.close()

    scanned_pdf_path = str(tmp_path / "scanned_contract.pdf")
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_image(pymupdf.Rect(0, 0, 595, 842), stream=img_bytes)
    doc.save(scanned_pdf_path)
    doc.close()

    doc_id = None
    try:
        doc_id = ingest_path(client, scanned_pdf_path)["id"]

        # 2. In-place translate scanned PDF
        res = client.post(
            f"/documents/{doc_id}/translate-inplace-stream",
            json={
                "source_lang": "Italian",
                "target_lang": "English",
                "model": "test-model",
            },
        )
        data = done_payload(res)
        assert "TR-" in data["extracted_markdown"] or "Richiesta" in data["extracted_markdown"]

        # Verify translated PDF now contains search-enabled translated text
        translated_file_path = str(tmp_path / data["filename"])
        translated_pdf = pymupdf.open(translated_file_path)
        try:
            page_text = translated_pdf[0].get_text()
            assert "TR-Richiesta Cessazione Contratto" in " ".join(page_text.split())
        finally:
            translated_pdf.close()
    finally:
        if doc_id:
            client.delete(f"/documents/{doc_id}")


def test_translate_pdf_inplace_guarantees_100_percent_block_rendering(tmp_path):
    """Verifies that all blocks on a page are 100% rendered and no block is omitted due to vertical overflow."""
    font_file = translator_module._resolve_pdf_font_file("English")
    pdf_path = str(tmp_path / "tight_blocks.pdf")
    out_pdf_path = str(tmp_path / "tight_blocks_out.pdf")
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    # Create multiple tight blocks with simulated lengthy translated text
    blocks = []
    for i in range(10):
        y0 = 100 + i * 40
        y1 = y0 + 12
        blocks.append({
            "bbox": (50, y0, 300, y1),
            "text": f"Block {i+1} translated with exceptionally long multi-word explanation that exceeds single line capacity",
            "size": 10.0,
            "color": 0,
        })
    doc.save(pdf_path)
    doc.close()

    doc2 = pymupdf.open(pdf_path)
    page2 = doc2[0]
    translator_module._redact_and_reinsert_pdf_blocks(page2, blocks, font_file)
    doc2.save(out_pdf_path)
    doc2.close()

    doc3 = pymupdf.open(out_pdf_path)
    page3 = doc3[0]
    out_blocks = [b for b in page3.get_text("dict")["blocks"] if b.get("type") == 0]
    doc3.close()

    # All 10 blocks must be present on page
    assert len(out_blocks) == 10


def test_resolve_output_filepath_never_overwrites_original(tmp_path):
    orig_file = str(tmp_path / "manual.pdf")
    with open(orig_file, "w") as f:
        f.write("dummy content")

    # 1. Without target_dir: output is created as distinct file with language suffix, never overwriting original
    out_same_dir = translator_module._resolve_output_filepath(orig_file, "manual.pdf", "Italian")
    assert out_same_dir != orig_file
    assert os.path.abspath(out_same_dir) != os.path.abspath(orig_file)
    assert "manual_italian.pdf" in out_same_dir

    # 2. With target_dir: output is created inside target_dir
    target_dir = str(tmp_path / "custom_exports")
    out_target_dir = translator_module._resolve_output_filepath(orig_file, "manual.pdf", "English", target_dir=target_dir)
    assert out_target_dir != orig_file
    assert os.path.dirname(os.path.abspath(out_target_dir)) == os.path.abspath(target_dir)
    assert "manual_english.pdf" in out_target_dir


def test_translate_texts_skips_segments_already_in_target_language(monkeypatch):
    """Verifies that text segments already in the target language bypass the LLM translation call entirely."""
    called_prompts = []

    def fake_call_ollama(text, source_lang, target_lang, model, is_batch=False, expected_items=1, **kwargs):
        called_prompts.append(text)
        if is_batch:
            return '<seg id="1">Traduzione di un testo in italiano</seg>'
        return "Traduzione di un testo in italiano"

    monkeypatch.setattr(translator_module, "_call_ollama_translate", fake_call_ollama)

    # 1. Single segment already in target language (English -> English)
    en_only = ["This is already an English sentence that does not need translation."]
    res_single = translator_module._translate_texts_with_fallback(en_only, "Italian", "English", "llama3.2")
    assert res_single == en_only
    assert len(called_prompts) == 0

    # 2. Batch with mixed languages when target is English:
    # Segment 1 is Italian (needs translation), Segment 2 is English (should skip)
    mixed = [
        "Questo paragrafo è interamente scritto in lingua italiana.",
        "This paragraph is already written in English and should be preserved."
    ]
    res_batch = translator_module._translate_texts_with_fallback(mixed, "Italian", "English", "llama3.2")
    assert len(called_prompts) == 1
    # Only segment 1 should have been sent in prompt
    assert "Questo paragrafo" in called_prompts[0]
    assert "This paragraph is already written" not in called_prompts[0]
    assert res_batch[0] == "Traduzione di un testo in italiano"
    assert res_batch[1] == "This paragraph is already written in English and should be preserved."


@pytest.mark.parametrize("extension", ["pdf", "docx"])
def test_translate_stream_stops_cooperatively_when_its_task_is_cancelled(tmp_path, monkeypatch, extension):
    from sidecar.services.task_cancellation import cancel_task

    path = str(tmp_path / f"cancel_sample.{extension}")
    if extension == "pdf":
        _make_pdf(path, "Text that will never be written translated")
    else:
        _make_docx(path)
    original = open(path, "rb").read()
    retained = tmp_path / "previous-output.txt"
    retained.write_bytes(b"Previous output remains exact")

    def cancelling_call(text, *args, **kwargs):
        cancel_task("translate-cancel-test")
        return f"TR-{text}"

    monkeypatch.setattr(translator_module, "_call_ollama_translate", cancelling_call)

    doc_id = None
    try:
        doc_id = ingest_path(client, path)["id"]
        res = client.post(
            f"/documents/{doc_id}/translate-inplace-stream",
            json={"source_lang": "English", "target_lang": "Italian", "model": "test-model", "task_id": "translate-cancel-test"},
        )
        events = read_events(res)

        assert events[-1] == {"type": "cancelled", "task_id": "translate-cancel-test"}
        assert not any(event["type"] == "done" for event in events)
        assert sorted(os.listdir(tmp_path)) == [f"cancel_sample.{extension}", "previous-output.txt"]
        assert open(path, "rb").read() == original
        assert retained.read_bytes() == b"Previous output remains exact"
    finally:
        if doc_id:
            client.delete(f"/documents/{doc_id}")
