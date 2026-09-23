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
import hmac
import json
import uuid
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from sidecar.config import ALLOWED_ORIGINS, SIDECAR_AUTH_HEADER, SIDECAR_AUTH_TOKEN, DOCS_TABLE_NAME, CHUNKS_TABLE_NAME, logger
from sidecar.schemas import (
    IngestResponse, IngestPathRequest, SearchRequest, SearchResult, HealthResponse,
    DocumentRecord, DeleteResponse, ExportResponse, SuccessResponse,
    TaskCancelResponse,
    ExportRequest, UpdateDocumentRequest, PagePreviewResponse,
    LogDiagnosticQuery, LogDiagnosticReportSchema, AnomalyRecordSchema,
    IndexPromptHistoryRequest, PromptHistorySearchRequest, PromptHistorySearchResult,
    PromptHistoryRemoveRequest, TranslateInplaceRequest,
)
from sidecar.domain.log_analyzer import LogAnalyzer
from sidecar.infrastructure.db import lance_db, get_existing_tables, run_db_maintenance, ensure_chunk_embedding_model_column
from sidecar.infrastructure.ocr import detect_gpu_acceleration, get_ocr_runtime_info
from sidecar.domain.exporter import export_markdown_to_file
from sidecar.services.ingest_service import (
    process_and_index_document_generator,
    update_and_reindex_document,
    render_document_page_preview
)
from sidecar.services.task_cancellation import cancel_task
from sidecar.domain.translator import (
    prepare_translation,
    translate_document_stream,
    UnsupportedDocumentTypeError
)
from sidecar.services.search_service import perform_vector_search, list_stored_documents, delete_stored_document
from sidecar.services.prompt_history_service import index_prompt_history, search_prompt_history, remove_prompt_history
from sidecar.services.vocab_service import background_vocab_sync_startup
from sidecar.infrastructure.embeddings import DEFAULT_EMBEDDING_MODEL, FALLBACK_EMBEDDING_MODEL

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    logger.info("FastAPI Sidecar starting up. Loading bundled vocabulary & DB maintenance...")
    await asyncio.to_thread(
        ensure_chunk_embedding_model_column,
        CHUNKS_TABLE_NAME, DOCS_TABLE_NAME, DEFAULT_EMBEDDING_MODEL, FALLBACK_EMBEDDING_MODEL,
    )
    # Held so the event loop cannot garbage-collect the tasks mid-flight.
    startup_tasks = {
        asyncio.create_task(background_vocab_sync_startup()),
        asyncio.create_task(asyncio.to_thread(run_db_maintenance)),
    }
    yield
    for task in startup_tasks:
        task.cancel()
    logger.info("FastAPI Sidecar shutting down.")

app = FastAPI(title="OnlyRag V2 Python Sidecar Engine", version="2.4.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def require_launch_token(request: Request, call_next):
    """Rejects callers that lack the token Electron passed at launch.

    A custom header also forces browsers into a CORS preflight, which the origin allowlist
    refuses, so a web page can no longer post "simple" requests to the local API.
    """
    if SIDECAR_AUTH_TOKEN and request.url.path != "/health" and request.method != "OPTIONS":
        supplied = request.headers.get(SIDECAR_AUTH_HEADER, "")
        if not hmac.compare_digest(supplied.encode(), SIDECAR_AUTH_TOKEN.encode()):
            return JSONResponse(status_code=401, content={"detail": "Missing or invalid sidecar token"})
    return await call_next(request)


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

@app.get("/health", response_model=HealthResponse)
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
        "version": "2.4.0",
        "vector_db": "LanceDB Embedded",
        "gpu": gpu_info,
        "ocr": ocr_info,
        "documents_count": doc_count,
        "chunks_count": chunk_count,
        "python_version": sys.version
    }

@app.post("/ingest-path-stream")
async def ingest_document_by_path_stream(req: IngestPathRequest):
    logger.info(f"Received path for streaming ingestion: {req.file_path} (normalize_with_llm={req.normalize_with_llm})")
    resolved_path = os.path.abspath(req.file_path)
    if not os.path.exists(resolved_path) or not os.path.isfile(resolved_path):
        raise HTTPException(status_code=400, detail="Invalid or non-existent file path")
    return StreamingResponse(
        process_and_index_document_generator(
            resolved_path,
            task_id=req.task_id,
            vision_model=req.vision_model, vision_prompt=req.vision_prompt,
            normalize_with_llm=bool(req.normalize_with_llm),
            normalization_model=req.normalization_model,
            normalization_think=bool(req.normalization_think),
            num_ctx=req.num_ctx,
            max_tabular_rows=req.max_tabular_rows,
            max_excel_rows_per_sheet=req.max_excel_rows_per_sheet,
            max_excel_sheets=req.max_excel_sheets,
            embedding_model=req.embedding_model or DEFAULT_EMBEDDING_MODEL,
        ),
        media_type="application/x-ndjson"
    )

@app.put("/documents/{doc_id}", response_model=IngestResponse)
async def update_document(doc_id: str, req: UpdateDocumentRequest):
    logger.info(f"Updating and re-indexing document {doc_id} in LanceDB")
    try:
        return await asyncio.to_thread(
            update_and_reindex_document,
            doc_id,
            req.markdown_content,
            req.embedding_model or DEFAULT_EMBEDDING_MODEL,
        )
    except ValueError as val_err:
        raise HTTPException(status_code=404, detail=str(val_err))
    except Exception as e:
        logger.error(f"Error updating document {doc_id}: {e}")
        raise

@app.post("/documents/{doc_id}/translate-inplace-stream")
async def translate_document_inplace_stream_endpoint(doc_id: str, req: TranslateInplaceRequest):
    logger.info(f"Streaming in-place translation requested for document {doc_id}: {req.source_lang} -> {req.target_lang}")
    try:
        record = await asyncio.to_thread(prepare_translation, doc_id)
    except UnsupportedDocumentTypeError as type_err:
        raise HTTPException(status_code=400, detail=str(type_err))
    except ValueError as val_err:
        raise HTTPException(status_code=404, detail=str(val_err))
    return StreamingResponse(
        translate_document_stream(
            record,
            req.source_lang,
            req.target_lang,
            model=req.model or "llama3.2",
            target_dir=req.target_dir,
            num_ctx=req.num_ctx,
            think=bool(req.think),
            task_id=req.task_id,
        ),
        media_type="application/x-ndjson",
    )

@app.get("/documents/{doc_id}/page-preview/{page_num}", response_model=PagePreviewResponse)
async def get_page_preview(doc_id: str, page_num: int):
    logger.info(f"Rendering page preview for doc {doc_id}, page {page_num}")
    try:
        return await asyncio.to_thread(render_document_page_preview, doc_id, page_num)
    except ValueError as val_err:
        raise HTTPException(status_code=404, detail=str(val_err))
    except Exception as e:
        logger.error(f"Error rendering page preview: {e}")
        raise

@app.get("/documents", response_model=List[DocumentRecord])
async def list_documents():
    return await asyncio.to_thread(list_stored_documents)

@app.delete("/documents/{doc_id}", response_model=DeleteResponse)
async def delete_document(doc_id: str):
    try:
        return await asyncio.to_thread(delete_stored_document, doc_id)
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))
    except Exception as e:
        logger.error(f"Error deleting document {doc_id}: {e}")
        raise

@app.post("/vector/search", response_model=List[SearchResult])
async def search_vector_db(req: SearchRequest):
    logger.info(f"Performing LanceDB vector search for query: '{req.query}'")
    return await asyncio.to_thread(perform_vector_search, req)

@app.post("/history/index", response_model=SuccessResponse)
async def index_history(req: IndexPromptHistoryRequest):
    try:
        await asyncio.to_thread(index_prompt_history, req)
        return {"success": True}
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))
    except Exception as e:
        logger.error(f"Error indexing prompt history entry {req.id}: {e}")
        raise

@app.post("/history/search", response_model=List[PromptHistorySearchResult])
async def search_history(req: PromptHistorySearchRequest):
    return await asyncio.to_thread(search_prompt_history, req)

@app.post("/history/remove", response_model=SuccessResponse)
async def remove_history(req: PromptHistoryRemoveRequest):
    return await asyncio.to_thread(remove_prompt_history, req)

@app.post("/export", response_model=ExportResponse)
async def export_document(req: ExportRequest):
    logger.info(f"Exporting markdown content to format: {req.export_format}")
    if not req.markdown_content.strip():
        raise HTTPException(status_code=400, detail="Markdown content is empty")
    try:
        return await asyncio.to_thread(export_markdown_to_file, req.markdown_content, req.export_format)
    except Exception as e:
        logger.error(f"Export failed: {e}")
        raise

@app.post("/tasks/cancel", response_model=TaskCancelResponse)
async def cancel_sidecar_task(task_id: Optional[str] = Query(None)):
    if not task_id:
        raise HTTPException(status_code=400, detail="task_id is required")
    cancel_task(task_id)
    logger.info(f"Cancellation requested for task: {task_id}")
    return {"status": "success", "message": f"Cancellation requested for task {task_id}"}

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
        raise


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
