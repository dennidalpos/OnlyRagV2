import os
import sys

# Ensure sidecar directory and its parent directory are in sys.path for packaged Electron runtime
_current_dir = os.path.dirname(os.path.abspath(__file__))
_parent_dir = os.path.dirname(_current_dir)
if _parent_dir not in sys.path:
    sys.path.insert(0, _parent_dir)
if _current_dir not in sys.path:
    sys.path.insert(0, _current_dir)

import asyncio
import json
import uuid
from typing import List, Optional
from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Request, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from sidecar.config import ALLOWED_ORIGINS, EXPORT_DIR, DOCS_TABLE_NAME, CHUNKS_TABLE_NAME, logger
from sidecar.schemas import (
    IngestResponse, IngestPathRequest, SearchRequest, SearchResult,
    ExportRequest, UpdateDocumentRequest, PagePreviewResponse,
    LogDiagnosticQuery, LogDiagnosticReportSchema, AnomalyRecordSchema,
    IndexPromptHistoryRequest, PromptHistorySearchRequest, PromptHistorySearchResult,
    PromptHistoryRemoveRequest, TranslateInplaceRequest,
)
from sidecar.domain.log_analyzer import LogAnalyzer
from sidecar.infrastructure.db import lance_db, get_existing_tables, safe_open_table, run_db_maintenance
from sidecar.infrastructure.ocr import detect_gpu_acceleration, get_ocr_runtime_info
from sidecar.domain.exporter import export_markdown_to_file
from sidecar.services.ingest_service import (
    process_and_index_document,
    process_and_index_document_generator,
    update_and_reindex_document,
    render_document_page_preview
)
from sidecar.domain.translator import (
    translate_document_inplace,
    translate_document_stream_generator,
    UnsupportedDocumentTypeError
)
from sidecar.services.search_service import perform_vector_search, list_stored_documents, delete_stored_document
from sidecar.services.prompt_history_service import index_prompt_history, search_prompt_history, remove_prompt_history
from sidecar.services.vocab_service import background_vocab_sync_startup, get_vocab_sync_service

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    logger.info("FastAPI Sidecar starting up. Launching background vocabulary sync & DB maintenance...")
    asyncio.create_task(background_vocab_sync_startup())
    asyncio.create_task(asyncio.to_thread(run_db_maintenance))
    yield
    logger.info("FastAPI Sidecar shutting down.")

app = FastAPI(title="OnlyRag V2 Python Sidecar Engine", version="2.3.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    error_id = uuid.uuid4().hex[:12]
    logger.error(json.dumps({
        "event": "unhandled_exception",
        "error_id": error_id,
        "method": request.method,
        "path": request.url.path,
        "error_type": type(exc).__name__,
    }, sort_keys=True))
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error", "error_id": error_id}
    )

@app.get("/health")
def health_check():
    doc_count, chunk_count = 0, 0
    try:
        if DOCS_TABLE_NAME in get_existing_tables():
            doc_count = lance_db.open_table(DOCS_TABLE_NAME).count_rows()
        if CHUNKS_TABLE_NAME in get_existing_tables():
            chunk_count = lance_db.open_table(CHUNKS_TABLE_NAME).count_rows()
    except Exception as e:
        logger.error(f"Error checking LanceDB status: {e}")

    gpu_info = detect_gpu_acceleration()
    ocr_info = get_ocr_runtime_info()

    return {
        "status": "online",
        "engine": "FastAPI Python Sidecar + LanceDB OCR Engine V2",
        "version": "2.3.0",
        "vector_db": "LanceDB Embedded",
        "gpu": gpu_info,
        "ocr": ocr_info,
        "documents_count": doc_count,
        "chunks_count": chunk_count,
        "python_version": sys.version
    }

@app.post("/db/maintenance")
async def db_maintenance():
    """Triggers dataset compaction and vacuuming of obsolete versions across all LanceDB tables."""
    return await asyncio.to_thread(run_db_maintenance)

@app.post("/ingest", response_model=IngestResponse)
async def ingest_document(
    file: UploadFile = File(...),
    normalize_with_llm: bool = Form(False),
    normalization_model: Optional[str] = Form(None)
):
    logger.info(f"Received file upload for ingestion: {file.filename} (normalize_with_llm={normalize_with_llm})")
    try:
        content = await file.read()
        return await asyncio.to_thread(
            process_and_index_document,
            file.filename or "uploaded_document",
            content,
            normalize_with_llm=normalize_with_llm,
            normalization_model=normalization_model
        )
    except Exception as e:
        logger.error(f"Error ingesting uploaded document: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ingest-path", response_model=IngestResponse)
async def ingest_document_by_path(req: IngestPathRequest):
    logger.info(f"Received path for ingestion: {req.file_path} (normalize_with_llm={req.normalize_with_llm})")
    resolved_path = os.path.abspath(req.file_path)
    if not os.path.exists(resolved_path) or not os.path.isfile(resolved_path):
        raise HTTPException(status_code=400, detail="Invalid or non-existent file path")
    try:
        filename = os.path.basename(resolved_path)
        return await asyncio.to_thread(
            process_and_index_document, filename, b"", resolved_path,
            req.vision_model, req.vision_prompt,
            normalize_with_llm=bool(req.normalize_with_llm),
            normalization_model=req.normalization_model,
            num_ctx=req.num_ctx,
            max_tabular_rows=req.max_tabular_rows,
            max_excel_rows_per_sheet=req.max_excel_rows_per_sheet,
            max_excel_sheets=req.max_excel_sheets
        )
    except Exception as e:
        logger.error(f"Error ingesting document path {req.file_path}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ingest-path-stream")
async def ingest_document_by_path_stream(req: IngestPathRequest):
    logger.info(f"Received path for streaming ingestion: {req.file_path} (normalize_with_llm={req.normalize_with_llm})")
    resolved_path = os.path.abspath(req.file_path)
    if not os.path.exists(resolved_path) or not os.path.isfile(resolved_path):
        raise HTTPException(status_code=400, detail="Invalid or non-existent file path")
    try:
        filename = os.path.basename(resolved_path)
        return StreamingResponse(
            process_and_index_document_generator(
                filename, b"", resolved_path,
                vision_model=req.vision_model, vision_prompt=req.vision_prompt,
                normalize_with_llm=bool(req.normalize_with_llm),
                normalization_model=req.normalization_model,
                num_ctx=req.num_ctx,
                max_tabular_rows=req.max_tabular_rows,
                max_excel_rows_per_sheet=req.max_excel_rows_per_sheet,
                max_sheets=req.max_excel_sheets
            ),
            media_type="application/x-ndjson"
        )
    except Exception as e:
        logger.error(f"Error initiating streaming ingestion for {req.file_path}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/documents/{doc_id}", response_model=IngestResponse)
async def update_document(doc_id: str, req: UpdateDocumentRequest):
    logger.info(f"Updating and re-indexing document {doc_id} in LanceDB")
    try:
        return await asyncio.to_thread(update_and_reindex_document, doc_id, req.markdown_content)
    except ValueError as val_err:
        raise HTTPException(status_code=404, detail=str(val_err))
    except Exception as e:
        logger.error(f"Error updating document {doc_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/documents/{doc_id}/translate-inplace", response_model=IngestResponse)
async def translate_document_inplace_endpoint(doc_id: str, req: TranslateInplaceRequest):
    logger.info(f"In-place translation requested for document {doc_id}: {req.source_lang} -> {req.target_lang}")
    try:
        return await asyncio.to_thread(
            translate_document_inplace,
            doc_id,
            req.source_lang,
            req.target_lang,
            req.model or "llama3.2",
            req.backup_original if req.backup_original is not None else True,
            req.target_dir,
            req.num_ctx
        )
    except UnsupportedDocumentTypeError as type_err:
        raise HTTPException(status_code=400, detail=str(type_err))
    except ValueError as val_err:
        raise HTTPException(status_code=404, detail=str(val_err))
    except Exception as e:
        logger.error(f"Error translating document {doc_id} in place: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/documents/{doc_id}/translate-inplace-stream")
async def translate_document_inplace_stream_endpoint(doc_id: str, req: TranslateInplaceRequest):
    logger.info(f"Streaming in-place translation requested for document {doc_id}: {req.source_lang} -> {req.target_lang}")
    try:
        return StreamingResponse(
            translate_document_stream_generator(
                doc_id,
                req.source_lang,
                req.target_lang,
                model=req.model or "llama3.2",
                target_dir=req.target_dir,
                num_ctx=req.num_ctx
            ),
            media_type="application/x-ndjson"
        )
    except UnsupportedDocumentTypeError as type_err:
        raise HTTPException(status_code=400, detail=str(type_err))
    except ValueError as val_err:
        raise HTTPException(status_code=404, detail=str(val_err))
    except Exception as e:
        logger.error(f"Error initiating streaming translation for document {doc_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/documents/{doc_id}/page-preview/{page_num}", response_model=PagePreviewResponse)
async def get_page_preview(doc_id: str, page_num: int):
    logger.info(f"Rendering page preview for doc {doc_id}, page {page_num}")
    try:
        return await asyncio.to_thread(render_document_page_preview, doc_id, page_num)
    except ValueError as val_err:
        raise HTTPException(status_code=404, detail=str(val_err))
    except Exception as e:
        logger.error(f"Error rendering page preview: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/documents")
async def list_documents():
    return await asyncio.to_thread(list_stored_documents)

@app.delete("/documents/{doc_id}")
async def delete_document(doc_id: str):
    try:
        return await asyncio.to_thread(delete_stored_document, doc_id)
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))
    except Exception as e:
        logger.error(f"Error deleting document {doc_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/vector/search", response_model=List[SearchResult])
async def search_vector_db(req: SearchRequest):
    logger.info(f"Performing LanceDB vector search for query: '{req.query}'")
    return await asyncio.to_thread(perform_vector_search, req)

@app.post("/history/index")
async def index_history(req: IndexPromptHistoryRequest):
    try:
        await asyncio.to_thread(index_prompt_history, req)
        return {"success": True}
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))
    except Exception as e:
        logger.error(f"Error indexing prompt history entry {req.id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/history/search", response_model=List[PromptHistorySearchResult])
async def search_history(req: PromptHistorySearchRequest):
    return await asyncio.to_thread(search_prompt_history, req)

@app.post("/history/remove")
async def remove_history(req: PromptHistoryRemoveRequest):
    return await asyncio.to_thread(remove_prompt_history, req)

@app.post("/export")
async def export_document(req: ExportRequest):
    logger.info(f"Exporting markdown content to format: {req.export_format}")
    if not req.markdown_content.strip():
        raise HTTPException(status_code=400, detail="Markdown content is empty")
    try:
        return await asyncio.to_thread(export_markdown_to_file, req.markdown_content, req.export_format)
    except Exception as e:
        logger.error(f"Export failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/tasks/cancel")
async def cancel_sidecar_task(task_id: Optional[str] = Query(None)):
    logger.info(f"Received cancellation notice for task: {task_id or 'all'}")
    return {"status": "success", "message": f"Task {task_id or 'all'} marked cancelled"}

@app.post("/cleanup/temp")
async def cleanup_sidecar_temp():
    def _do_clean():
        cleaned = 0
        if os.path.exists(EXPORT_DIR):
            for fname in os.listdir(EXPORT_DIR):
                fpath = os.path.join(EXPORT_DIR, fname)
                try:
                    if os.path.isfile(fpath):
                        os.remove(fpath)
                        cleaned += 1
                except Exception:
                    pass
        return {"status": "success", "cleaned_files": cleaned}

    return await asyncio.to_thread(_do_clean)

# ---------------------------------------------------------------------------
# Agent Studio Endpoints
# ---------------------------------------------------------------------------

@app.post("/agent/logs/analyze", response_model=LogDiagnosticReportSchema)
async def agent_logs_analyze(req: LogDiagnosticQuery):
    """
    Scan OnlyRag V2 log files and return a structured anomaly diagnostic report.
    Detects: truncated JSON, VRAM thrashing, infinite tool-calling loops.
    """
    logger.info("Log analysis triggered. Extra paths: %s", req.extra_paths)
    try:
        analyzer = LogAnalyzer(extra_paths=req.extra_paths)
        report = await asyncio.to_thread(analyzer.analyze)
        return LogDiagnosticReportSchema(
            scanned_files=report.scanned_files,
            total_lines_scanned=report.total_lines_scanned,
            anomalies=[
                AnomalyRecordSchema(
                    anomaly_type=a.anomaly_type,
                    severity=a.severity,
                    log_file=a.log_file,
                    line_number=a.line_number,
                    snippet=a.snippet,
                    count=a.count,
                )
                for a in report.anomalies
            ],
            has_critical=report.has_critical,
            summary=report.summary,
        )
    except Exception as exc:
        logger.error("Log analysis error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/vocab/sync")
async def sync_vocab(request: Request):
    """Triggers vocabulary update check from upstream repository/manifest."""
    sync_svc = get_vocab_sync_service()
    result = await sync_svc.sync_vocabularies(timeout_sec=5.0)
    return result


@app.get("/vocab/status")
def get_vocab_status():
    """Returns active vocabulary statuses and wordfreq availability."""
    from sidecar.domain.word_segmenter import _WORDFREQ_AVAILABLE, get_vocab_manager
    mgr = get_vocab_manager()
    return {
        "wordfreq_available": _WORDFREQ_AVAILABLE,
        "cached_languages": list(mgr._local_vocab_cache.keys()),
        "cache_dir": mgr.cache_dir
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
