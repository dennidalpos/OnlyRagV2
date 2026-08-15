import os
import re
import io
import json
import uuid
import base64
import datetime
from typing import Optional, List, Dict, Any, Generator
from concurrent.futures import ThreadPoolExecutor
import pymupdf
from sidecar.config import DOCS_TABLE_NAME, CHUNKS_TABLE_NAME, EXPORT_DIR, logger
from sidecar.schemas import IngestResponse, PagePreviewResponse
from sidecar.infrastructure.db import lance_db, get_existing_tables
from sidecar.infrastructure.embeddings import generate_embedding
from sidecar.domain.sanitizer import sanitize_extracted_text
from sidecar.domain.ingestion import (
    extract_document_markdown,
    create_semantic_chunks,
    extract_tables_from_page,
    extract_images_and_diagrams_from_page
)
from sidecar.domain.router import classify_file_type, DocumentCategory
from sidecar.infrastructure.ocr import run_layout_ocr

def process_and_index_document(filename: str, content: bytes, file_path: Optional[str] = None) -> IngestResponse:
    """Orchestrates document extraction, semantic chunking, embedding generation, and LanceDB indexing."""
    doc_id = str(uuid.uuid4())

    persisted_path = file_path or ""
    if not persisted_path or not os.path.exists(persisted_path):
        if content:
            os.makedirs(EXPORT_DIR, exist_ok=True)
            cached_file = os.path.join(EXPORT_DIR, f"source_{doc_id}_{filename}")
            try:
                with open(cached_file, "wb") as f:
                    f.write(content)
                persisted_path = cached_file
            except Exception as save_err:
                logger.warning(f"Could not cache source file to disk: {save_err}")

    full_markdown, num_pages = extract_document_markdown(filename, content, persisted_path or file_path)
    full_markdown = sanitize_extracted_text(full_markdown)
    raw_chunks = create_semantic_chunks(filename, full_markdown)

    ingested_at = datetime.datetime.now().isoformat()
    file_size = os.path.getsize(persisted_path) if persisted_path and os.path.exists(persisted_path) else len(content)
    ext = os.path.splitext(filename)[1].lower().replace(".", "") or "text"

    # Parallel embedding computation
    chunk_records: List[Dict[str, Any]] = []
    def embed_chunk(item):
        idx, text, sec_header = item
        vec = generate_embedding(text)
        return {
            "vector": vec,
            "chunk_id": f"{doc_id}_chunk_{idx}",
            "doc_id": doc_id,
            "doc_name": filename,
            "text": text,
            "chunk_index": idx,
            "section_header": sec_header,
            "file_type": ext,
            "ingested_at": ingested_at,
        }

    with ThreadPoolExecutor(max_workers=min(4, max(1, len(raw_chunks)))) as executor:
        chunk_records = list(executor.map(embed_chunk, raw_chunks))

    if chunk_records:
        try:
            ctbl = lance_db.open_table(CHUNKS_TABLE_NAME)
            ctbl.add(chunk_records)
        except Exception:
            try:
                ctbl = lance_db.create_table(CHUNKS_TABLE_NAME, data=chunk_records)
            except Exception as err:
                logger.warning(f"Re-creating {CHUNKS_TABLE_NAME} table due to schema update/error: {err}")
                try:
                    lance_db.drop_table(CHUNKS_TABLE_NAME)
                except Exception:
                    pass
                ctbl = lance_db.create_table(CHUNKS_TABLE_NAME, data=chunk_records)

        try:
            ctbl.create_fts_index("text", replace=True)
            logger.info("LanceDB FTS BM25 index created successfully.")
        except Exception as fts_err:
            logger.debug(f"FTS index creation deferred: {fts_err}")

    doc_record = [{
        "id": doc_id,
        "filename": filename,
        "file_path": persisted_path,
        "file_size": file_size,
        "num_pages": num_pages,
        "num_chunks": len(chunk_records),
        "extracted_markdown": full_markdown,
        "status": "indexed",
        "ingested_at": ingested_at,
        "file_type": ext
    }]

    try:
        dtbl = lance_db.open_table(DOCS_TABLE_NAME)
        dtbl.add(doc_record)
    except Exception:
        try:
            lance_db.create_table(DOCS_TABLE_NAME, data=doc_record)
        except Exception as err:
            logger.warning(f"Re-creating {DOCS_TABLE_NAME} table due to schema update/error: {err}")
            try:
                lance_db.drop_table(DOCS_TABLE_NAME)
            except Exception:
                pass
            lance_db.create_table(DOCS_TABLE_NAME, data=doc_record)

    logger.info(f"Ingested {filename} into LanceDB: {num_pages} pages, {len(chunk_records)} chunks indexed.")

    return IngestResponse(
        id=doc_id,
        filename=filename,
        file_size=file_size,
        num_pages=num_pages,
        num_chunks=len(chunk_records),
        extracted_markdown=full_markdown,
        status="indexed",
        ingested_at=ingested_at
    )

def process_and_index_document_generator(
    filename: str,
    content: bytes,
    file_path: Optional[str] = None
) -> Generator[str, None, None]:
    """
    Streaming NDJSON generator for real-time progress reporting during document extraction and LanceDB vectorization.
    """
    doc_id = str(uuid.uuid4())
    persisted_path = file_path or ""

    if not persisted_path or not os.path.exists(persisted_path):
        if content:
            os.makedirs(EXPORT_DIR, exist_ok=True)
            cached_file = os.path.join(EXPORT_DIR, f"source_{doc_id}_{filename}")
            try:
                with open(cached_file, "wb") as f:
                    f.write(content)
                persisted_path = cached_file
            except Exception as save_err:
                logger.warning(f"Could not cache source file to disk: {save_err}")

    yield json.dumps({
        "type": "progress",
        "percent": 5,
        "step": f"Avvio Fast-Router e pre-analisi file: {filename}...",
        "pipeline": "Fast-Router Layout",
        "fileName": filename
    }) + "\n"

    category = classify_file_type(filename)
    num_pages = 1
    page_blocks: List[Tuple[int, str]] = []

    if category == DocumentCategory.PDF:
        try:
            if persisted_path and os.path.exists(persisted_path):
                pdf_doc = pymupdf.open(persisted_path)
            else:
                pdf_doc = pymupdf.open(stream=content, filetype="pdf")

            try:
                num_pages = len(pdf_doc)
                yield json.dumps({
                    "type": "progress",
                    "percent": 10,
                    "step": f"Rilevate {num_pages} pagine nel documento PDF. Inizio estrazione ad alta precisione...",
                    "pipeline": "PDF Stream & Table Extraction",
                    "page": 1,
                    "total_pages": num_pages,
                    "fileName": filename
                }) + "\n"

                for page_idx in range(num_pages):
                    page_num = page_idx + 1
                    page = pdf_doc.load_page(page_idx)
                    page_md_parts: List[str] = []

                    # 1. Native table extraction
                    md_tables, _ = extract_tables_from_page(page)
                    table_info = f" (trovate {len(md_tables)} tabelle)" if md_tables else ""

                    # 2. Text extraction
                    raw_text = page.get_text("text").strip()
                    if len(raw_text) < 40:
                        yield json.dumps({
                            "type": "progress",
                            "percent": int(10 + (page_num / num_pages) * 55),
                            "step": f"Pagina {page_num}/{num_pages}: Esecuzione OCR Layout su pagina scansionata...",
                            "pipeline": "OCR Layout (Scansione)",
                            "page": page_num,
                            "total_pages": num_pages,
                            "fileName": filename
                        }) + "\n"

                        pix = page.get_pixmap(dpi=150)
                        img_bytes = pix.tobytes("png")
                        ocr_result = run_layout_ocr(img_bytes)
                        if ocr_result.strip():
                            page_md_parts.append(ocr_result.strip())
                        else:
                            page_md_parts.append("[Scanned page - No readable text extracted]")
                    else:
                        yield json.dumps({
                            "type": "progress",
                            "percent": int(10 + (page_num / num_pages) * 55),
                            "step": f"Pagina {page_num}/{num_pages}: Estrazione testo{table_info}...",
                            "pipeline": "PDF Stream & Table Finder",
                            "page": page_num,
                            "total_pages": num_pages,
                            "fileName": filename
                        }) + "\n"

                        if md_tables:
                            page_md_parts.append(raw_text)
                            page_md_parts.extend(md_tables)
                        else:
                            page_md_parts.append(raw_text)

                    # 3. Figure / Diagram annotations
                    diagrams = extract_images_and_diagrams_from_page(pdf_doc, page, page_num)
                    if diagrams:
                        page_md_parts.extend(diagrams)

                    page_content = "\n\n".join(page_md_parts).strip() or "[Empty Page Content]"
                    page_blocks.append((page_num, sanitize_extracted_text(page_content)))
            finally:
                pdf_doc.close()

            paginated_sections = [f"## Page {p_idx}\n\n{p_text}" for p_idx, p_text in page_blocks]
            full_markdown = f"# {filename}\n\n" + "\n\n".join(paginated_sections)
        except Exception as pdf_err:
            logger.warning(f"PyMuPDF streaming parse error: {pdf_err}")
            full_markdown = f"# {filename}\n\n## Page 1\n\n[Error reading PDF pages]"

    else:
        # Non-PDF files (DOCX, Image, Tabular, Text)
        yield json.dumps({
            "type": "progress",
            "percent": 35,
            "step": f"Estrazione contenuti strutturati per file {filename} ({category})...",
            "pipeline": "Structured Document Extractor",
            "fileName": filename
        }) + "\n"
        full_markdown, num_pages = extract_document_markdown(filename, content, persisted_path or file_path)

    full_markdown = sanitize_extracted_text(full_markdown)

    yield json.dumps({
        "type": "progress",
        "percent": 68,
        "step": "Creazione dei chunk semantici header-aware...",
        "pipeline": "Semantic Header Chunking",
        "fileName": filename
    }) + "\n"

    raw_chunks = create_semantic_chunks(filename, full_markdown)
    total_chunks = len(raw_chunks)
    ingested_at = datetime.datetime.now().isoformat()
    file_size = os.path.getsize(persisted_path) if persisted_path and os.path.exists(persisted_path) else len(content)
    ext = os.path.splitext(filename)[1].lower().replace(".", "") or "text"

    chunk_records: List[Dict[str, Any]] = []
    for c_idx, item in enumerate(raw_chunks):
        idx, text, sec_header = item
        vec = generate_embedding(text)
        chunk_records.append({
            "vector": vec,
            "chunk_id": f"{doc_id}_chunk_{idx}",
            "doc_id": doc_id,
            "doc_name": filename,
            "text": text,
            "chunk_index": idx,
            "section_header": sec_header,
            "file_type": ext,
            "ingested_at": ingested_at,
        })
        if c_idx % max(1, total_chunks // 10) == 0 or c_idx == total_chunks - 1:
            progress_pct = int(70 + ((c_idx + 1) / total_chunks) * 24)
            yield json.dumps({
                "type": "progress",
                "percent": progress_pct,
                "step": f"Vettorizzazione Chunk {c_idx + 1}/{total_chunks} (nomic-embed-text)...",
                "pipeline": "LanceDB Embeddings",
                "fileName": filename
            }) + "\n"

    if chunk_records:
        try:
            ctbl = lance_db.open_table(CHUNKS_TABLE_NAME)
            ctbl.add(chunk_records)
        except Exception:
            try:
                ctbl = lance_db.create_table(CHUNKS_TABLE_NAME, data=chunk_records)
            except Exception as err:
                try:
                    lance_db.drop_table(CHUNKS_TABLE_NAME)
                except Exception:
                    pass
                ctbl = lance_db.create_table(CHUNKS_TABLE_NAME, data=chunk_records)

        yield json.dumps({
            "type": "progress",
            "percent": 96,
            "step": "Creazione e aggiornamento indice Full-Text Search (BM25)...",
            "pipeline": "LanceDB FTS BM25",
            "fileName": filename
        }) + "\n"

        try:
            ctbl.create_fts_index("text", replace=True)
        except Exception:
            pass

    doc_record = [{
        "id": doc_id,
        "filename": filename,
        "file_path": persisted_path,
        "file_size": file_size,
        "num_pages": num_pages,
        "num_chunks": len(chunk_records),
        "extracted_markdown": full_markdown,
        "status": "indexed",
        "ingested_at": ingested_at,
        "file_type": ext
    }]

    try:
        dtbl = lance_db.open_table(DOCS_TABLE_NAME)
        dtbl.add(doc_record)
    except Exception:
        try:
            lance_db.create_table(DOCS_TABLE_NAME, data=doc_record)
        except Exception:
            try:
                lance_db.drop_table(DOCS_TABLE_NAME)
            except Exception:
                pass
            lance_db.create_table(DOCS_TABLE_NAME, data=doc_record)

    logger.info(f"Ingested {filename} (streaming) into LanceDB: {num_pages} pages, {len(chunk_records)} chunks indexed.")

    final_payload = {
        "id": doc_id,
        "filename": filename,
        "filePath": persisted_path,
        "file_size": file_size,
        "num_pages": num_pages,
        "num_chunks": len(chunk_records),
        "extracted_markdown": full_markdown,
        "status": "indexed",
        "ingested_at": ingested_at
    }

    yield json.dumps({
        "type": "done",
        "percent": 100,
        "step": "Ingestione e indicizzazione completate con successo!",
        "pipeline": "Completato",
        "fileName": filename,
        "data": final_payload
    }) + "\n"

def update_and_reindex_document(doc_id: str, new_markdown: str) -> IngestResponse:
    """
    Updates previously ingested document with user edits:
    1. Sanitizes markdown
    2. Deletes old chunks for doc_id from LanceDB
    3. Re-chunks semantic markdown and re-computes embeddings
    4. Updates document record in LanceDB
    """
    if not doc_id or not re.match(r'^[a-zA-Z0-9_\-]+$', doc_id):
        raise ValueError("Invalid document ID format")

    clean_markdown = sanitize_extracted_text(new_markdown)
    existing_tables = get_existing_tables()

    if DOCS_TABLE_NAME not in existing_tables:
        raise ValueError("Documents table does not exist")

    dtbl = lance_db.open_table(DOCS_TABLE_NAME)
    records = dtbl.search().where(f'id = "{doc_id}"', prefilter=True).limit(1).to_list()
    if not records:
        raise ValueError(f"Document {doc_id} not found in database")

    old_doc = records[0]
    filename = old_doc.get("filename", "document.md")
    persisted_path = old_doc.get("file_path", "")
    file_type = old_doc.get("file_type", "text")
    file_size = len(clean_markdown.encode("utf-8"))

    # Count pages from page headers
    page_matches = re.findall(r'(?:^|\n)##\s+Page\s+\d+', clean_markdown, re.IGNORECASE)
    num_pages = max(1, len(page_matches)) if page_matches else int(old_doc.get("num_pages", 1))

    # 1. Delete old chunks from LanceDB
    safe_id = doc_id.replace('"', '\\"')
    if CHUNKS_TABLE_NAME in existing_tables:
        try:
            ctbl = lance_db.open_table(CHUNKS_TABLE_NAME)
            ctbl.delete(f'doc_id = "{safe_id}"')
        except Exception as e:
            logger.warning(f"Error removing old chunks for {doc_id}: {e}")

    # 2. Re-chunk and compute new embeddings
    raw_chunks = create_semantic_chunks(filename, clean_markdown)
    updated_at = datetime.datetime.now().isoformat()

    chunk_records: List[Dict[str, Any]] = []
    def embed_chunk(item):
        idx, text, sec_header = item
        vec = generate_embedding(text)
        return {
            "vector": vec,
            "chunk_id": f"{doc_id}_chunk_{idx}",
            "doc_id": doc_id,
            "doc_name": filename,
            "text": text,
            "chunk_index": idx,
            "section_header": sec_header,
            "file_type": file_type,
            "ingested_at": updated_at,
        }

    with ThreadPoolExecutor(max_workers=min(4, max(1, len(raw_chunks)))) as executor:
        chunk_records = list(executor.map(embed_chunk, raw_chunks))

    if chunk_records and CHUNKS_TABLE_NAME in existing_tables:
        ctbl = lance_db.open_table(CHUNKS_TABLE_NAME)
        ctbl.add(chunk_records)
        try:
            ctbl.create_fts_index("text", replace=True)
        except Exception:
            pass

    # 3. Update doc record in LanceDB
    dtbl.delete(f'id = "{safe_id}"')
    new_doc_record = [{
        "id": doc_id,
        "filename": filename,
        "file_path": persisted_path,
        "file_size": file_size,
        "num_pages": num_pages,
        "num_chunks": len(chunk_records),
        "extracted_markdown": clean_markdown,
        "status": "indexed",
        "ingested_at": updated_at,
        "file_type": file_type
    }]
    dtbl.add(new_doc_record)

    logger.info(f"Re-indexed document {doc_id} ({filename}): {len(chunk_records)} chunks updated in LanceDB.")

    return IngestResponse(
        id=doc_id,
        filename=filename,
        file_size=file_size,
        num_pages=num_pages,
        num_chunks=len(chunk_records),
        extracted_markdown=clean_markdown,
        status="indexed",
        ingested_at=updated_at
    )

def render_document_page_preview(doc_id: str, page_num: int) -> PagePreviewResponse:
    """
    Renders high-fidelity real page preview image (PNG base64) directly from original source file on disk.
    """
    if DOCS_TABLE_NAME not in get_existing_tables():
        raise ValueError("Documents table not initialized")

    dtbl = lance_db.open_table(DOCS_TABLE_NAME)
    records = dtbl.search().where(f'id = "{doc_id}"', prefilter=True).limit(1).to_list()
    if not records:
        raise ValueError(f"Document {doc_id} not found")

    doc = records[0]
    num_pages = int(doc.get("num_pages", 1))
    target_page = min(max(1, page_num), num_pages)
    file_path = doc.get("file_path", "")

    # 1. If real source file exists on disk and is a PDF
    if file_path and os.path.exists(file_path):
        ext = os.path.splitext(file_path)[1].lower()
        if ext == ".pdf":
            try:
                pdf_doc = pymupdf.open(file_path)
                try:
                    real_page_idx = target_page - 1
                    if 0 <= real_page_idx < len(pdf_doc):
                        page = pdf_doc.load_page(real_page_idx)
                        pix = page.get_pixmap(dpi=150)
                        png_bytes = pix.tobytes("png")
                        b64_png = base64.b64encode(png_bytes).decode("utf-8")
                        return PagePreviewResponse(
                            doc_id=doc_id,
                            page_number=target_page,
                            total_pages=num_pages,
                            image_base64=b64_png,
                            mime_type="image/png"
                        )
                finally:
                    pdf_doc.close()
            except Exception as pdf_err:
                logger.warning(f"Failed rendering real PDF page {target_page} from {file_path}: {pdf_err}")

        # 2. If real source file is an image
        elif ext in [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff"]:
            try:
                with open(file_path, "rb") as f:
                    img_bytes = f.read()
                b64_img = base64.b64encode(img_bytes).decode("utf-8")
                mime = "image/jpeg" if ext in [".jpg", ".jpeg"] else ("image/png" if ext == ".png" else "image/webp")
                return PagePreviewResponse(
                    doc_id=doc_id,
                    page_number=1,
                    total_pages=1,
                    image_base64=b64_img,
                    mime_type=mime
                )
            except Exception as img_err:
                logger.warning(f"Failed reading real source image {file_path}: {img_err}")

    # Fallback to high-resolution markdown canvas if original source file is plain text or was moved
    extracted_md = str(doc.get("extracted_markdown", ""))
    page_split_regex = r'(?:^|\n)(?=## Page \d+|## Image)'
    pages = [p.strip() for p in re.split(page_split_regex, extracted_md, flags=re.IGNORECASE) if p.strip()]

    try:
        temp_pdf = pymupdf.open()
        try:
            page_doc = temp_pdf.new_page(width=595, height=842)
            page_text = pages[target_page - 1] if len(pages) >= target_page else (pages[0] if pages else "Page Content")
            clean_render_text = re.sub(r'^##\s+Page\s+\d+\s*', '', page_text, flags=re.IGNORECASE)
            page_doc.insert_text((50, 60), f"PAGINA {target_page} / {num_pages} — ANTEPRIMA", fontsize=11, fontname="helv", color=(0.2, 0.6, 0.8))
            page_doc.insert_textbox(pymupdf.Rect(50, 80, 545, 800), clean_render_text[:3000], fontsize=10, fontname="helv", color=(0.15, 0.15, 0.15))
            
            pix = page_doc.get_pixmap(dpi=150)
            png_bytes = pix.tobytes("png")
        finally:
            temp_pdf.close()
        
        b64_png = base64.b64encode(png_bytes).decode("utf-8")
        return PagePreviewResponse(
            doc_id=doc_id,
            page_number=target_page,
            total_pages=num_pages,
            image_base64=b64_png,
            mime_type="image/png"
        )
    except Exception as render_err:
        logger.warning(f"Fallback page preview rendering failed: {render_err}")
        return PagePreviewResponse(
            doc_id=doc_id,
            page_number=target_page,
            total_pages=num_pages,
            image_base64="",
            mime_type="image/png"
        )
