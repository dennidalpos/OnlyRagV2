import os
import re
import io
import json
import csv
from typing import List, Tuple, Optional, Any, Callable
import pymupdf
from sidecar.config import logger
from sidecar.infrastructure.ocr import run_layout_ocr
from sidecar.domain.sanitizer import sanitize_extracted_text
from sidecar.domain.router import (
    classify_file_type,
    DocumentCategory,
    analyze_pdf_page_structure,
    PageRoutingStrategy
)

def extract_tables_from_page(page: pymupdf.Page) -> Tuple[List[str], List[Any]]:
    """Extracts tables natively from a PDF page and converts them to formatted Markdown tables."""
    md_tables: List[str] = []
    table_rects: List[Any] = []
    try:
        tabs = page.find_tables()
        if tabs and tabs.tables:
            for tab in tabs.tables:
                table_rects.append(tab.bbox)
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
                num_cols = max(1, len(headers))
                # Ensure headers are not all empty
                safe_headers = [h if h else f"Col {i+1}" for i, h in enumerate(headers)]
                md_lines = []
                md_lines.append("| " + " | ".join(safe_headers) + " |")
                md_lines.append("| " + " | ".join(["---"] * num_cols) + " |")
                for row in clean_rows[1:]:
                    padded = row + [""] * (num_cols - len(row))
                    md_lines.append("| " + " | ".join(padded[:num_cols]) + " |")

                md_tables.append("\n" + "\n".join(md_lines) + "\n")
    except Exception as e:
        logger.debug(f"Table detection skipped or not supported on page: {e}")

    return md_tables, table_rects

def extract_images_and_diagrams_from_page(doc: pymupdf.Document, page: pymupdf.Page, page_num: int) -> List[str]:
    """Identifies visual diagrams, charts, and figures on the page."""
    figure_notes: List[str] = []
    try:
        image_list = page.get_images(full=True)
        significant_images = [img for img in image_list if len(img) >= 4 and img[2] >= 100 and img[3] >= 100]
        if significant_images:
            for idx, img_info in enumerate(significant_images[:4]):
                width = img_info[2]
                height = img_info[3]
                figure_notes.append(f"> 📊 **[Figura / Diagramma {idx + 1} - Pagina {page_num}]** *(Risoluzione: {width}x{height}px)*")
    except Exception as img_err:
        logger.debug(f"Image extraction skipped on page {page_num}: {img_err}")

    return figure_notes

def extract_pdf_document(
    doc: pymupdf.Document,
    progress_callback: Optional[Callable[[int, int, str], None]] = None
) -> List[Tuple[int, str]]:
    """Extracts markdown per page preserving layout, native tables, OCR, and figure captions with live progress updates."""
    pages_output: List[Tuple[int, str]] = []
    num_pages = len(doc)

    for page_num in range(num_pages):
        page_idx = page_num + 1
        page = doc.load_page(page_num)
        page_md_parts: List[str] = []

        # Analyze structure with router
        struct_info = analyze_pdf_page_structure(page)

        # 1. Native table extraction
        md_tables, _ = extract_tables_from_page(page)
        table_info = f" (trovate {len(md_tables)} tabelle)" if md_tables else ""

        if progress_callback:
            progress_callback(
                page_idx,
                num_pages,
                f"Elaborazione pagina {page_idx}/{num_pages}{table_info}..."
            )

        # 2. Native text extraction
        raw_text = page.get_text("text").strip()

        # Route OCR if strategy requires or character count is too low
        if struct_info.get("strategy") == PageRoutingStrategy.OCR_REQUIRED or len(raw_text) < 40:
            if progress_callback:
                progress_callback(
                    page_idx,
                    num_pages,
                    f"Pagina {page_idx}/{num_pages}: Esecuzione OCR Layout..."
                )
            pix = page.get_pixmap(dpi=150)
            img_bytes = pix.tobytes("png")
            ocr_result = run_layout_ocr(img_bytes)
            if ocr_result.strip():
                page_md_parts.append(ocr_result.strip())
            else:
                page_md_parts.append("[Scanned page - No readable text extracted]")
        else:
            if md_tables:
                page_md_parts.append(raw_text)
                page_md_parts.extend(md_tables)
            else:
                page_md_parts.append(raw_text)

        # 3. Figure / Diagram annotations
        diagrams = extract_images_and_diagrams_from_page(doc, page, page_num + 1)
        if diagrams:
            page_md_parts.extend(diagrams)

        page_content = "\n\n".join(page_md_parts).strip()
        if not page_content:
            page_content = "[Empty Page Content]"

        pages_output.append((page_num + 1, sanitize_extracted_text(page_content)))

    return pages_output

def extract_tabular_document(filename: str, content: bytes, file_path: Optional[str]) -> List[Tuple[int, str]]:
    """Extracts CSV, TSV, XLSX, XLS, Parquet, and JSON data formatted cleanly into Markdown tables."""
    ext = os.path.splitext(filename)[1].lower()
    text_content = ""

    # Excel formats (.xlsx, .xls)
    if ext in [".xlsx", ".xls"]:
        try:
            import pandas as pd
            excel_source = file_path if (file_path and os.path.exists(file_path)) else io.BytesIO(content)
            xls = pd.ExcelFile(excel_source)
            sheets_output = []
            for sheet_name in xls.sheet_names[:10]:
                df = pd.read_excel(xls, sheet_name=sheet_name, nrows=150)
                if df.empty:
                    continue
                # Clean column headers
                df.columns = [str(c).replace("\n", " ").replace("|", "\\|").strip() for c in df.columns]
                # Convert to markdown
                headers = list(df.columns)
                md_lines = [f"### Sheet: {sheet_name}\n"]
                md_lines.append("| " + " | ".join(headers) + " |")
                md_lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
                for _, row in df.iterrows():
                    row_vals = [str(v).replace("\n", " ").replace("|", "\\|").strip() if pd.notna(v) else "" for v in row]
                    md_lines.append("| " + " | ".join(row_vals) + " |")
                sheets_output.append("\n".join(md_lines))

            if sheets_output:
                return [(1, "\n\n".join(sheets_output))]
        except Exception as excel_err:
            logger.warning(f"Excel parsing failed for {filename}: {excel_err}")

    # Parquet format
    elif ext == ".parquet":
        try:
            import pandas as pd
            parquet_source = file_path if (file_path and os.path.exists(file_path)) else io.BytesIO(content)
            df = pd.read_parquet(parquet_source)
            df_subset = df.head(150)
            headers = [str(c).replace("|", "\\|").strip() for c in df_subset.columns]
            md_lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join(["---"] * len(headers)) + " |"]
            for _, row in df_subset.iterrows():
                row_vals = [str(v).replace("\n", " ").replace("|", "\\|").strip() if pd.notna(v) else "" for v in row]
                md_lines.append("| " + " | ".join(row_vals) + " |")
            return [(1, "\n".join(md_lines))]
        except Exception as pq_err:
            logger.warning(f"Parquet parsing failed for {filename}: {pq_err}")

    if file_path and os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            text_content = f.read()
    else:
        text_content = content.decode("utf-8", errors="ignore")

    if ext in [".csv", ".tsv"]:
        delimiter = "\t" if ext == ".tsv" else ","
        try:
            reader = csv.reader(io.StringIO(text_content), delimiter=delimiter)
            rows = [r for r in reader if any(r)]
            if rows:
                md_lines = []
                headers = [h.replace("|", "\\|").replace("\n", " ").strip() for h in rows[0]]
                md_lines.append("| " + " | ".join(headers) + " |")
                md_lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
                for r in rows[1:150]:
                    padded = r + [""] * (len(headers) - len(r))
                    clean_row = [c.replace("|", "\\|").replace("\n", " ").strip() for c in padded[:len(headers)]]
                    md_lines.append("| " + " | ".join(clean_row) + " |")
                if len(rows) > 150:
                    md_lines.append(f"\n*... Total {len(rows)} rows tabular data extracted.*")
                return [(1, "\n".join(md_lines))]
        except Exception as e:
            logger.warning(f"Error parsing tabular file {filename}: {e}")

    elif ext == ".json":
        try:
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
    progress_callback: Optional[Callable[[int, int, str], None]] = None
) -> Tuple[str, int]:
    """Fast-routed, sanitized, and pagination-preserving document markdown extractor with progress callback."""
    category = classify_file_type(filename)
    num_pages = 1
    page_blocks: List[Tuple[int, str]] = []

    if category == DocumentCategory.PDF:
        try:
            if file_path and os.path.exists(file_path):
                pdf_doc = pymupdf.open(file_path)
            else:
                pdf_doc = pymupdf.open(stream=content, filetype="pdf")
            num_pages = len(pdf_doc)
            page_blocks = extract_pdf_document(pdf_doc, progress_callback=progress_callback)
            pdf_doc.close()
        except Exception as pdf_err:
            logger.warning(f"PyMuPDF parse error: {pdf_err}. Falling back to plain text read.")

    elif category == DocumentCategory.IMAGE:
        if progress_callback:
            progress_callback(1, 1, "Esecuzione Vision OCR su immagine...")
        img_bytes = content
        if file_path and os.path.exists(file_path):
            with open(file_path, "rb") as f:
                img_bytes = f.read()
        ocr_text = run_layout_ocr(img_bytes)
        sanitized_ocr = sanitize_extracted_text(ocr_text)
        if sanitized_ocr:
            page_blocks.append((1, sanitized_ocr))
        else:
            page_blocks.append((1, f"[Image file {filename} indexed for Vision inspection]"))

    elif category == DocumentCategory.DOCX:
        if progress_callback:
            progress_callback(1, 1, "Estrazione struttura XML e tabelle DOCX...")
        try:
            import docx
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

            if docx_blocks:
                page_blocks.append((1, sanitize_extracted_text("\n\n".join(docx_blocks))))
        except Exception as docx_err:
            logger.warning(f"python-docx parse error for {filename}: {docx_err}")

    elif category == DocumentCategory.TABULAR:
        if progress_callback:
            progress_callback(1, 1, "Parsing matriciale e formattazione tabella Markdown...")
        page_blocks = extract_tabular_document(filename, content, file_path)

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

    # Assemble strictly paginated Markdown document
    paginated_sections: List[str] = []
    for page_idx, p_text in page_blocks:
        paginated_sections.append(f"## Page {page_idx}\n\n{p_text}")

    full_markdown = f"# {filename}\n\n" + "\n\n".join(paginated_sections)
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
    """Header-Aware Semantic Chunking preserving Markdown structural integrity and returning (chunk_index, chunk_text, section_header)."""
    raw_chunks: List[Tuple[int, str, str]] = []
    header_path: List[str] = [filename]
    chunk_index = 0
    current_buffer = ""
    in_code_block = False

    lines = full_markdown.splitlines()
    for line in lines:
        stripped_line = line.strip()

        if stripped_line.startswith("```"):
            in_code_block = not in_code_block

        if not in_code_block and stripped_line.startswith("#"):
            header_match = re.match(r'^(#+)\s+(.+)$', stripped_line)
            if header_match:
                level = len(header_match.group(1))
                h_text = header_match.group(2).strip()
                header_path = header_path[:level]
                if len(header_path) < level:
                    header_path.extend([""] * (level - len(header_path)))
                header_path = header_path[:level-1] + [h_text]

        curr_section_header = ' > '.join([h for h in header_path if h])
        context_prefix = f"[{curr_section_header}]\n"

        # Check for individual oversized lines
        if len(line) > 1000 and not in_code_block:
            if current_buffer.strip():
                chunk_text = context_prefix + current_buffer.strip()
                raw_chunks.append((chunk_index, chunk_text, curr_section_header))
                chunk_index += 1
                current_buffer = ""
            sub_pieces = _split_oversized_text(line, max_chars=800, overlap=100)
            for piece in sub_pieces:
                raw_chunks.append((chunk_index, context_prefix + piece, curr_section_header))
                chunk_index += 1
            continue

        if len(current_buffer) + len(line) > 750 and not in_code_block and current_buffer.strip():
            chunk_text = context_prefix + current_buffer.strip()
            raw_chunks.append((chunk_index, chunk_text, curr_section_header))
            chunk_index += 1
            overlap = current_buffer.strip()[-100:]
            current_buffer = overlap + "\n" + line + "\n"
        else:
            current_buffer += line + "\n"

    if current_buffer.strip():
        curr_section_header = ' > '.join([h for h in header_path if h])
        context_prefix = f"[{curr_section_header}]\n"
        chunk_text = context_prefix + current_buffer.strip()
        raw_chunks.append((chunk_index, chunk_text, curr_section_header))

    if not raw_chunks:
        fallback_text = full_markdown.strip() or f"# {filename}\n\nDocument content ingested."
        raw_chunks = [(0, f"[{filename} | Document Content]\n{fallback_text}", filename)]

    return raw_chunks

