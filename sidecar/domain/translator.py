import os
from typing import List
import docx
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


def _translate_batch(runs: List["docx.text.run.Run"], source_lang: str, target_lang: str, model: str) -> None:
    """Translates one batch of runs in place. If the model doesn't return the expected number of
    segments, falls back to translating each run individually rather than risk misassigning
    translated text to the wrong run."""
    joined = f"\n{_RUN_SEPARATOR}\n".join(run.text for run in runs)
    translated = _call_ollama_translate(joined, source_lang, target_lang, model)
    segments = [s.strip() for s in translated.split(_RUN_SEPARATOR)] if translated else []

    if translated and len(segments) == len(runs):
        for run, segment in zip(runs, segments):
            run.text = segment
        return

    if len(runs) > 1:
        logger.warning(
            f"Translation segment mismatch (expected {len(runs)}, got {len(segments)}); "
            "falling back to per-run translation for this batch."
        )
    for run in runs:
        single = _call_ollama_translate(run.text, source_lang, target_lang, model)
        if single.strip():
            run.text = single.strip()


def translate_docx_inplace(doc_id: str, source_lang: str, target_lang: str, model: str = "llama3.2") -> IngestResponse:
    """
    Translates a DOCX document's text in place: overwrites the original file on disk with the
    same styles/paragraphs/tables/images, only the run text is replaced. Then re-extracts markdown
    from the translated file and re-indexes it in LanceDB via the existing update path.
    """
    validate_doc_id(doc_id)

    if DOCS_TABLE_NAME not in get_existing_tables():
        raise ValueError("Documents table does not exist")

    dtbl = lance_db.open_table(DOCS_TABLE_NAME)
    records = dtbl.search().where(f'id = "{doc_id}"', prefilter=True).limit(1).to_list()
    if not records:
        raise ValueError(f"Document {doc_id} not found in database")

    doc_record = records[0]
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
