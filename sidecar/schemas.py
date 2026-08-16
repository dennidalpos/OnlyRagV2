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
# Agent Orchestration Schemas
# ---------------------------------------------------------------------------

class ToolParameterSchema(BaseModel):
    name: str
    type: str
    description: str
    required: bool = True
    default: Optional[str] = None


class ToolDefinitionSchema(BaseModel):
    name: str
    description: str
    parameters: dict
    required: List[str] = []
    defaults: dict = {}


class ContextMessageSchema(BaseModel):
    role: str   # "system" | "user" | "assistant"
    content: str


class AgentOrchestrateRequest(BaseModel):
    model: str
    user_message: str
    tools: List[ToolDefinitionSchema] = []
    history: List[ContextMessageSchema] = []
    rag_context: Optional[str] = None
    max_context_tokens: int = 4096
    max_retries: int = 3
    few_shot_examples: dict = {}
    use_default_registry: bool = False
    """
    Se True, ignora il campo `tools` del client e usa il registro interno dei
    19 tool di Agent Studio (slm_tool_registry). I few_shot_examples vengono
    popolati automaticamente dal registro. Il client non deve serializzare nulla.
    """


class AgentOrchestrateResponse(BaseModel):
    success: bool
    tool_name: Optional[str] = None
    arguments: Optional[dict] = None
    text_response: Optional[str] = None
    escalation_level: str               # "NONE" | "L1" | "L2" | "L3_DEGRADED"
    error_detail: Optional[str] = None
    attempts: int


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

