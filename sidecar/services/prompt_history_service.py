import hashlib
import numpy as np
from typing import Dict, List
from sidecar.config import PROMPT_HISTORY_TABLE_NAME, logger
from sidecar.schemas import (
    IndexPromptHistoryRequest,
    PromptHistorySearchRequest,
    PromptHistorySearchResult,
    PromptHistoryRemoveRequest,
)
from sidecar.infrastructure.db import lance_db, get_existing_tables, validate_doc_id, append_records, database_operation
from sidecar.infrastructure.embeddings import generate_embedding


def compute_project_id(project_path: str) -> str:
    """Derives a filter-safe project identifier from a raw filesystem path, which may contain
    characters unsafe to interpolate into a LanceDB filter string (e.g. Windows drive colons)."""
    normalized = (project_path or "").strip().lower()
    return hashlib.sha256(normalized.encode("utf-8", errors="ignore")).hexdigest()[:16]


def _normalized_embedding(text: str) -> List[float]:
    """Normalize legacy prompt vectors; encoder-space provenance is tracked separately."""
    vec = np.array(generate_embedding(text), dtype=np.float64)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


def index_prompt_history(req: IndexPromptHistoryRequest) -> None:
    """Atomically upsert a completed prompt by id."""
    prompt_text = (req.prompt or "").strip()
    if not prompt_text:
        return

    safe_id = validate_doc_id(req.id)
    safe_session_id = validate_doc_id(req.session_id)
    project_id = compute_project_id(req.project_path)

    embed_text = f"{prompt_text}\n\n{(req.summary or '').strip()}".strip()
    vector = _normalized_embedding(embed_text)

    record = [{
        "id": safe_id,
        "session_id": safe_session_id,
        "project_id": project_id,
        "project_path": req.project_path,
        "prompt": prompt_text,
        "summary": req.summary or "",
        "outcome": req.outcome,
        "started_at": req.started_at,
        "completed_at": req.completed_at or "",
        "vector": vector,
    }]

    append_records(PROMPT_HISTORY_TABLE_NAME, record, delete_where=f'id = "{safe_id}"')


def search_prompt_history(req: PromptHistorySearchRequest) -> List[PromptHistorySearchResult]:
    """Search legacy prompt vectors, optionally scoped to selected projects."""
    query_raw = (req.query or "").strip()
    if not query_raw:
        return []
    if PROMPT_HISTORY_TABLE_NAME not in get_existing_tables():
        return []

    query_vec = _normalized_embedding(query_raw)
    return _search_prompt_index(req, query_vec)


@database_operation
def _search_prompt_index(req: PromptHistorySearchRequest, query_vec: List[float]) -> List[PromptHistorySearchResult]:
    # Recheck recovery after encoding without holding the database lock during model work.
    if PROMPT_HISTORY_TABLE_NAME not in get_existing_tables():
        return []
    tbl = lance_db.open_table(PROMPT_HISTORY_TABLE_NAME)
    top_k = req.top_k or 10
    fetch_limit = max(top_k * 5, 50)
    search_builder = tbl.search(query_vec)

    if req.project_paths:
        allowed_project_ids = {compute_project_id(p) for p in req.project_paths if p}
        if allowed_project_ids:
            where_clause = " OR ".join([f'project_id = "{pid}"' for pid in allowed_project_ids])
            search_builder = search_builder.where(where_clause, prefilter=True)

    raw_results = search_builder.limit(fetch_limit).to_list()

    scored = []
    for item in raw_results:
        distance = max(float(item.get("_distance", 0.0)), 0.0)
        # Legacy ranking; geometry correction belongs to HISTORY-EMBEDDING-CORRECTNESS-01.
        score = max(0.0, 1.0 - (distance ** 2) / 2.0)
        scored.append((score, item))
    scored.sort(key=lambda pair: pair[0], reverse=True)

    return [
        PromptHistorySearchResult(
            id=item.get("id", ""),
            session_id=item.get("session_id", ""),
            project_id=item.get("project_id", ""),
            project_path=item.get("project_path", ""),
            prompt=item.get("prompt", ""),
            summary=item.get("summary") or None,
            outcome=item.get("outcome", ""),
            started_at=item.get("started_at", ""),
            completed_at=item.get("completed_at") or None,
            score=round(score, 4),
        )
        for score, item in scored[:top_k]
    ]


@database_operation
def remove_prompt_history(req: PromptHistoryRemoveRequest) -> Dict[str, bool]:
    """Remove owned rows; a refused operation remains safe to retry explicitly."""
    safe_ids = [validate_doc_id(sid) for sid in req.session_ids or []]
    if PROMPT_HISTORY_TABLE_NAME not in get_existing_tables():
        return {"success": True}

    try:
        tbl = lance_db.open_table(PROMPT_HISTORY_TABLE_NAME)
        if safe_ids:
            where_clause = " OR ".join([f'session_id = "{sid}"' for sid in safe_ids])
            tbl.delete(where_clause)
        if req.project_path:
            tbl.delete(f'project_id = "{compute_project_id(req.project_path)}"')
    except Exception as error:
        logger.warning("Prompt history removal failed (%s)", type(error).__name__)
        return {"success": False}
    return {"success": True}
