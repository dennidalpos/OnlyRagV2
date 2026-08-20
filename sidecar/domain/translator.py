import os
import time
from typing import Any, Dict, List, Tuple, Optional
import docx
import httpx
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

# Fase 3 auto-fit: never shrink text below this absolute size or this fraction of the original
# span size, whichever floor is higher -- keeps reinserted text legible instead of vanishing.
_PDF_AUTOFIT_MIN_SIZE = 6.0
_PDF_AUTOFIT_MIN_RATIO = 0.4
# Binary search stops refining once the [lo, hi] font-size bracket is this narrow.
_PDF_AUTOFIT_TOLERANCE = 0.25

# Fase 4: bundled static Regular-weight fonts (see sidecar/assets/fonts/OFL-*.txt for license and
# provenance -- SIL Open Font License 1.1, Noto Project). No PDF base14 font covers CJK or
# Cyrillic/Greek, so every PDF reinsertion goes through one of these instead of a built-in font.
_PDF_FONT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "fonts")
_PDF_FALLBACK_FONT_FILE = os.path.join(_PDF_FONT_DIR, "NotoSans-Regular.otf")  # Latin, Cyrillic, Greek

# target_lang (free-text from the frontend language picker) -> bundled font file, matched
# case-insensitively by substring, first match wins. More specific hints are listed before the
# broader ones they'd otherwise be shadowed by (e.g. "traditional chinese" before "chinese").
# Anything not matched here falls back to _PDF_FALLBACK_FONT_FILE.
_PDF_LANG_FONT_RULES: List[Tuple[str, str]] = [
    ("japanese", os.path.join(_PDF_FONT_DIR, "NotoSansCJKjp-Regular.otf")),
    ("korean", os.path.join(_PDF_FONT_DIR, "NotoSansCJKkr-Regular.otf")),
    ("traditional chinese", os.path.join(_PDF_FONT_DIR, "NotoSansCJKtc-Regular.otf")),
    ("chinese", os.path.join(_PDF_FONT_DIR, "NotoSansCJKsc-Regular.otf")),  # default: Simplified
]


def _resolve_pdf_font_file(target_lang: str) -> str:
    """Picks the bundled font file whose script covers target_lang. See _PDF_LANG_FONT_RULES for
    the matching rules and _PDF_FALLBACK_FONT_FILE for the default."""
    lang_lower = (target_lang or "").lower()
    for hint, font_file in _PDF_LANG_FONT_RULES:
        if hint in lang_lower:
            return font_file
    return _PDF_FALLBACK_FONT_FILE


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


_TRANSLATE_MAX_ATTEMPTS = 2
_TRANSLATE_RETRY_DELAY_SECONDS = 3.0


def _call_ollama_translate(text: str, source_lang: str, target_lang: str, model: str) -> str:
    messages = [
        {
            "role": "system",
            "content": (
                f"You are a professional translator. Translate all text accurately from {source_lang} to {target_lang}. "
                f"If the text contains segments separated by '{_RUN_SEPARATOR}' on its own line, "
                f"return exactly the same number of translated segments separated by '{_RUN_SEPARATOR}' on its own line. "
                "Output ONLY the translated text without any explanations, preambles, or commentary."
            ),
        },
        {"role": "user", "content": text},
    ]
    chat_payload = {"model": model, "messages": messages, "stream": False}

    for attempt in range(1, _TRANSLATE_MAX_ATTEMPTS + 1):
        try:
            res = httpx_client.post(f"{_OLLAMA_URL}/api/chat", json=chat_payload, timeout=120.0)
            if res.status_code == 200:
                body = res.json()
                content = (body.get("message", {}).get("content") or body.get("response") or "").strip()
                if content:
                    return content
                return ""
            logger.warning(f"Translation call returned HTTP {res.status_code}")
            return ""
        except httpx.TimeoutException as err:
            if attempt < _TRANSLATE_MAX_ATTEMPTS:
                logger.warning(
                    f"Translation call timed out (attempt {attempt}/{_TRANSLATE_MAX_ATTEMPTS}), "
                    f"likely concurrent Ollama load -- retrying in {_TRANSLATE_RETRY_DELAY_SECONDS}s: {err}"
                )
                time.sleep(_TRANSLATE_RETRY_DELAY_SECONDS)
                continue
            logger.warning(f"Translation call timed out after {attempt} attempts: {err}")
        except Exception as err:
            logger.warning(f"Translation call failed: {err}")
            return ""
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


def translate_docx_inplace(
    doc_id: str,
    source_lang: str,
    target_lang: str,
    model: str = "llama3.2",
    backup_original: bool = True,
    target_dir: Optional[str] = None
) -> IngestResponse:
    """
    Translates a DOCX document's text: creates a backup of the original or writes to target_dir if provided.
    Then re-extracts markdown from the translated file and re-indexes it in LanceDB via update path.
    """
    import shutil
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

    if target_dir and os.path.isdir(target_dir):
        base_name, ext = os.path.splitext(filename)
        out_file_path = os.path.join(target_dir, f"{base_name}_{target_lang.lower()}{ext}")
        docx_doc.save(out_file_path)
    else:
        if backup_original and os.path.exists(file_path):
            backup_path = file_path + ".original.bak"
            try:
                shutil.copy2(file_path, backup_path)
                logger.info(f"Preserved original document backup at: {backup_path}")
            except Exception as b_err:
                logger.warning(f"Could not create backup of original file: {b_err}")
        docx_doc.save(file_path)
        out_file_path = file_path

    new_markdown, _ = extract_document_markdown(os.path.basename(out_file_path), b"", out_file_path)
    return update_and_reindex_document(doc_id, new_markdown)


def _int_color_to_rgb(color: int) -> Tuple[float, float, float]:
    """Converts a PyMuPDF packed sRGB int (as returned in get_text('dict') spans) to the
    (r, g, b) 0-1 float tuple insert_textbox expects."""
    return (((color >> 16) & 0xFF) / 255.0, ((color >> 8) & 0xFF) / 255.0, (color & 0xFF) / 255.0)


def _extract_ocr_page_blocks(page: "pymupdf.Page") -> List[Dict[str, Any]]:
    """Fallback block extraction for scanned PDF pages using RapidOCR.
    Renders the page to an image, detects text boxes with RapidOCR, and maps coordinates back to PDF points."""
    try:
        from sidecar.infrastructure.ocr import run_rapid_ocr_with_boxes
        dpi = 200
        zoom = dpi / 72.0
        mat = pymupdf.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        img_bytes = pix.tobytes(output="png")

        ocr_lines = run_rapid_ocr_with_boxes(img_bytes)
        if not ocr_lines:
            return []

        blocks_out: List[Dict[str, Any]] = []
        for item in ocr_lines:
            px0, py0, px1, py1 = item["bbox"]
            pdf_x0 = px0 / zoom
            pdf_y0 = py0 / zoom
            pdf_x1 = px1 / zoom
            pdf_y1 = py1 / zoom
            height_pt = max(6.0, pdf_y1 - pdf_y0)
            font_size = max(7.0, min(36.0, height_pt * 0.72))
            blocks_out.append({
                "bbox": (pdf_x0, pdf_y0, pdf_x1, pdf_y1),
                "text": item["text"],
                "size": font_size,
                "color": 0,
            })
        return blocks_out
    except Exception as ocr_err:
        logger.warning(f"OCR fallback extraction failed for PDF page: {ocr_err}")
        return []


def _extract_pdf_page_blocks(page: "pymupdf.Page") -> List[Dict[str, Any]]:
    """Extracts non-empty text blocks from one page in reading order: bbox, concatenated text
    (spans joined within a line, lines joined with a space), the size and color of the block's
    first non-empty span. Image blocks (type != 0) are skipped -- falls back to RapidOCR for scanned pages."""
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

    # Scanned PDF fallback: if no native text blocks exist on the page, detect text blocks via RapidOCR
    if not blocks_out:
        blocks_out = _extract_ocr_page_blocks(page)

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


def _padded_block_rect(block: Dict[str, Any]) -> "pymupdf.Rect":
    """The bbox returned by get_text('dict') is the tight ink box around the glyphs, which leaves
    no room for insert_textbox's internal line leading -- reinserting into it unpadded causes the
    whole text to be silently dropped rather than merely clipped. Pads 15% of the block's font
    size on all sides. Used for both redaction and reinsertion, so the erased area is never
    smaller than the reinserted one."""
    x0, y0, x1, y1 = block["bbox"]
    pad = block["size"] * 0.15
    return pymupdf.Rect(x0 - pad, y0 - pad, x1 + pad, y1 + pad)


def _font_alias(font_file: str) -> str:
    """Short, deterministic internal PDF resource name for a bundled font file (readable in the
    saved PDF's font resource dict, stable across calls for the same file)."""
    return os.path.splitext(os.path.basename(font_file))[0]


def _fits_at_font_size(rect: "pymupdf.Rect", text: str, fontsize: float, font_file: str) -> bool:
    """Tests whether `text` wraps to fit `rect` at `fontsize` in `font_file`, using PyMuPDF's own
    layout via a disposable in-memory scratch page -- never draws on the real page, so trials
    cost nothing."""
    scratch_doc = pymupdf.open()
    try:
        scratch_page = scratch_doc.new_page(width=rect.x1 + 50, height=rect.y1 + 50)
        overflow = scratch_page.insert_textbox(
            rect, text, fontsize=fontsize, fontname=_font_alias(font_file), fontfile=font_file
        )
        return overflow >= 0
    finally:
        scratch_doc.close()


def _resolve_autofit_font_size(rect: "pymupdf.Rect", text: str, original_size: float, font_file: str) -> float:
    """Fase 3 auto-fit: binary-searches the largest font size <= original_size at which `text`
    fits `rect`. Returns original_size unchanged if it already fits there. Never searches below
    max(_PDF_AUTOFIT_MIN_SIZE, original_size * _PDF_AUTOFIT_MIN_RATIO); if even that floor
    overflows, returns the floor anyway and lets the caller accept clipping at the smallest
    legible size tried, rather than shrinking text to illegibility to avoid all clipping."""
    floor = max(_PDF_AUTOFIT_MIN_SIZE, original_size * _PDF_AUTOFIT_MIN_RATIO)
    if floor >= original_size or _fits_at_font_size(rect, text, original_size, font_file):
        return original_size
    if not _fits_at_font_size(rect, text, floor, font_file):
        return floor

    lo, hi = floor, original_size
    while hi - lo > _PDF_AUTOFIT_TOLERANCE:
        mid = (lo + hi) / 2
        if _fits_at_font_size(rect, text, mid, font_file):
            lo = mid
        else:
            hi = mid
    return lo


def _redact_and_reinsert_pdf_blocks(page: "pymupdf.Page", blocks: List[Dict[str, Any]], font_file: str) -> None:
    """Permanently erases the original text under each block's bbox via PyMuPDF native redaction
    (add_redact_annot + apply_redactions -- verified empirically to strip the text from the raw
    page content stream, not just visually overlay it) then reinserts the translated text in the
    same bbox using `font_file` (selected by _resolve_pdf_font_file from the target language, see
    Fase 4), auto-fitting the font size down from the original span size (Fase 3) before
    accepting clipping as a last resort.

    Redaction fill is white, which only blends cleanly on white/light backgrounds; a known
    limitation, see IMPLEMENTATION_PLAN.md Task 4.
    """
    for block in blocks:
        page.add_redact_annot(_padded_block_rect(block), fill=(1, 1, 1))
    page.apply_redactions()
    font_alias = _font_alias(font_file)
    for block in blocks:
        rect = _padded_block_rect(block)
        fit_size = _resolve_autofit_font_size(rect, block["text"], block["size"], font_file)
        overflow = page.insert_textbox(
            rect, block["text"], fontsize=fit_size, fontname=font_alias, fontfile=font_file,
            color=_int_color_to_rgb(block["color"]),
        )
        if overflow < 0:
            logger.warning(
                f"Translated PDF text clipped even at auto-fit floor {fit_size:.1f}pt "
                f"(original {block['size']:.1f}pt, overflow={overflow:.1f}pt)"
            )
        elif fit_size < block["size"]:
            logger.info(f"Translated PDF text auto-fit from {block['size']:.1f}pt to {fit_size:.1f}pt")


def translate_pdf_inplace_fine(
    doc_id: str,
    source_lang: str,
    target_lang: str,
    model: str = "llama3.2",
    backup_original: bool = True,
    target_dir: Optional[str] = None
) -> IngestResponse:
    """
    'Fine-mode' PDF in-place translation: for every page, permanently redacts each original text
    block and reinserts the translated text in the same bbox, auto-fitting the font size down.
    Saves to a temp file and creates a backup of the original or writes to target_dir if provided.
    Then re-extracts markdown and re-indexes it via the update path.
    """
    import shutil
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

        font_file = _resolve_pdf_font_file(target_lang)
        logger.info(
            f"Translating PDF {doc_id} in place (fine-mode): {total_blocks} blocks across "
            f"{len(pdf_doc)} pages ({source_lang} -> {target_lang}, model={model}, "
            f"font={os.path.basename(font_file)})"
        )
        for page, blocks in page_blocks:
            if not blocks:
                continue
            _translate_pdf_blocks(blocks, source_lang, target_lang, model)
            _redact_and_reinsert_pdf_blocks(page, blocks, font_file)
        if target_dir and os.path.isdir(target_dir):
            base_name, ext = os.path.splitext(filename)
            out_file_path = os.path.join(target_dir, f"{base_name}_{target_lang.lower()}{ext}")
            pdf_doc.save(out_file_path)
            tmp_path = None
        else:
            tmp_path = file_path + ".translating.tmp"
            pdf_doc.save(tmp_path)
            out_file_path = file_path
    finally:
        pdf_doc.close()

    if tmp_path and os.path.exists(tmp_path):
        if backup_original and os.path.exists(file_path):
            backup_path = file_path + ".original.bak"
            try:
                shutil.copy2(file_path, backup_path)
                logger.info(f"Preserved original document backup at: {backup_path}")
            except Exception as b_err:
                logger.warning(f"Could not create backup of original file: {b_err}")
        os.replace(tmp_path, file_path)

    new_markdown, _ = extract_document_markdown(os.path.basename(out_file_path), b"", out_file_path)
    return update_and_reindex_document(doc_id, new_markdown)


def translate_document_inplace(
    doc_id: str,
    source_lang: str,
    target_lang: str,
    model: str = "llama3.2",
    backup_original: bool = True,
    target_dir: Optional[str] = None
) -> IngestResponse:
    """
    Dispatches in-place translation to the DOCX or PDF fine-mode pipeline based on the document's
    stored file_type. Raises UnsupportedDocumentTypeError (mapped to HTTP 400) for any other
    type, ValueError (mapped to HTTP 404) if the document itself can't be found.
    """
    record = _load_doc_record(doc_id)
    file_type = record.get("file_type", "")
    if file_type == "docx":
        return translate_docx_inplace(doc_id, source_lang, target_lang, model, backup_original, target_dir)
    if file_type == "pdf":
        return translate_pdf_inplace_fine(doc_id, source_lang, target_lang, model, backup_original, target_dir)
    raise UnsupportedDocumentTypeError(
        f"In-place translation is not supported for file type '{file_type}'. Supported: docx, pdf."
    )
