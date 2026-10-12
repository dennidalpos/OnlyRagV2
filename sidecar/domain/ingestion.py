import os
import re
import io
import csv
import json
import threading
import zipfile
import warnings
from typing import List, Tuple, Dict, Optional, Any, Callable
from concurrent.futures import ThreadPoolExecutor
import pymupdf
import pandas as pd
from sidecar.config import (
    logger,
    OLLAMA_BASE_URL,
    TABULAR_MAX_ROWS,
    EXCEL_MAX_ROWS_PER_SHEET,
    EXCEL_MAX_SHEETS
)
from sidecar.infrastructure.ocr import run_layout_ocr, run_vision_ocr
from sidecar.domain.sanitizer import sanitize_extracted_text
from sidecar.domain.vision_prompt import is_vision_ocr_requested, render_vision_prompt
from sidecar.domain.router import (
    classify_file_type,
    DocumentCategory,
    analyze_pdf_page_structure,
    PageRoutingStrategy
)

# Bounded concurrency for the OCR/Vision rendering phase of PDF page extraction.
PDF_PAGE_RENDER_CONCURRENCY = 3
XLS_MAX_SOURCE_BYTES = 8 * 1024 * 1024
XLSX_MAX_SHARED_STRINGS_BYTES = 16 * 1024 * 1024
EXCEL_RAG_MAX_COLUMNS = 128
EXCEL_RAG_MAX_CELL_CHARS = 256
TABULAR_MAX_COLUMNS = 256
TABULAR_MAX_CELL_CHARS = 64 * 1024
TABULAR_MAX_ROW_CHARS = 128 * 1024
TABULAR_MAX_RENDER_CHARS = 4 * 1024 * 1024
XLSX_MAX_XML_BYTES = 32 * 1024 * 1024
XLSX_MAX_TOTAL_XML_BYTES = 128 * 1024 * 1024
PARQUET_MAX_ROW_GROUP_BYTES = 32 * 1024 * 1024
PARQUET_MAX_BATCH_BYTES = 8 * 1024 * 1024
_CSV_FIELD_LIMIT_LOCK = threading.Lock()


def _check_tabular_row(row, source, max_columns=TABULAR_MAX_COLUMNS):
    if max_columns is not None and len(row) > max_columns:
        raise ValueError(f"{source} row exceeds the {max_columns}-column parser limit.")
    size = 0
    for value in row:
        if value is None:
            continue
        length = len(str(value))
        if length > TABULAR_MAX_CELL_CHARS:
            raise ValueError(f"{source} cell exceeds the {TABULAR_MAX_CELL_CHARS}-character parser limit.")
        size += length
        if size > TABULAR_MAX_ROW_CHARS:
            raise ValueError(f"{source} row exceeds the {TABULAR_MAX_ROW_CHARS}-character parser limit.")
    return size


def _frame_text_size(frame, source):
    return sum(_check_tabular_row(row, source) for row in frame.itertuples(index=False, name=None))


def _preflight_delimited(content, file_path, separator):
    with _CSV_FIELD_LIMIT_LOCK:
        previous = csv.field_size_limit()
        csv.field_size_limit(TABULAR_MAX_CELL_CHARS)
        try:
            stream = open(file_path, "r", encoding="utf-8-sig", newline="") if file_path and os.path.exists(file_path) else io.TextIOWrapper(io.BytesIO(content), encoding="utf-8-sig", newline="")
            with stream:
                for row in csv.reader(stream, delimiter=separator):
                    _check_tabular_row(row, "CSV/TSV")
        except csv.Error as error:
            raise ValueError(f"CSV/TSV cell exceeds the {TABULAR_MAX_CELL_CHARS}-character parser limit or has invalid quoting.") from error
        finally:
            csv.field_size_limit(previous)

_FIGURE_VISION_PROMPT = (
    "Describe this figure, chart, table, or diagram concisely in Markdown: "
    "extract any visible text, labels, axis values, and data points. "
    "If it is a purely decorative image with no informational content, respond with an empty string."
)

def extract_tables_from_page(page: pymupdf.Page) -> Tuple[List[str], List[Any]]:
    """Extracts tables natively from a PDF page and converts them to formatted Markdown tables via tabulate."""
    md_tables: List[str] = []
    table_rects: List[Any] = []
    try:
        tabs = page.find_tables()
        if tabs and tabs.tables:
            for tab in tabs.tables:
                table_rects.append(tab.bbox)
                try:
                    df = tab.to_pandas()
                    if df is not None and not df.empty:
                        df.columns = [str(c).replace("\n", " ").strip() if str(c).strip() else f"Col {i+1}" for i, c in enumerate(df.columns)]
                        md_table = df.to_markdown(tablefmt="pipe", index=False)
                        if md_table:
                            md_tables.append("\n" + md_table + "\n")
                            continue
                except Exception:
                    pass

                rows = tab.extract()
                if not rows or len(rows) < 1:
                    continue

                clean_rows = []
                for r in rows:
                    if r and any(cell and str(cell).strip() for cell in r):
                        clean_rows.append([str(c or '').replace('|', '\\|').replace('\n', ' ').strip() for c in r])

                if not clean_rows:
                    continue

                headers = clean_rows[0]
                safe_headers = [h if h else f"Col {i+1}" for i, h in enumerate(headers)]
                df_fallback = pd.DataFrame(clean_rows[1:], columns=safe_headers)
                md_fallback = df_fallback.to_markdown(tablefmt="pipe", index=False)
                if md_fallback:
                    md_tables.append("\n" + md_fallback + "\n")
    except Exception as e:
        logger.debug(f"Table detection skipped or not supported on page: {e}")

    return md_tables, table_rects

from sidecar.domain.llm_normalizer import normalize_page_markdown_with_llm, NormalizationReviewRequired


def assemble_document_markdown(filename: str, page_blocks: List[Tuple[int, str]]) -> str:
    sections = [f"## Page {page}\n\n{text}" for page, text in page_blocks]
    return f"# {filename}\n\n" + "\n\n".join(sections)


def raise_normalization_review_if_needed(filename: str, work_items: List[Dict[str, Any]]) -> None:
    issues = [issue for item in work_items for issue in item.get("normalization_issues", [])]
    if issues:
        original = assemble_document_markdown(filename, [
            (item["page_num"], item["original_markdown"]) for item in work_items
        ])
        raise NormalizationReviewRequired(original, issues)

def run_page_ocr(
    image_bytes: bytes,
    vision_model: Optional[str] = None,
    vision_prompt: Optional[str] = None,
    filename: str = "",
    page_num: int = 1,
    num_pages: int = 1,
    active_page_content: str = "",
    num_ctx: Optional[int] = None
) -> str:
    """
    Routes one page/image bitmap to the OCR engine the user selected.

    A non-empty `vision_prompt` means the multimodal Vision LLM engine was chosen
    (`AppSettings.ocrEngine === 'vision_model'`); RapidOCR then stays as the safety net, because a
    vision call returns an empty string on a missing model, a timeout or a refusal, and a page must
    never be silently dropped over that.
    """
    if is_vision_ocr_requested(vision_prompt):
        prompt = render_vision_prompt(vision_prompt, filename, page_num, num_pages, active_page_content)
        vision_kwargs = {
            "ollama_url": OLLAMA_BASE_URL,
            "model": vision_model or "llama3.2-vision",
        }
        if num_ctx is not None:
            vision_kwargs["num_ctx"] = num_ctx
        vision_text = run_vision_ocr(image_bytes, prompt, **vision_kwargs)
        if vision_text.strip():
            return vision_text
        logger.warning(f"Vision OCR yielded no content on page {page_num}; falling back to RapidOCR.")

    return run_layout_ocr(image_bytes)

def prepare_pdf_page_work_item(
    doc: pymupdf.Document,
    page: pymupdf.Page,
    page_num: int,
    raw_text: str,
    md_tables: List[str],
    used_ocr: bool,
    vision_model: Optional[str] = None,
    vision_prompt: Optional[str] = None,
    normalize_with_llm: bool = False,
    normalization_model: Optional[str] = None,
    normalization_think: bool = False,
    filename: str = "",
    num_pages: int = 1,
    num_ctx: Optional[int] = None,
    **kwargs: Any
) -> Dict[str, Any]:
    """
    Sequential, PyMuPDF-bound preparation step for a single PDF page: renders the page image for
    OCR (if used_ocr or native text is sparse). Must run on the thread that owns doc/page.
    """
    ocr_image_bytes: Optional[bytes] = None
    if used_ocr or len(raw_text.strip()) == 0:
        try:
            pix = page.get_pixmap(dpi=250)
            ocr_image_bytes = pix.tobytes("png")
        except Exception as pix_err:
            logger.debug(f"Pixmap generation skipped on page {page_num}: {pix_err}")

    return {
        "page_num": page_num,
        "raw_text": raw_text,
        "md_tables": md_tables,
        "used_ocr": used_ocr,
        "ocr_image_bytes": ocr_image_bytes,
        "vision_model": vision_model,
        "vision_prompt": vision_prompt,
        "normalize_with_llm": normalize_with_llm,
        "normalization_model": normalization_model,
        "normalization_think": normalization_think,
        "filename": filename,
        "num_pages": num_pages,
        "num_ctx": num_ctx,
    }

def _ocr_work_item_image(work_item: Dict[str, Any], active_page_content: str = "") -> str:
    """Unpacks a prepared work item onto `run_page_ocr`."""
    return run_page_ocr(
        work_item["ocr_image_bytes"],
        vision_model=work_item.get("vision_model"),
        vision_prompt=work_item.get("vision_prompt"),
        filename=work_item.get("filename", ""),
        page_num=work_item["page_num"],
        num_pages=work_item.get("num_pages", 1),
        active_page_content=active_page_content,
        num_ctx=work_item.get("num_ctx")
    )

def render_prepared_pdf_page(work_item: Dict[str, Any]) -> Tuple[int, str]:
    """
    Renders a single prepared page: runs the selected OCR engine (see `run_page_ocr`) on
    scanned/bitmap pages, or formats native text/tables. Applies optional LLM Markdown
    normalization only if explicitly requested.
    """
    page_num = work_item["page_num"]
    page_md_parts: List[str] = []

    if work_item["used_ocr"] and work_item.get("ocr_image_bytes"):
        ocr_result = _ocr_work_item_image(work_item, active_page_content=work_item.get("raw_text", ""))
        if ocr_result.strip():
            page_md_parts.append(ocr_result.strip())
        else:
            page_md_parts.append("[Scanned page - No readable text detected]")
    else:
        native_text = (work_item.get("raw_text") or "").strip()
        if native_text:
            page_md_parts.append(native_text)
        if work_item.get("md_tables"):
            page_md_parts.extend(work_item["md_tables"])

        # Fallback for scanned pages where native text layer was empty
        if not native_text and not work_item.get("md_tables") and work_item.get("ocr_image_bytes"):
            ocr_result = _ocr_work_item_image(work_item)
            if ocr_result.strip():
                page_md_parts.append(ocr_result.strip())

    page_content = "\n\n".join(page_md_parts).strip()
    if not page_content:
        page_content = "[Empty Page Content]"

    sanitized = sanitize_extracted_text(page_content)

    work_item["original_markdown"] = sanitized
    if work_item.get("normalize_with_llm"):
        try:
            sanitized = normalize_page_markdown_with_llm(
                sanitized,
                page_num=page_num,
                model=work_item.get("normalization_model"),
                think=bool(work_item.get("normalization_think")),
                num_ctx=work_item.get("num_ctx"),
            )
        except NormalizationReviewRequired as review:
            work_item["normalization_issues"] = review.issues

    return page_num, sanitized

def extract_pdf_document(
    doc: pymupdf.Document,
    progress_callback: Optional[Callable[[int, int, str], None]] = None,
    vision_model: Optional[str] = None,
    vision_prompt: Optional[str] = None,
    normalize_with_llm: bool = False,
    normalization_model: Optional[str] = None,
    normalization_think: bool = False,
    filename: str = "",
    num_ctx: Optional[int] = None
) -> List[Tuple[int, str]]:
    """
    Extracts markdown per page preserving layout, native tables, and high-fidelity OCR.
    PyMuPDF access happens sequentially; OCR rendering runs concurrently in a bounded thread pool.
    """
    num_pages = len(doc)
    work_items: List[Dict[str, Any]] = []

    for page_idx in range(num_pages):
        page_num = page_idx + 1
        page = doc.load_page(page_idx)

        struct_info = analyze_pdf_page_structure(page)
        strategy = struct_info.get("strategy")

        md_tables, _ = extract_tables_from_page(page)
        table_info = f" (trovate {len(md_tables)} tabelle)" if md_tables else ""

        if progress_callback:
            progress_callback(
                page_num,
                num_pages,
                f"Elaborazione pagina {page_num}/{num_pages}{table_info}..."
            )

        raw_text = page.get_text("text").strip()
        used_ocr = strategy == PageRoutingStrategy.OCR_REQUIRED

        if used_ocr and progress_callback:
            progress_callback(page_num, num_pages, f"Pagina {page_num}/{num_pages}: Esecuzione OCR Layout...")

        work_items.append(prepare_pdf_page_work_item(
            doc, page, page_num, raw_text, md_tables, used_ocr,
            vision_model=vision_model,
            vision_prompt=vision_prompt,
            normalize_with_llm=normalize_with_llm,
            normalization_model=normalization_model,
            normalization_think=normalization_think,
            filename=filename,
            num_pages=num_pages,
            num_ctx=num_ctx
        ))

    with ThreadPoolExecutor(max_workers=min(PDF_PAGE_RENDER_CONCURRENCY, max(1, len(work_items)))) as executor:
        results = list(executor.map(render_prepared_pdf_page, work_items))

    raise_normalization_review_if_needed(filename, work_items)
    return results

def _extract_full_format_excel_sheet(sheet_name, rows, max_row, max_column, limit_rows):
    retained = []
    columns = []
    seen_columns = set()
    omitted_columns = set()
    nonempty_rows = 0
    shortened_cells = 0
    for row_number, row in rows:
        _check_tabular_row(row, "Excel", max_columns=None)
        if row_number > max_row:
            raise ValueError(f"Excel row {row_number} exceeds the format limit of {max_row}.")
        selected = {"Row": row_number}
        has_value = False
        for column_number, value in enumerate(row, start=1):
            if column_number > max_column:
                raise ValueError(f"Excel column {column_number} exceeds the format limit of {max_column}.")
            if value is None or value == "":
                continue
            has_value = True
            if column_number not in seen_columns:
                seen_columns.add(column_number)
                if nonempty_rows < limit_rows and len(columns) < EXCEL_RAG_MAX_COLUMNS:
                    columns.append(column_number)
                else:
                    omitted_columns.add(column_number)
            if nonempty_rows < limit_rows and column_number in columns:
                cell = str(value)
                if len(cell) > EXCEL_RAG_MAX_CELL_CHARS:
                    cell = cell[:EXCEL_RAG_MAX_CELL_CHARS]
                    shortened_cells += 1
                selected[f"Col {column_number}"] = cell
        if has_value:
            nonempty_rows += 1
            if len(retained) < limit_rows:
                retained.append(selected)
    if not retained:
        return None
    frame = pd.DataFrame(retained, columns=["Row", *(f"Col {column}" for column in columns)]).fillna("")
    result = f"### Foglio: {sheet_name}\n\n{frame.to_markdown(tablefmt='pipe', index=False, disable_numparse=True)}"
    result += (f"\n\n> [!NOTE]\n> Estratto RAG: prime {len(retained)} righe non vuote su {nonempty_rows}; "
               f"prime {len(columns)} colonne non vuote su {len(seen_columns)}. "
               "Row e Col indicano le coordinate originali. Il file originale è conservato.")
    if omitted_columns:
        result += f"\n> Colonne omesse dall'estratto: {len(omitted_columns)}."
    if shortened_cells:
        result += f"\n> Celle abbreviate a {EXCEL_RAG_MAX_CELL_CHARS} caratteri: {shortened_cells}."
    return result


def _xls_rows(sheet, datemode):
    from xlrd import XL_CELL_DATE, xldate_as_datetime

    for row_number in range(sheet.nrows):
        yield row_number + 1, [
            xldate_as_datetime(cell.value, datemode) if cell.ctype == XL_CELL_DATE else cell.value
            for cell in sheet.row(row_number)
        ]


def extract_tabular_document(
    filename: str,
    content: bytes,
    file_path: Optional[str],
    max_rows: Optional[int] = None,
    max_excel_rows: Optional[int] = None,
    max_sheets: Optional[int] = None,
    num_ctx: Optional[int] = None,
    allow_full_excel_format: bool = False,
) -> List[Tuple[int, str]]:
    """Extracts CSV, TSV, XLSX, XLS, Parquet, and JSON data formatted cleanly into Markdown tables with truncation tracking."""
    ext = os.path.splitext(filename)[1].lower()
    text_content = ""
    limit_csv_rows = max_rows or TABULAR_MAX_ROWS
    limit_excel_rows = max_excel_rows or EXCEL_MAX_ROWS_PER_SHEET
    limit_sheets = max_sheets or EXCEL_MAX_SHEETS

    # Keep every source cell, including a header-only or single-cell sheet.
    if ext == ".xlsx":
        from openpyxl import load_workbook

        excel_source = file_path if (file_path and os.path.exists(file_path)) else io.BytesIO(content)
        with zipfile.ZipFile(excel_source) as archive:
            entries = archive.infolist()
            if len(entries) > 4096:
                raise ValueError("XLSX archive exceeds the 4,096-entry parser limit.")
            shared_strings_size = sum(
                entry.file_size for entry in entries
                if entry.filename.rsplit("/", 1)[-1].lower() == "sharedstrings.xml"
            )
            xml_size = sum(entry.file_size for entry in entries if entry.filename.lower().startswith("xl/") and entry.filename.lower().endswith(".xml"))
            worksheet_sizes = [entry.file_size for entry in entries if entry.filename.lower().startswith("xl/worksheets/") and entry.filename.lower().endswith(".xml")]
        if shared_strings_size > XLSX_MAX_XML_BYTES or any(size > XLSX_MAX_XML_BYTES for size in worksheet_sizes) or xml_size > XLSX_MAX_TOTAL_XML_BYTES:
            raise ValueError("XLSX XML payload exceeds the parser limit; export as CSV.")
        if not allow_full_excel_format and shared_strings_size > XLSX_MAX_SHARED_STRINGS_BYTES:
            raise ValueError("XLSX shared strings exceed the 16 MiB parser limit; export as CSV.")
        workbook = load_workbook(excel_source, read_only=True, data_only=True)
        try:
            sheets_output = []
            skipped_sheets = 0
            sheet_names = workbook.sheetnames
            processed_sheets = sheet_names[:limit_sheets]
            for sheet_name in processed_sheets:
                sheet = workbook[sheet_name]
                sheet.reset_dimensions()
                if allow_full_excel_format:
                    sheet_md = _extract_full_format_excel_sheet(
                        sheet_name,
                        enumerate(sheet.iter_rows(values_only=True), start=1),
                        1_048_576, 16_384, min(limit_excel_rows, EXCEL_MAX_ROWS_PER_SHEET),
                    )
                    if sheet_md:
                        sheets_output.append(sheet_md)
                    else:
                        skipped_sheets += 1
                    continue
                retained_rows = []
                last_data_row = 0
                retained_chars = 0
                for row_number, row in enumerate(sheet.iter_rows(values_only=True), start=1):
                    row_chars = _check_tabular_row(row, "Excel")
                    if any(cell is not None and cell != "" for cell in row):
                        last_data_row = row_number
                    if row_number <= limit_excel_rows:
                        retained_chars += row_chars
                        if retained_chars > TABULAR_MAX_RENDER_CHARS:
                            raise ValueError("Excel selected cells exceed the parser render limit.")
                        retained_rows.append(row)
                retained_rows = retained_rows[:min(last_data_row, limit_excel_rows)]
                if not retained_rows:
                    skipped_sheets += 1
                    continue
                df = pd.DataFrame(retained_rows).fillna("")
                if not any(str(cell).strip() for cell in df.to_numpy().flat):
                    skipped_sheets += 1
                    continue
                df.columns = [f"Col {i+1}" for i in range(len(df.columns))]
                md_table = df.to_markdown(tablefmt="pipe", index=False, disable_numparse=True) or ""
                sheet_md = f"### Foglio: {sheet_name}\n\n{md_table}"
                if last_data_row > limit_excel_rows:
                    sheet_md += f"\n\n> [!NOTE]\n> Tabella troncata a {limit_excel_rows} righe (su {last_data_row} totali nel foglio '{sheet_name}').\n"
                sheets_output.append(sheet_md)
            if not sheets_output:
                raise ValueError("Excel extraction produced no readable cells in the selected sheets.")
            combined_excel_md = "\n\n".join(sheets_output)
            if skipped_sheets:
                combined_excel_md += f"\n\n> [!NOTE]\n> Fogli selezionati senza celle leggibili nel limite di righe: {skipped_sheets}.\n"
            if len(sheet_names) > limit_sheets:
                combined_excel_md += f"\n\n> [!NOTE]\n> Mostrati i primi {len(processed_sheets)} fogli su {len(sheet_names)} totali nella cartella Excel.\n"
            return [(1, combined_excel_md)]
        finally:
            workbook.close()

    if ext == ".xls":
        xls_size = os.path.getsize(file_path) if file_path and os.path.exists(file_path) else len(content)
        if not allow_full_excel_format and xls_size > XLS_MAX_SOURCE_BYTES:
            raise ValueError("XLS source exceeds the 8 MiB parser limit; export as XLSX or CSV.")
        excel_source = file_path if (file_path and os.path.exists(file_path)) else io.BytesIO(content)
        with pd.ExcelFile(excel_source, engine="xlrd", engine_kwargs={"on_demand": True}) as xls:
            sheets_output = []
            skipped_sheets = 0
            total_sheets_count = len(xls.sheet_names)
            processed_sheets = xls.sheet_names[:limit_sheets]

            for sheet_name in processed_sheets:
                if allow_full_excel_format:
                    sheet = xls.book.sheet_by_name(sheet_name)
                    try:
                        if sheet.nrows > 65_536 or sheet.ncols > 256:
                            raise ValueError("XLS worksheet exceeds the 65,536-row or 256-column format limit.")
                        sheet_md = _extract_full_format_excel_sheet(
                            sheet_name,
                            _xls_rows(sheet, xls.book.datemode),
                            65_536, 256, min(limit_excel_rows, EXCEL_MAX_ROWS_PER_SHEET),
                        )
                        if sheet_md:
                            sheets_output.append(sheet_md)
                        else:
                            skipped_sheets += 1
                    finally:
                        xls.book.unload_sheet(sheet_name)
                    continue
                sheet = xls.book.sheet_by_name(sheet_name)
                try:
                    if sheet.ncols > TABULAR_MAX_COLUMNS:
                        raise ValueError(f"Excel exceeds the {TABULAR_MAX_COLUMNS}-column parser limit.")
                    retained_rows = []
                    total_sheet_rows = 0
                    retained_chars = 0
                    for row_number, row in _xls_rows(sheet, xls.book.datemode):
                        row_chars = _check_tabular_row(row, "Excel")
                        if any(cell is not None and cell != "" for cell in row):
                            total_sheet_rows = row_number
                        if row_number <= limit_excel_rows:
                            retained_chars += row_chars
                            if retained_chars > TABULAR_MAX_RENDER_CHARS:
                                raise ValueError("Excel selected cells exceed the parser render limit.")
                            retained_rows.append(row)
                finally:
                    xls.book.unload_sheet(sheet_name)
                retained_rows = retained_rows[:min(total_sheet_rows, limit_excel_rows)]
                if not retained_rows:
                    skipped_sheets += 1
                    continue
                df = pd.DataFrame(retained_rows).fillna("")
                if not any(str(cell).strip() for cell in df.to_numpy().flat):
                    skipped_sheets += 1
                    continue
                df.columns = [f"Col {i+1}" for i in range(len(df.columns))]
                md_table = df.to_markdown(tablefmt="pipe", index=False, disable_numparse=True) or ""

                sheet_md = f"### Foglio: {sheet_name}\n\n{md_table}"
                if total_sheet_rows > limit_excel_rows:
                    sheet_md += f"\n\n> [!NOTE]\n> Tabella troncata a {limit_excel_rows} righe (su {total_sheet_rows} totali nel foglio '{sheet_name}').\n"
                sheets_output.append(sheet_md)

            if not sheets_output:
                raise ValueError("Excel extraction produced no readable cells in the selected sheets.")

            combined_excel_md = "\n\n".join(sheets_output)
            if skipped_sheets:
                combined_excel_md += f"\n\n> [!NOTE]\n> Fogli selezionati senza celle leggibili nel limite di righe: {skipped_sheets}.\n"
            if total_sheets_count > limit_sheets:
                combined_excel_md += f"\n\n> [!NOTE]\n> Mostrati i primi {len(processed_sheets)} fogli su {total_sheets_count} totali nella cartella Excel.\n"

            return [(1, combined_excel_md)]

    if ext == ".parquet":
        import pyarrow.parquet as parquet

        parquet_source = file_path if (file_path and os.path.exists(file_path)) else io.BytesIO(content)
        parquet_file = parquet.ParquetFile(parquet_source, pre_buffer=False)
        try:
            total_rows = parquet_file.metadata.num_rows
            if parquet_file.metadata.num_columns > TABULAR_MAX_COLUMNS:
                raise ValueError(f"Parquet exceeds the {TABULAR_MAX_COLUMNS}-column parser limit.")
            _check_tabular_row(parquet_file.schema_arrow.names, "Parquet")
            for group_index in range(parquet_file.metadata.num_row_groups):
                if parquet_file.metadata.row_group(group_index).total_byte_size > PARQUET_MAX_ROW_GROUP_BYTES:
                    raise ValueError("Parquet row group exceeds the parser memory limit.")
            retained = []
            observed_rows = 0
            retained_chars = 0
            for batch in parquet_file.iter_batches(batch_size=64, use_threads=False):
                if batch.nbytes > PARQUET_MAX_BATCH_BYTES:
                    raise ValueError("Parquet batch exceeds the parser memory limit.")
                if observed_rows < limit_csv_rows:
                    selected = batch.slice(0, limit_csv_rows - observed_rows).to_pandas()
                    retained_chars += _frame_text_size(selected, "Parquet")
                    if retained_chars > TABULAR_MAX_RENDER_CHARS:
                        raise ValueError("Parquet selected cells exceed the parser render limit.")
                    retained.append(selected)
                observed_rows += batch.num_rows
            if observed_rows != total_rows:
                raise ValueError("Parquet row count differs from file metadata.")
            df = pd.concat(retained, ignore_index=True) if retained else pd.DataFrame(columns=parquet_file.schema_arrow.names)
        finally:
            parquet_file.close()
        if df.empty or df.replace(r"^\s*$", pd.NA, regex=True).dropna(how="all").empty:
            raise ValueError("Parquet extraction produced no readable values.")
        md_table = df.to_markdown(tablefmt="pipe", index=False, disable_numparse=True) or ""
        if total_rows > limit_csv_rows:
            md_table += f"\n\n> [!NOTE]\n> Tabella troncata a {limit_csv_rows} righe (su {total_rows} totali nel file).\n"
        return [(1, md_table)]

    # CSV / TSV
    if ext in [".csv", ".tsv"]:
        csv_source = file_path if (file_path and os.path.exists(file_path)) else io.BytesIO(content)
        sep = "\t" if ext == ".tsv" else ","
        _preflight_delimited(content, file_path, sep)
        # Preserve literal cells through parsing and Markdown rendering.
        with warnings.catch_warnings():
            warnings.simplefilter("error", pd.errors.ParserWarning)
            with pd.read_csv(csv_source, sep=sep, dtype=str, keep_default_na=False, on_bad_lines="error", index_col=False, skip_blank_lines=False, chunksize=256) as reader:
                df = reader.read(0)
                retained = []
                total_csv_rows = 0
                retained_chars = sum(len(str(column)) for column in df.columns)
                for chunk in reader:
                    if total_csv_rows < limit_csv_rows:
                        selected = chunk.head(limit_csv_rows - total_csv_rows)
                        retained_chars += _frame_text_size(selected, "CSV/TSV")
                        if retained_chars > TABULAR_MAX_RENDER_CHARS:
                            raise ValueError("CSV/TSV selected cells exceed the parser render limit.")
                        retained.append(selected)
                    total_csv_rows += len(chunk)
                if retained:
                    df = pd.concat(retained, ignore_index=True)
        df.columns = [str(c).replace("\n", " ").strip() if str(c).strip() else f"Col {i+1}" for i, c in enumerate(df.columns)]
        md_table = df.to_markdown(tablefmt="pipe", index=False, disable_numparse=True) or ""

        if total_csv_rows > limit_csv_rows:
            md_table += f"\n\n> [!NOTE]\n> Tabella troncata a {limit_csv_rows} righe (su {total_csv_rows} totali nel file).\n"

        return [(1, md_table)]

    # JSON formatted
    if ext == ".json":
        try:
            if file_path and os.path.exists(file_path):
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    text_content = f.read()
            else:
                text_content = content.decode("utf-8", errors="ignore")
            data = json.loads(text_content)
            pretty_json = json.dumps(data, indent=2, ensure_ascii=False)
            return [(1, f"```json\n{pretty_json}\n```")]
        except Exception:
            pass

    return [(1, text_content.strip())]

def extract_document_markdown(
    filename: str,
    content: bytes,
    file_path: Optional[str] = None,
    progress_callback: Optional[Callable[[int, int, str], None]] = None,
    vision_model: Optional[str] = None,
    vision_prompt: Optional[str] = None,
    normalize_with_llm: bool = False,
    normalization_model: Optional[str] = None,
    normalization_think: bool = False,
    max_tabular_rows: Optional[int] = None,
    max_excel_rows: Optional[int] = None,
    max_sheets: Optional[int] = None,
    num_ctx: Optional[int] = None,
    original_pages: Optional[List[Tuple[int, str]]] = None,
    allow_full_excel_format: bool = False,
) -> Tuple[str, int]:
    """Fast-routed, sanitized, and pagination-preserving document markdown extractor with progress callback."""
    category = classify_file_type(filename)
    num_pages = 1
    page_blocks: List[Tuple[int, str]] = []

    if category == DocumentCategory.PDF:
        if file_path and os.path.exists(file_path):
            pdf_doc = pymupdf.open(file_path)
        else:
            pdf_doc = pymupdf.open(stream=content, filetype="pdf")

        if pdf_doc.needs_pass != 0 or (pdf_doc.is_encrypted and pdf_doc.needs_pass):
            pdf_doc.close()
            raise ValueError("Documento protetto da password: il file PDF è crittografato e richiede una password per l'apertura.")

        try:
            num_pages = len(pdf_doc)
            page_blocks = extract_pdf_document(
                pdf_doc,
                progress_callback=progress_callback,
                vision_model=vision_model,
                vision_prompt=vision_prompt,
                normalize_with_llm=normalize_with_llm,
                normalization_model=normalization_model,
                normalization_think=normalization_think,
                filename=filename,
                num_ctx=num_ctx
            )
        finally:
            pdf_doc.close()

    elif category == DocumentCategory.IMAGE:
        if progress_callback:
            progress_callback(1, 1, "Esecuzione OCR su immagine...")
        img_bytes = content
        if file_path and os.path.exists(file_path):
            with open(file_path, "rb") as f:
                img_bytes = f.read()
        ocr_text = run_page_ocr(
            img_bytes,
            vision_model=vision_model,
            vision_prompt=vision_prompt,
            filename=filename,
            num_ctx=num_ctx
        )
        sanitized_ocr = sanitize_extracted_text(ocr_text)
        if original_pages is not None:
            original_pages.append((1, sanitized_ocr))
        if normalize_with_llm and sanitized_ocr:
            try:
                sanitized_ocr = normalize_page_markdown_with_llm(
                    sanitized_ocr,
                    page_num=1,
                    model=normalization_model,
                    think=normalization_think,
                    num_ctx=num_ctx,
                )
            except NormalizationReviewRequired as review:
                raise NormalizationReviewRequired(
                    assemble_document_markdown(filename, [(1, sanitized_ocr)]), review.issues,
                ) from None
        if sanitized_ocr:
            page_blocks.append((1, sanitized_ocr))
        else:
            page_blocks.append((1, f"[Image file {filename} scanned - No text detected]"))

    elif category == DocumentCategory.DOCX:
        if progress_callback:
            progress_callback(1, 1, "Estrazione struttura XML, tabelle e immagini DOCX...")
        try:
            import docx
            # Check for EncryptedPackage OLE header
            if file_path and os.path.exists(file_path):
                with open(file_path, "rb") as f:
                    hdr = f.read(2048)
            else:
                hdr = content[:2048]

            if hdr.startswith(b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1') and (b'EncryptedPackage' in hdr or b'EncryptionInfo' in hdr):
                raise ValueError("Documento protetto da password: il file Word (DOCX) è crittografato e richiede una password.")

            if file_path and os.path.exists(file_path):
                doc = docx.Document(file_path)
            else:
                doc = docx.Document(io.BytesIO(content))

            docx_blocks: List[str] = []
            for para in doc.paragraphs:
                p_text = para.text.strip()
                if not p_text:
                    continue
                style_name = (para.style.name if para.style else "").lower()
                if "heading 1" in style_name:
                    docx_blocks.append(f"# {p_text}")
                elif "heading 2" in style_name:
                    docx_blocks.append(f"## {p_text}")
                elif "heading 3" in style_name:
                    docx_blocks.append(f"### {p_text}")
                else:
                    docx_blocks.append(p_text)

            for table in doc.tables:
                table_md_lines: List[str] = []
                headers_done = False
                for row in table.rows:
                    row_cells = [cell.text.strip().replace("\n", " ") for cell in row.cells]
                    if not any(row_cells):
                        continue
                    table_md_lines.append("| " + " | ".join(row_cells) + " |")
                    if not headers_done:
                        table_md_lines.append("| " + " | ".join(["---"] * len(row_cells)) + " |")
                        headers_done = True
                if table_md_lines:
                    docx_blocks.append("\n" + "\n".join(table_md_lines) + "\n")

            # Extract embedded images from docx package and run RapidOCR
            try:
                docx_zip_source = file_path if (file_path and os.path.exists(file_path)) else io.BytesIO(content)
                with zipfile.ZipFile(docx_zip_source, "r") as z:
                    image_names = sorted([n for n in z.namelist() if n.startswith("word/media/") and any(n.lower().endswith(im_ext) for im_ext in [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff"])])
                    img_idx = 1
                    for img_name in image_names:
                        img_data = z.read(img_name)
                        if len(img_data) >= 1500:  # Skip tiny icons or empty placeholder graphics
                            ocr_text = run_page_ocr(
                                img_data,
                                vision_model=vision_model,
                                vision_prompt=vision_prompt,
                                filename=filename,
                                num_ctx=num_ctx
                            )
                            clean_ocr = sanitize_extracted_text(ocr_text)
                            if clean_ocr and clean_ocr not in ("[Empty Page Content]", "[Scanned page - No readable text detected]"):
                                docx_blocks.append(f"### Immagine DOCX {img_idx} (Testo rilevato da OCR)\n\n{clean_ocr}")
                                img_idx += 1
            except Exception as zip_err:
                logger.debug(f"DOCX media image extraction skipped for {filename}: {zip_err}")

            if docx_blocks:
                page_blocks.append((1, sanitize_extracted_text("\n\n".join(docx_blocks))))
        except Exception as docx_err:
            logger.warning(f"python-docx parse error for {filename}: {docx_err}")

    elif category == DocumentCategory.TABULAR:
        if progress_callback:
            progress_callback(1, 1, "Parsing matriciale e formattazione tabella Markdown...")
        page_blocks = extract_tabular_document(
            filename,
            content,
            file_path,
            max_rows=max_tabular_rows,
            max_excel_rows=max_excel_rows,
            max_sheets=max_sheets,
            allow_full_excel_format=allow_full_excel_format,
        )

    # Fallback to UTF-8 text read
    if not page_blocks:
        if progress_callback:
            progress_callback(1, 1, "Lettura e sanitizzazione flusso testuale...")
        try:
            if file_path and os.path.exists(file_path):
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    raw_str = f.read()
            else:
                raw_str = content.decode("utf-8", errors="ignore")
            page_blocks.append((1, sanitize_extracted_text(raw_str)))
        except Exception:
            page_blocks.append((1, "[Binary content processed]"))

    full_markdown = assemble_document_markdown(filename, page_blocks)
    if original_pages is not None and not original_pages:
        original_pages.extend(page_blocks)
    return full_markdown, max(1, num_pages)

def _split_oversized_text(text: str, max_chars: int = 1000, overlap: int = 100) -> List[str]:
    """Splits a single oversized paragraph or text block at whitespace or sentence boundaries."""
    if len(text) <= max_chars:
        return [text]
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        if end < len(text):
            # Look for sentence or whitespace boundary
            boundary = max(text.rfind('. ', start, end), text.rfind('\n', start, end), text.rfind(' ', start, end))
            if boundary > start + (max_chars // 2):
                end = boundary + 1
        chunks.append(text[start:end].strip())
        start = end - overlap if end < len(text) else end
    return [c for c in chunks if c]

def create_semantic_chunks(filename: str, full_markdown: str) -> List[Tuple[int, str, str]]:
    """
    Header-Aware Semantic Chunking:
    Preserves Markdown structural hierarchy, section context prefixes, and code blocks.
    Returns list of (chunk_index, chunk_text, section_header).
    """
    raw_chunks: List[Tuple[int, str, str]] = []
    header_path: List[str] = [filename]
    chunk_index = 0
    current_buffer: List[str] = []
    in_code_block = False

    def _flush_buffer():
        nonlocal chunk_index, current_buffer
        if not current_buffer:
            return
        curr_section_header = ' > '.join([h for h in header_path if h])
        context_prefix = f"[Document: {filename} | Section: {curr_section_header}]\n"
        buf_text = "\n".join(current_buffer).strip()
        current_buffer = []
        if not buf_text:
            return

        if len(buf_text) > 800:
            pieces = _split_oversized_text(buf_text, max_chars=800, overlap=100)
            for p in pieces:
                if p.strip():
                    raw_chunks.append((chunk_index, context_prefix + p.strip(), curr_section_header))
                    chunk_index += 1
        else:
            raw_chunks.append((chunk_index, context_prefix + buf_text, curr_section_header))
            chunk_index += 1

    lines = full_markdown.splitlines()
    for line in lines:
        stripped_line = line.strip()

        if stripped_line.startswith("```"):
            in_code_block = not in_code_block

        if not in_code_block and stripped_line.startswith("#"):
            header_match = re.match(r'^(#+)\s+(.+)$', stripped_line)
            if header_match:
                _flush_buffer()
                level = len(header_match.group(1))
                h_text = header_match.group(2).strip()
                header_path = header_path[:level]
                if len(header_path) < level:
                    header_path.extend([""] * (level - len(header_path)))
                header_path = header_path[:level-1] + [h_text]
                continue

        current_buffer.append(line)

    _flush_buffer()

    if not raw_chunks:
        fallback_text = full_markdown.strip() or f"# {filename}\n\nDocument content ingested."
        raw_chunks = [(0, f"[Document: {filename} | Section: Document Content]\n{fallback_text}", filename)]

    return raw_chunks
