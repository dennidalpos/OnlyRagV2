from typing import Literal, Optional, List
from pydantic import BaseModel, ConfigDict, Field

NON_BLANK = r".*\S.*"
MODEL_NAME = Field(default=None, min_length=1, max_length=200, pattern=NON_BLANK)
PATH_VALUE = Field(default=None, min_length=1, max_length=4096, pattern=NON_BLANK)

class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

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

class IngestPathRequest(StrictRequest):
    file_path: str = Field(..., min_length=1, max_length=4096, pattern=NON_BLANK)
    vision_model: Optional[str] = MODEL_NAME
    vision_prompt: Optional[str] = Field(default=None, min_length=1, max_length=20000, pattern=NON_BLANK)
    normalize_with_llm: Optional[bool] = False
    normalization_model: Optional[str] = MODEL_NAME
    num_ctx: Optional[int] = Field(default=None, ge=4096, le=131072)
    max_tabular_rows: Optional[int] = Field(default=None, ge=1, le=1_000_000)
    max_excel_rows_per_sheet: Optional[int] = Field(default=None, ge=1, le=1_000_000)
    max_excel_sheets: Optional[int] = Field(default=None, ge=1, le=1_000)

class UpdateDocumentRequest(StrictRequest):
    markdown_content: str = Field(..., min_length=1, max_length=10_000_000)


class TranslateInplaceRequest(StrictRequest):
    source_lang: str = Field(..., min_length=1, max_length=100, pattern=NON_BLANK)
    target_lang: str = Field(..., min_length=1, max_length=100, pattern=NON_BLANK)
    model: Optional[str] = MODEL_NAME
    backup_original: Optional[bool] = True
    target_dir: Optional[str] = PATH_VALUE
    num_ctx: Optional[int] = Field(default=None, ge=4096, le=131072)

class PagePreviewResponse(BaseModel):
    doc_id: str
    page_number: int
    total_pages: int
    image_base64: str
    mime_type: str = "image/png"

class SearchRequest(StrictRequest):
    query: str = Field(..., min_length=1, max_length=100_000)
    top_k: Optional[int] = Field(default=5, ge=1, le=100)
    embedding_model: Optional[str] = Field(default="nomic-embed-text", min_length=1, max_length=200, pattern=NON_BLANK)
    doc_id: Optional[str] = Field(default=None, min_length=1, max_length=200, pattern=NON_BLANK)
    doc_ids: Optional[List[str]] = Field(default=None, max_length=100)

class SearchResult(BaseModel):
    chunk_id: str
    doc_id: Optional[str] = None
    doc_name: str
    section_header: Optional[str] = None
    text: str
    score: float

class ExportRequest(StrictRequest):
    markdown_content: str = Field(..., min_length=1, max_length=10_000_000)
    export_format: Literal["pdf", "docx", "html", "htm"] = "pdf"

# ---------------------------------------------------------------------------
# Log Diagnostics Schemas
# ---------------------------------------------------------------------------

class LogDiagnosticQuery(StrictRequest):
    extra_paths: Optional[List[str]] = Field(default=None, max_length=100)


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

class IndexPromptHistoryRequest(StrictRequest):
    id: str = Field(..., min_length=1, max_length=200, pattern=NON_BLANK)
    session_id: str = Field(..., min_length=1, max_length=200, pattern=NON_BLANK)
    project_path: str = Field(..., min_length=1, max_length=4096, pattern=NON_BLANK)
    prompt: str = Field(..., min_length=1, max_length=100_000, pattern=NON_BLANK)
    summary: Optional[str] = Field(default=None, max_length=20_000)
    outcome: Literal["running", "success", "failed", "cancelled", "unknown"]
    started_at: str = Field(..., min_length=1, max_length=100, pattern=NON_BLANK)
    completed_at: Optional[str] = Field(default=None, min_length=1, max_length=100, pattern=NON_BLANK)


class PromptHistorySearchRequest(StrictRequest):
    query: str = Field(..., min_length=1, max_length=100_000)
    top_k: Optional[int] = Field(default=10, ge=1, le=100)
    # Raw workspace paths, not the internal hashed project_id -- callers should never need to
    # replicate the id-derivation hash themselves. Empty/omitted searches across all projects.
    project_paths: Optional[List[str]] = Field(default=None, max_length=100)


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


class PromptHistoryRemoveRequest(StrictRequest):
    session_ids: Optional[List[str]] = Field(default=None, max_length=100)
    # Raw workspace path; hashed internally to the same project_id used at index time.
    project_path: Optional[str] = PATH_VALUE
