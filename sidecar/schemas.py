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
    used_fallback_embeddings: Optional[bool] = False

class IngestPathRequest(BaseModel):
    file_path: str
    vision_model: Optional[str] = None
    vision_prompt: Optional[str] = None
    normalize_with_llm: Optional[bool] = False
    normalization_model: Optional[str] = None
    max_tabular_rows: Optional[int] = None
    max_excel_rows_per_sheet: Optional[int] = None
    max_excel_sheets: Optional[int] = None

class UpdateDocumentRequest(BaseModel):
    markdown_content: str


class TranslateInplaceRequest(BaseModel):
    source_lang: str
    target_lang: str
    model: Optional[str] = None
    backup_original: Optional[bool] = True
    target_dir: Optional[str] = None

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


# ---------------------------------------------------------------------------
# Prompt History Semantic Search Schemas
# ---------------------------------------------------------------------------

class IndexPromptHistoryRequest(BaseModel):
    id: str
    session_id: str
    project_path: str
    prompt: str
    summary: Optional[str] = None
    outcome: str
    started_at: str
    completed_at: Optional[str] = None


class PromptHistorySearchRequest(BaseModel):
    query: str
    top_k: Optional[int] = 10
    # Raw workspace paths, not the internal hashed project_id -- callers should never need to
    # replicate the id-derivation hash themselves. Empty/omitted searches across all projects.
    project_paths: Optional[List[str]] = None


class PromptHistorySearchResult(BaseModel):
    id: str
    session_id: str
    project_id: str
    project_path: str
    prompt: str
    summary: Optional[str] = None
    outcome: str
    started_at: str
    completed_at: Optional[str] = None
    score: float


class PromptHistoryRemoveRequest(BaseModel):
    session_ids: Optional[List[str]] = None
    # Raw workspace path; hashed internally to the same project_id used at index time.
    project_path: Optional[str] = None

