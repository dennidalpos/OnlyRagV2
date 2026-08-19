import os
import sys

# Ensure sidecar directory and its parent directory are in sys.path for packaged Electron runtime
_current_dir = os.path.dirname(os.path.abspath(__file__))
_parent_dir = os.path.dirname(_current_dir)
if _parent_dir not in sys.path:
    sys.path.insert(0, _parent_dir)
if _current_dir not in sys.path:
    sys.path.insert(0, _current_dir)

import base64
import asyncio
from typing import List, Optional
from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from sidecar.config import ALLOWED_ORIGINS, EXPORT_DIR, DOCS_TABLE_NAME, CHUNKS_TABLE_NAME, logger
from sidecar.schemas import (
    IngestResponse, IngestPathRequest, SearchRequest, SearchResult,
    ExportRequest, InspectImageRequest, UpdateDocumentRequest, PagePreviewResponse,
    LogDiagnosticQuery, LogDiagnosticReportSchema, AnomalyRecordSchema,
    IndexPromptHistoryRequest, PromptHistorySearchRequest, PromptHistorySearchResult,
    PromptHistoryRemoveRequest,
)
from sidecar.domain.log_analyzer import LogAnalyzer
from sidecar.infrastructure.db import lance_db, get_existing_tables
from sidecar.infrastructure.ocr import run_vision_ocr, run_layout_ocr, detect_gpu_acceleration
from sidecar.domain.exporter import export_markdown_to_file
from sidecar.services.ingest_service import (
    process_and_index_document,
    process_and_index_document_generator,
    update_and_reindex_document,
    render_document_page_preview
)
from sidecar.services.search_service import perform_vector_search, list_stored_documents, delete_stored_document
from sidecar.services.prompt_history_service import index_prompt_history, search_prompt_history, remove_prompt_history

app = FastAPI(title="OnlyRag V2 Python Sidecar Engine", version="2.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Global unhandled exception at {request.url.path}: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal Server Error: {str(exc)}"}
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

    return {
        "status": "online",
        "engine": "FastAPI Python Sidecar + LanceDB OCR Engine V2",
        "version": "2.3.0",
        "vector_db": "LanceDB Embedded",
        "gpu": gpu_info,
        "documents_count": doc_count,
        "chunks_count": chunk_count,
        "python_version": sys.version
    }

@app.post("/ingest", response_model=IngestResponse)
async def ingest_document(file: UploadFile = File(...)):
    logger.info(f"Received file upload for ingestion: {file.filename}")
    try:
        content = await file.read()
        return await asyncio.to_thread(process_and_index_document, file.filename or "uploaded_document", content)
    except Exception as e:
        logger.error(f"Error ingesting uploaded document: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ingest-path", response_model=IngestResponse)
async def ingest_document_by_path(req: IngestPathRequest):
    logger.info(f"Received path for ingestion: {req.file_path}")
    resolved_path = os.path.abspath(req.file_path)
    if not os.path.exists(resolved_path) or not os.path.isfile(resolved_path):
        raise HTTPException(status_code=400, detail="Invalid or non-existent file path")
    try:
        filename = os.path.basename(resolved_path)
        return await asyncio.to_thread(
            process_and_index_document, filename, b"", resolved_path,
            req.vision_model, req.vision_prompt
        )
    except Exception as e:
        logger.error(f"Error ingesting document path {req.file_path}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ingest-path-stream")
async def ingest_document_by_path_stream(req: IngestPathRequest):
    logger.info(f"Received path for streaming ingestion: {req.file_path}")
    resolved_path = os.path.abspath(req.file_path)
    if not os.path.exists(resolved_path) or not os.path.isfile(resolved_path):
        raise HTTPException(status_code=400, detail="Invalid or non-existent file path")
    try:
        filename = os.path.basename(resolved_path)
        return StreamingResponse(
            process_and_index_document_generator(
                filename, b"", resolved_path,
                vision_model=req.vision_model, vision_prompt=req.vision_prompt
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

@app.post("/inspect-image")
async def inspect_image(req: InspectImageRequest):
    logger.info("Received image inspection request.")
    try:
        img_bytes = base64.b64decode(req.image_base64)
        v_model = req.vision_model or "llama3.2-vision"
        answer = await asyncio.to_thread(run_vision_ocr, img_bytes, req.question or "Describe this image in detail.", model=v_model)
        return {"status": "success", "analysis": answer or "Vision model response unavailable."}
    except Exception as e:
        logger.error(f"Error inspecting image: {e}")
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
