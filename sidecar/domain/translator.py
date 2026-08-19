import os
from typing import Any, Dict, List, Tuple
import docx
import pymupdf
from sidecar.config import DOCS_TABLE_NAME, logger, httpx_client
from sidecar.infrastructure.db import lance_db, get_existing_tables, validate_doc_id
from sidecar.schemas import IngestResponse
from sidecar.domain.ingestion import extract_document_markdown
from sidecar.services.ingest_service import update_and_reindex_document

# Delimiter injected between run texts in a translation batch prompt. The model is instructed to
# preserve it verbatim so the response can be split back into the same number of segments, in the
# same order, and reassigned 1:1 to the runs that produced them.
_RUN_SEPARATOR = "<<<RUN_SEP>>>"
_TRANSLATE_BATCH_MAX_CHARS = 2500
_OLLAMA_URL = "http://127.0.0.1:11434"

# Fase 2 (PDF fine-mode) scope: fixed built-in font, no original-font preservation and no
# auto-fit -- those are Fase 3/4. See IMPLEMENTATION_PLAN.md Task 4.
_PDF_TRANSLATE_FONT = "helv"


class UnsupportedDocumentTypeError(ValueError):
    """Raised when in-place translation is requested for a file type with no supported pipeline."""


def _load_doc_record(doc_id: str) -> Dict[str, Any]:
    """Looks up a document's stored record by id. Raises ValueError (mapped to HTTP 404 at the
    API boundary) if the documents table doesn't exist yet or the id isn't found."""
    validate_doc_id(doc_id)
    if DOCS_TABLE_NAME not in get_existing_tables():
        raise ValueError("Documents table does not exist")
    dtbl = lance_db.open_table(DOCS_TABLE_NAME)
    records = dtbl.search().where(f'id = "{doc_id}"', prefilter=True).limit(1).to_list()
    if not records:
        raise ValueError(f"Document {doc_id} not found in database")
    return records[0]


def _collect_docx_runs(doc: "docx.Document") -> List["docx.text.run.Run"]:
    """Collects every non-empty run, in document order: body paragraphs first, then every table
    cell's paragraphs (matching the coverage of the DOCX branch of extract_document_markdown)."""
    runs: List["docx.text.run.Run"] = []
    for para in doc.paragraphs:
        for run in para.runs:
            if run.text and run.text.strip():
                runs.append(run)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    for run in para.runs:
                        if run.text and run.text.strip():
                            runs.append(run)
    return runs


def _batch_runs(runs: List["docx.text.run.Run"], max_chars: int = _TRANSLATE_BATCH_MAX_CHARS) -> List[List["docx.text.run.Run"]]:
    """Groups consecutive runs into batches bounded by max_chars, preserving order."""
    batches: List[List["docx.text.run.Run"]] = []
    current: List["docx.text.run.Run"] = []
    current_len = 0
    for run in runs:
        run_len = len(run.text)
        if current and current_len + run_len > max_chars:
            batches.append(current)
            current = []
            current_len = 0
        current.append(run)
        current_len += run_len
    if current:
        batches.append(current)
    return batches


def _call_ollama_translate(text: str, source_lang: str, target_lang: str, model: str) -> str:
    prompt = (
        f"Translate the following text from {source_lang} to {target_lang}. "
        f"The text may contain segments separated by the exact marker '{_RUN_SEPARATOR}' on its own line. "
        f"Return EXACTLY the same number of segments, in the same order, separated by the same marker on its own line. "
        f"Do not merge, split, add, or remove segments. Output ONLY the translated text, no commentary.\n\n{text}"
    )
    payload = {"model": model, "prompt": prompt, "stream": False}
    try:
        res = httpx_client.post(f"{_OLLAMA_URL}/api/generate", json=payload, timeout=120.0)
        if res.status_code == 200:
            return (res.json().get("response") or "").strip()
        logger.warning(f"Translation call returned HTTP {res.status_code}")
    except Exception as err:
        logger.warning(f"Translation call failed: {err}")
    return ""


def _translate_texts_with_fallback(texts: List[str], source_lang: str, target_lang: str, model: str) -> List[str]:
    """Translates one already-batched list of texts via a single delimited Ollama call. If the
    model doesn't return the expected number of segments, falls back to translating each text
    individually rather than risk misassigning translated text to the wrong item. Items whose
    fallback call also fails keep their original (untranslated) text."""
    joined = f"\n{_RUN_SEPARATOR}\n".join(texts)
    translated = _call_ollama_translate(joined, source_lang, target_lang, model)
    segments = [s.strip() for s in translated.split(_RUN_SEPARATOR)] if translated else []

    if translated and len(segments) == len(texts):
        return segments

    if len(texts) > 1:
        logger.warning(
            f"Translation segment mismatch (expected {len(texts)}, got {len(segments)}); "
            "falling back to per-item translation for this batch."
        )
    results = list(texts)
    for i, text in enumerate(texts):
        single = _call_ollama_translate(text, source_lang, target_lang, model)
        if single.strip():
            results[i] = single.strip()
    return results


def _translate_batch(runs: List["docx.text.run.Run"], source_lang: str, target_lang: str, model: str) -> None:
    """Translates one batch of runs in place (see _translate_texts_with_fallback for the
    batching/fallback contract)."""
    translated = _translate_texts_with_fallback([run.text for run in runs], source_lang, target_lang, model)
    for run, text in zip(runs, translated):
        run.text = text


def translate_docx_inplace(doc_id: str, source_lang: str, target_lang: str, model: str = "llama3.2") -> IngestResponse:
    """
    Translates a DOCX document's text in place: overwrites the original file on disk with the
    same styles/paragraphs/tables/images, only the run text is replaced. Then re-extracts markdown
    from the translated file and re-indexes it in LanceDB via the existing update path.
    """
    doc_record = _load_doc_record(doc_id)
    file_type = doc_record.get("file_type", "")
    file_path = doc_record.get("file_path", "")
    filename = doc_record.get("filename", "document.docx")

    if file_type != "docx":
        raise ValueError("In-place translation is supported for DOCX documents only in this phase")
    if not file_path or not os.path.exists(file_path):
        raise ValueError("Original source file is no longer available on disk")

    docx_doc = docx.Document(file_path)
    runs = _collect_docx_runs(docx_doc)
    if not runs:
        raise ValueError("No translatable text runs found in document")

    batches = _batch_runs(runs)
    logger.info(
        f"Translating document {doc_id} in place: {len(runs)} runs in {len(batches)} batches "
        f"({source_lang} -> {target_lang}, model={model})"
    )
    for batch in batches:
        _translate_batch(batch, source_lang, target_lang, model)

    docx_doc.save(file_path)

    new_markdown, _ = extract_document_markdown(filename, b"", file_path)
    return update_and_reindex_document(doc_id, new_markdown)


def _int_color_to_rgb(color: int) -> Tuple[float, float, float]:
    """Converts a PyMuPDF packed sRGB int (as returned in get_text('dict') spans) to the
    (r, g, b) 0-1 float tuple insert_textbox expects."""
    return (((color >> 16) & 0xFF) / 255.0, ((color >> 8) & 0xFF) / 255.0, (color & 0xFF) / 255.0)


def _extract_pdf_page_blocks(page: "pymupdf.Page") -> List[Dict[str, Any]]:
    """Extracts non-empty text blocks from one page in reading order: bbox, concatenated text
    (spans joined within a line, lines joined with a space), the size and color of the block's
    first non-empty span. Image blocks (type != 0) are skipped -- Fase 2 only translates text."""
    blocks_out: List[Dict[str, Any]] = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        line_texts: List[str] = []
        size = 10.0
        color = 0
        size_set = False
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            line_text = "".join(span.get("text", "") for span in spans)
            if line_text.strip():
                line_texts.append(line_text)
            if not size_set:
                for span in spans:
                    if span.get("text", "").strip():
                        size = span.get("size", size)
                        color = span.get("color", color)
                        size_set = True
                        break
        block_text = " ".join(t.strip() for t in line_texts if t.strip())
        if block_text:
            blocks_out.append({"bbox": tuple(block["bbox"]), "text": block_text, "size": size, "color": color})
    return blocks_out


def _batch_by_char_count(lengths: List[int], max_chars: int) -> List[List[int]]:
    """Groups consecutive indices into batches whose summed length stays under max_chars."""
    batches: List[List[int]] = []
    current: List[int] = []
    current_len = 0
    for i, length in enumerate(lengths):
        if current and current_len + length > max_chars:
            batches.append(current)
            current = []
            current_len = 0
        current.append(i)
        current_len += length
    if current:
        batches.append(current)
    return batches


def _translate_pdf_blocks(blocks: List[Dict[str, Any]], source_lang: str, target_lang: str, model: str) -> None:
    """Translates block texts in place (mutates each block's 'text'), batching consecutive
    blocks under _TRANSLATE_BATCH_MAX_CHARS chars per call via _translate_texts_with_fallback."""
    lengths = [len(b["text"]) for b in blocks]
    for idx_batch in _batch_by_char_count(lengths, _TRANSLATE_BATCH_MAX_CHARS):
        batch_blocks = [blocks[i] for i in idx_batch]
        translated = _translate_texts_with_fallback(
            [b["text"] for b in batch_blocks], source_lang, target_lang, model
        )
        for b, text in zip(batch_blocks, translated):
            b["text"] = text


def _redact_and_reinsert_pdf_blocks(page: "pymupdf.Page", blocks: List[Dict[str, Any]]) -> None:
    """Permanently erases the original text under each block's bbox via PyMuPDF native redaction
    (add_redact_annot + apply_redactions -- verified empirically to strip the text from the raw
    page content stream, not just visually overlay it) then reinserts the translated text in the
    same bbox with a fixed built-in font at the original span size.

    Fase 2 scope: no auto-fit (Fase 3) and no original-font/CJK preservation (Fase 4) -- text
    that doesn't fit the padded bbox is clipped by insert_textbox. Redaction fill is white,
    which only blends cleanly on white/light backgrounds; a known limitation of this phase, see
    IMPLEMENTATION_PLAN.md Task 4 Fase 2.

    The bbox returned by get_text('dict') is the tight ink box around the glyphs, which leaves no
    room for insert_textbox's internal line leading -- reinserting into it unpadded causes the
    whole text to be silently dropped rather than merely clipped. Every block's rect is padded by
    15% of its font size on all sides before use, for both the redaction and the reinsertion, so
    the erased area is never smaller than the reinserted one.
    """
    def _padded_rect(block: Dict[str, Any]) -> "pymupdf.Rect":
        x0, y0, x1, y1 = block["bbox"]
        pad = block["size"] * 0.15
        return pymupdf.Rect(x0 - pad, y0 - pad, x1 + pad, y1 + pad)

    for block in blocks:
        page.add_redact_annot(_padded_rect(block), fill=(1, 1, 1))
    page.apply_redactions()
    for block in blocks:
        overflow = page.insert_textbox(
            _padded_rect(block), block["text"], fontsize=block["size"], fontname=_PDF_TRANSLATE_FONT,
            color=_int_color_to_rgb(block["color"]),
        )
        if overflow < 0:
            logger.warning(f"Translated PDF text clipped to fit original bbox (overflow={overflow:.1f}pt)")


def translate_pdf_inplace_fine(doc_id: str, source_lang: str, target_lang: str, model: str = "llama3.2") -> IngestResponse:
    """
    Fase 2 'fine-mode' PDF in-place translation: for every page, permanently redacts each
    original text block and reinserts the translated text in the same bbox with a fixed built-in
    font at the original size (see _redact_and_reinsert_pdf_blocks for the exact scope/limits).
    Saves to a temp file and atomically replaces the original on success, then re-extracts
    markdown from the translated file and re-indexes it via the existing update path, mirroring
    translate_docx_inplace.
    """
    doc_record = _load_doc_record(doc_id)
    file_type = doc_record.get("file_type", "")
    file_path = doc_record.get("file_path", "")
    filename = doc_record.get("filename", "document.pdf")

    if file_type != "pdf":
        raise ValueError("PDF fine-mode in-place translation requires a PDF document")
    if not file_path or not os.path.exists(file_path):
        raise ValueError("Original source file is no longer available on disk")

    pdf_doc = pymupdf.open(file_path)
    try:
        page_blocks: List[Tuple[Any, List[Dict[str, Any]]]] = []
        total_blocks = 0
        for page in pdf_doc:
            blocks = _extract_pdf_page_blocks(page)
            page_blocks.append((page, blocks))
            total_blocks += len(blocks)

        if total_blocks == 0:
            raise ValueError("No translatable text blocks found in document")

        logger.info(
            f"Translating PDF {doc_id} in place (fine-mode): {total_blocks} blocks across "
            f"{len(pdf_doc)} pages ({source_lang} -> {target_lang}, model={model})"
        )
        for page, blocks in page_blocks:
            if not blocks:
                continue
            _translate_pdf_blocks(blocks, source_lang, target_lang, model)
            _redact_and_reinsert_pdf_blocks(page, blocks)

        tmp_path = file_path + ".translating.tmp"
        pdf_doc.save(tmp_path)
    finally:
        pdf_doc.close()

    os.replace(tmp_path, file_path)

    new_markdown, _ = extract_document_markdown(filename, b"", file_path)
    return update_and_reindex_document(doc_id, new_markdown)


def translate_document_inplace(doc_id: str, source_lang: str, target_lang: str, model: str = "llama3.2") -> IngestResponse:
    """
    Dispatches in-place translation to the DOCX or PDF fine-mode pipeline based on the document's
    stored file_type. Raises UnsupportedDocumentTypeError (mapped to HTTP 400) for any other
    type, ValueError (mapped to HTTP 404) if the document itself can't be found.
    """
    record = _load_doc_record(doc_id)
    file_type = record.get("file_type", "")
    if file_type == "docx":
        return translate_docx_inplace(doc_id, source_lang, target_lang, model)
    if file_type == "pdf":
        return translate_pdf_inplace_fine(doc_id, source_lang, target_lang, model)
    raise UnsupportedDocumentTypeError(
        f"In-place translation is not supported for file type '{file_type}'. Supported: docx, pdf."
    )
