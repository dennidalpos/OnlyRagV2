import os
import re
import time
import uuid
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
_TRANSLATE_BATCH_MAX_CHARS = 350
_TRANSLATE_BATCH_MAX_ITEMS = 4
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


_LANG_PATTERNS = {
    "chinese": re.compile(r'[\u4e00-\u9fff]'),
    "japanese": re.compile(r'[\u3040-\u30ff\u31f0-\u31ff]'),
    "korean": re.compile(r'[\uac00-\ud7af\u1100-\u11ff]'),
    "cyrillic": re.compile(r'[\u0400-\u04ff]'),
    "arabic": re.compile(r'[\u0600-\u06ff]'),
    "greek": re.compile(r'[\u0370-\u03ff]'),
}

_LATIN_STOP_WORDS = {
    "italian": {"di", "da", "in", "con", "su", "per", "tra", "fra", "il", "lo", "la", "gli", "del", "della", "dei", "delle", "questo", "quello", "sono", "anche", "come", "più", "dati", "documento", "sezione", "totale", "tabella"},
    "english": {"the", "and", "that", "was", "for", "with", "they", "this", "from", "will", "would", "there", "their", "total", "invoice", "document", "date", "table", "section", "overview"},
    "french": {"les", "des", "dans", "pour", "avec", "tout", "faire", "cette", "sont", "nous", "vous", "ils", "document", "tableau"},
    "german": {"der", "die", "das", "und", "den", "von", "mit", "sich", "des", "auf", "für", "ist", "dem", "nicht", "eine", "auch", "werden", "aus", "nach", "wird", "dokument", "tabelle"},
    "spanish": {"los", "las", "unos", "unas", "del", "para", "por", "con", "sin", "sobre", "entre", "hasta", "desde", "este", "esta", "estos", "estas", "son", "como", "pero", "más", "documento"},
}


def detect_block_language(text: str) -> Optional[str]:
    """Classifies language of a text block based on Unicode character scripts and stop-word distributions.
    Returns detected language name in lowercase (e.g. 'italian', 'english', 'chinese') or None if ambiguous/short."""
    if not text or len(text.strip()) < 15:
        return None

    cleaned = text.strip()
    for lang, pattern in _LANG_PATTERNS.items():
        if pattern.search(cleaned):
            return lang

    words = re.findall(r'\b[a-zA-Zàèéìòùáéíóúäöüßñç]+\b', cleaned.lower())
    if len(words) < 3:
        return None

    word_set = set(words)
    best_lang = None
    max_matches = 0

    for lang, stop_words in _LATIN_STOP_WORDS.items():
        matches = len(word_set.intersection(stop_words))
        if matches > max_matches:
            max_matches = matches
            best_lang = lang

    if max_matches >= 2:
        return best_lang

    return None


def is_block_in_target_lang(text: str, target_lang: str) -> bool:
    """Returns True if the block is with high confidence already in target_lang, allowing it to be skipped."""
    if not text or not target_lang:
        return False
    t_lang_lower = target_lang.lower().strip()
    detected = detect_block_language(text)
    if detected:
        if detected in t_lang_lower or t_lang_lower in detected:
            return True
    return False


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


def _batch_runs(runs: List["docx.text.run.Run"], max_chars: int = _TRANSLATE_BATCH_MAX_CHARS, max_items: int = _TRANSLATE_BATCH_MAX_ITEMS) -> List[List["docx.text.run.Run"]]:
    """Groups consecutive runs into batches bounded by max_chars and max_items, preserving order."""
    batches: List[List["docx.text.run.Run"]] = []
    current: List["docx.text.run.Run"] = []
    current_len = 0
    for run in runs:
        run_len = len(run.text)
        if current and (current_len + run_len > max_chars or len(current) >= max_items):
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
    is_batch = _RUN_SEPARATOR in text
    if is_batch:
        system_content = (
            f"You are a professional, expert document, form, and contract translator.\n"
            f"Task: Translate ALL text faithfully, completely, and accurately from {source_lang} to {target_lang}.\n\n"
            f"Strict Universal Rules:\n"
            f"1. TRANSLATE EVERY FIELD: You MUST translate every title, heading, section name, table header, form field label, instruction, footer, and administrative keyword into {target_lang} without exception.\n"
            f"2. Separate any fused or concatenated words before translating.\n"
            f"3. PRESERVE DATA VALUES ONLY: Keep proper personal names, specific street addresses, code numbers (e.g. tax ID codes, alphanumeric identifiers), pure numbers, dates, emails, and URLs unchanged.\n"
            f"4. The text contains multiple distinct segments separated by '{_RUN_SEPARATOR}' on its own line. "
            f"You MUST return EXACTLY the same number of translated segments separated by '{_RUN_SEPARATOR}' on its own line, preserving exact segment order.\n"
            f"5. Output ONLY the translated segments with NO preambles, explanations, conversational text, markdown code blocks, or notes.\n"
            f"6. If any segment is already written in {target_lang}, return it verbatim without modifying or re-translating it."
        )
        user_content = (
            f"Translate the following segments from {source_lang} to {target_lang}. "
            f"Separate each translated segment with '{_RUN_SEPARATOR}' on its own line:\n\n{text}"
        )
    else:
        system_content = (
            f"You are a professional, expert document, form, and contract translator.\n"
            f"Task: Translate the given text faithfully, completely, and accurately from {source_lang} to {target_lang}.\n\n"
            f"Strict Universal Rules:\n"
            f"1. TRANSLATE EVERY FIELD: You MUST translate every title, heading, section name, table header, form field label, instruction, footer, and administrative phrase into {target_lang}.\n"
            f"2. Separate any words that were fused by OCR before translating.\n"
            f"3. PRESERVE DATA VALUES ONLY: Keep proper personal names, specific street addresses, code numbers, pure digits, dates, email addresses, and URLs unchanged.\n"
            f"4. If the text is already written in {target_lang}, return it verbatim.\n"
            f"5. Return ONLY the direct {target_lang} translation without prefixes, quotes, delimiters, or notes."
        )
        user_content = f"Translate the following text from {source_lang} to {target_lang}:\n\n{text}"

    messages = [
        {"role": "system", "content": system_content},
        {"role": "user", "content": user_content},
    ]
    chat_payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0.1}
    }

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
                    f"retrying in {_TRANSLATE_RETRY_DELAY_SECONDS}s: {err}"
                )
                time.sleep(_TRANSLATE_RETRY_DELAY_SECONDS)
                continue
            logger.warning(f"Translation call timed out after {attempt} attempts: {err}")
        except Exception as err:
            logger.warning(f"Translation call failed: {err}")
            return ""
    return ""


def _clean_translated_segment(text: str) -> str:
    """Removes any leaked delimiter or artifact from model output."""
    if not text:
        return ""
    clean = re.sub(r'<{2,4}RUN_[A-Z_\s]*>{2,4}', '', text, flags=re.IGNORECASE)
    clean = re.sub(r'^```[a-z]*\s*', '', clean)
    clean = re.sub(r'\s*```$', '', clean)
    return clean.strip()


def _translate_texts_with_fallback(texts: List[str], source_lang: str, target_lang: str, model: str) -> List[str]:
    """Translates batched texts via a single delimited Ollama call with individual fallback."""
    if not texts:
        return []

    def _should_skip_translation(s: str) -> bool:
        trimmed = s.strip()
        if not trimmed:
            return True
        if trimmed.isdigit():
            return True
        if trimmed.startswith("http://") or trimmed.startswith("https://"):
            return True
        if all(c in "-_*=|/\\:.,; " for c in trimmed):
            return True
        if is_block_in_target_lang(trimmed, target_lang):
            return True
        return False

    if len(texts) == 1:
        if _should_skip_translation(texts[0]):
            return texts
        single = _call_ollama_translate(texts[0], source_lang, target_lang, model)
        return [_clean_translated_segment(single)] if single.strip() else texts

    joined = f"\n{_RUN_SEPARATOR}\n".join(texts)
    translated = _call_ollama_translate(joined, source_lang, target_lang, model)
    raw_segments = re.split(r'<{2,4}RUN_SEP[_\s\w]*>{2,4}', translated) if translated else []
    segments = [_clean_translated_segment(s) for s in raw_segments if s.strip()]

    if translated and len(segments) == len(texts):
        # Verify that non-numeric items were actually translated; if an item was echoed verbatim, fall back individually
        for i, (orig, trans) in enumerate(zip(texts, segments)):
            if not _should_skip_translation(orig) and orig.strip().lower() == trans.strip().lower():
                single = _call_ollama_translate(orig, source_lang, target_lang, model)
                if single.strip():
                    segments[i] = _clean_translated_segment(single)
        return segments

    logger.warning(
        f"Translation segment mismatch (expected {len(texts)}, got {len(segments)}); "
        "falling back to per-item translation for this batch."
    )
    results = list(texts)
    for i, text in enumerate(texts):
        if _should_skip_translation(text):
            results[i] = text
            continue
        single = _call_ollama_translate(text, source_lang, target_lang, model)
        if single.strip():
            results[i] = _clean_translated_segment(single)
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

    if backup_original and not target_dir and os.path.exists(file_path):
        import shutil
        try:
            shutil.copy2(file_path, f"{file_path}.original.bak")
        except Exception as bak_err:
            logger.warning(f"Could not create backup file: {bak_err}")

    out_file_path = _resolve_output_filepath(file_path, filename, target_lang, target_dir)
    docx_doc.save(out_file_path)

    return IngestResponse(
        id=doc_id,
        filename=os.path.basename(out_file_path),
        file_size=os.path.getsize(out_file_path) if os.path.exists(out_file_path) else int(doc_record.get("file_size", 0)),
        num_pages=int(doc_record.get("num_pages", 1)),
        num_chunks=int(doc_record.get("num_chunks", 1)),
        extracted_markdown=str(doc_record.get("extracted_markdown", "")),
        status=str(doc_record.get("status", "indexed")),
        ingested_at=str(doc_record.get("ingested_at", ""))
    )


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
        block_text = "\n".join(t.strip() for t in line_texts if t.strip())
        if block_text:
            blocks_out.append({"bbox": tuple(block["bbox"]), "text": block_text, "size": size, "color": color})

    # Scanned PDF fallback: if no native text blocks exist on the page, detect text blocks via RapidOCR
    if not blocks_out:
        blocks_out = _extract_ocr_page_blocks(page)

    return blocks_out


def _batch_by_char_count(lengths: List[int], max_chars: int = _TRANSLATE_BATCH_MAX_CHARS, max_items: int = _TRANSLATE_BATCH_MAX_ITEMS) -> List[List[int]]:
    """Groups consecutive indices into batches whose summed length stays under max_chars and max_items."""
    batches: List[List[int]] = []
    current: List[int] = []
    current_len = 0
    for i, length in enumerate(lengths):
        if current and (current_len + length > max_chars or len(current) >= max_items):
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


def _resolve_output_filepath(file_path: str, filename: str, target_lang: str, target_dir: Optional[str] = None) -> str:
    """Resolves output file path in target_dir if provided, otherwise returns file_path (in-place destination)."""
    if target_dir and target_dir.strip():
        dest_dir = target_dir.strip()
        os.makedirs(dest_dir, exist_ok=True)
        base_name, ext = os.path.splitext(filename)
        lang_suffix = (target_lang or "translated").lower().replace(" ", "_")
        out_filename = f"{base_name}_{lang_suffix}{ext}"
        return os.path.join(dest_dir, out_filename)
    return file_path


def _redact_and_reinsert_pdf_blocks(page: "pymupdf.Page", blocks: List[Dict[str, Any]], font_file: str) -> None:
    """Permanently erases the original text under each block's bbox via PyMuPDF native redaction
    then reinserts the translated text in the same bbox using font_file, auto-fitting the font size
    with collision-aware dynamic height adjustment and fallback to guarantee 100% text retention."""
    for block in blocks:
        page.add_redact_annot(_padded_block_rect(block), fill=(1, 1, 1))
    page.apply_redactions()

    font_alias = _font_alias(font_file)
    for block in blocks:
        text = block.get("text", "").strip()
        if not text:
            continue

        orig_size = block["size"]
        color_rgb = _int_color_to_rgb(block["color"])
        rect = _padded_block_rect(block)
        fit_size = _resolve_autofit_font_size(rect, text, orig_size, font_file)

        # First pass: try fitting in original rect at optimal fit_size
        overflow = page.insert_textbox(rect, text, fontsize=fit_size, fontname=font_alias, fontfile=font_file, color=color_rgb)
        if overflow < 0:
            # Second pass: dynamic vertical expansion with collision avoidance
            extra_h = max(8.0, orig_size * 1.5)
            # Find the top coordinate of the next block directly below to avoid collisions
            max_expand_y1 = page.rect.y1 - 10.0
            for other in blocks:
                if other is not block:
                    ox0, oy0, ox1, _ = other["bbox"]
                    # If other block is below and horizontally overlaps
                    if oy0 > rect.y1 and not (ox1 < rect.x0 or ox0 > rect.x1):
                        max_expand_y1 = min(max_expand_y1, oy0 - 2.0)

            expanded_rect = pymupdf.Rect(rect.x0, rect.y0, rect.x1, min(max_expand_y1, rect.y1 + extra_h))
            overflow2 = page.insert_textbox(expanded_rect, text, fontsize=fit_size, fontname=font_alias, fontfile=font_file, color=color_rgb)
            if overflow2 < 0:
                floor_size = max(_PDF_AUTOFIT_MIN_SIZE, orig_size * _PDF_AUTOFIT_MIN_RATIO)
                overflow3 = page.insert_textbox(expanded_rect, text, fontsize=floor_size, fontname=font_alias, fontfile=font_file, color=color_rgb)
                if overflow3 < 0:
                    page.insert_text(pymupdf.Point(rect.x0, min(max_expand_y1, rect.y0 + floor_size)), text, fontsize=floor_size, fontname=font_alias, fontfile=font_file, color=color_rgb)


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
    block and reinserts the translated text in the same bbox, auto-fitting font size and retaining 100% of text blocks.
    Saves to target_dir or in-place, creating .original.bak if backup_original is set.
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
    if pdf_doc.needs_pass or pdf_doc.is_encrypted:
        pdf_doc.close()
        raise ValueError("Documento protetto da password: il file PDF richiede una password per l'apertura.")
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
            f"Translating PDF {doc_id} (fine-mode): {total_blocks} blocks across "
            f"{len(pdf_doc)} pages ({source_lang} -> {target_lang}, model={model}, "
            f"font={os.path.basename(font_file)})"
        )
        for page, blocks in page_blocks:
            if not blocks:
                continue
            _translate_pdf_blocks(blocks, source_lang, target_lang, model)
            _redact_and_reinsert_pdf_blocks(page, blocks, font_file)

        if backup_original and not target_dir and os.path.exists(file_path):
            import shutil
            try:
                shutil.copy2(file_path, f"{file_path}.original.bak")
            except Exception as bak_err:
                logger.warning(f"Could not create backup file: {bak_err}")

        out_file_path = _resolve_output_filepath(file_path, filename, target_lang, target_dir)
        is_same_file = os.path.abspath(out_file_path) == os.path.abspath(file_path)
        tmp_save_path = f"{out_file_path}.tmp_{uuid.uuid4().hex}.pdf" if is_same_file else out_file_path
        pdf_doc.save(tmp_save_path, deflate=True, garbage=4, clean=True, deflate_images=True, deflate_fonts=True)
    finally:
        pdf_doc.close()

    if is_same_file and os.path.exists(tmp_save_path):
        os.replace(tmp_save_path, out_file_path)

    return IngestResponse(
        id=doc_id,
        filename=os.path.basename(out_file_path),
        file_size=os.path.getsize(out_file_path) if os.path.exists(out_file_path) else int(doc_record.get("file_size", 0)),
        num_pages=int(doc_record.get("num_pages", 1)),
        num_chunks=int(doc_record.get("num_chunks", 1)),
        extracted_markdown=str(doc_record.get("extracted_markdown", "")),
        status=str(doc_record.get("status", "indexed")),
        ingested_at=str(doc_record.get("ingested_at", ""))
    )


async def translate_document_stream_generator(
    doc_id: str,
    source_lang: str,
    target_lang: str,
    model: str = "llama3.2",
    target_dir: Optional[str] = None
):
    """
    Asynchronous generator yielding NDJSON events for document translation with real-time page progress.
    """
    import json
    import asyncio

    try:
        doc_record = _load_doc_record(doc_id)
    except Exception as e:
        yield json.dumps({"type": "error", "error": str(e)}) + "\n"
        return
    file_type = doc_record.get("file_type", "")
    file_path = doc_record.get("file_path", "")
    filename = doc_record.get("filename", "document.pdf")

    if not file_path or not os.path.exists(file_path):
        yield json.dumps({"type": "error", "error": "Original source file is no longer available on disk"}) + "\n"
        return

    out_file_path = _resolve_output_filepath(file_path, filename, target_lang, target_dir)

    if file_type == "docx":
        docx_doc = docx.Document(file_path)
        runs = _collect_docx_runs(docx_doc)
        total_runs = len(runs)
        yield json.dumps({"type": "start", "doc_id": doc_id, "filename": filename, "total_pages": 1, "total_blocks": total_runs}) + "\n"
        batches = _batch_runs(runs)
        for i, batch in enumerate(batches):
            percent = int((i / max(1, len(batches))) * 90)
            yield json.dumps({"type": "progress", "page": 1, "total_pages": 1, "phase": "translating_runs", "percent": percent}) + "\n"
            await asyncio.to_thread(_translate_batch, batch, source_lang, target_lang, model)

        docx_doc.save(out_file_path)
        yield json.dumps({
            "type": "done",
            "data": {
                "id": doc_id,
                "filename": os.path.basename(out_file_path),
                "filePath": out_file_path,
                "file_size": os.path.getsize(out_file_path),
                "num_pages": 1,
                "num_chunks": int(doc_record.get("num_chunks", 1)),
                "extracted_markdown": str(doc_record.get("extracted_markdown", "")),
                "status": "translated",
                "ingested_at": str(doc_record.get("ingested_at", "")),
                "fileType": "docx"
            }
        }) + "\n"
        return

    if file_type != "pdf":
        yield json.dumps({"type": "error", "error": f"Unsupported file type: {file_type}"}) + "\n"
        return

    pdf_doc = pymupdf.open(file_path)
    if pdf_doc.needs_pass or pdf_doc.is_encrypted:
        pdf_doc.close()
        yield json.dumps({"type": "error", "error": "Document is password protected"}) + "\n"
        return

    try:
        total_pages = len(pdf_doc)
        yield json.dumps({"type": "start", "doc_id": doc_id, "filename": filename, "total_pages": total_pages}) + "\n"
        font_file = _resolve_pdf_font_file(target_lang)

        for page_idx, page in enumerate(pdf_doc):
            page_num = page_idx + 1
            yield json.dumps({
                "type": "progress",
                "page": page_num,
                "total_pages": total_pages,
                "phase": "extracting_blocks",
                "percent": int(((page_idx + 0.1) / total_pages) * 100)
            }) + "\n"

            blocks = await asyncio.to_thread(_extract_pdf_page_blocks, page)
            if blocks:
                yield json.dumps({
                    "type": "progress",
                    "page": page_num,
                    "total_pages": total_pages,
                    "phase": "translating_blocks",
                    "percent": int(((page_idx + 0.5) / total_pages) * 100)
                }) + "\n"
                await asyncio.to_thread(_translate_pdf_blocks, blocks, source_lang, target_lang, model)

                yield json.dumps({
                    "type": "progress",
                    "page": page_num,
                    "total_pages": total_pages,
                    "phase": "reconstructing_layout",
                    "percent": int(((page_idx + 0.9) / total_pages) * 100)
                }) + "\n"
                await asyncio.to_thread(_redact_and_reinsert_pdf_blocks, page, blocks, font_file)

        is_same_file = os.path.abspath(out_file_path) == os.path.abspath(file_path)
        tmp_save_path = f"{out_file_path}.tmp_{uuid.uuid4().hex}.pdf" if is_same_file else out_file_path
        pdf_doc.save(tmp_save_path, deflate=True, garbage=4, clean=True, deflate_images=True, deflate_fonts=True)
    finally:
        pdf_doc.close()

    if is_same_file and os.path.exists(tmp_save_path):
        os.replace(tmp_save_path, out_file_path)

    yield json.dumps({
        "type": "done",
        "data": {
            "id": doc_id,
            "filename": os.path.basename(out_file_path),
            "filePath": out_file_path,
            "file_size": os.path.getsize(out_file_path),
            "num_pages": total_pages,
            "num_chunks": int(doc_record.get("num_chunks", 1)),
            "extracted_markdown": str(doc_record.get("extracted_markdown", "")),
            "status": "translated",
            "ingested_at": str(doc_record.get("ingested_at", "")),
            "fileType": "pdf"
        }
    }) + "\n"


def translate_document_inplace(
    doc_id: str,
    source_lang: str,
    target_lang: str,
    model: str = "llama3.2",
    backup_original: bool = True,
    target_dir: Optional[str] = None
) -> IngestResponse:
    """
    Dispatches translation to the DOCX or PDF fine-mode pipeline based on the document's
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

