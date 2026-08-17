from typing import Optional, List
from pydantic import BaseModel

class IngestResponse(BaseModel):
    id: str
    filename: str
    file_size: int
    num_pages: int
    num_chunks: int
    extracted_markdown: str
    status: str
    ingested_at: str

class IngestPathRequest(BaseModel):
    file_path: str

class UpdateDocumentRequest(BaseModel):
    markdown_content: str

class PagePreviewResponse(BaseModel):
    doc_id: str
    page_number: int
    total_pages: int
    image_base64: str
    mime_type: str = "image/png"

class SearchRequest(BaseModel):
    query: str
    top_k: Optional[int] = 5
    embedding_model: Optional[str] = "nomic-embed-text"
    doc_id: Optional[str] = None
    doc_ids: Optional[List[str]] = None

class SearchResult(BaseModel):
    chunk_id: str
    doc_id: Optional[str] = None
    doc_name: str
    section_header: Optional[str] = None
    text: str
    score: float

class ExportRequest(BaseModel):
    markdown_content: str
    export_format: str = "pdf"

class InspectImageRequest(BaseModel):
    image_base64: str
    question: Optional[str] = "What is in this diagram or document image?"
    vision_model: Optional[str] = "llama3.2-vision"


# ---------------------------------------------------------------------------
# Log Diagnostics Schemas
# ---------------------------------------------------------------------------

class LogDiagnosticQuery(BaseModel):
    extra_paths: Optional[List[str]] = None


class AnomalyRecordSchema(BaseModel):
    anomaly_type: str
    severity: str
    log_file: str
    line_number: int
    snippet: str
    count: int = 1


class LogDiagnosticReportSchema(BaseModel):
    scanned_files: List[str]
    total_lines_scanned: int
    anomalies: List[AnomalyRecordSchema]
    has_critical: bool
    summary: str

