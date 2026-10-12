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

SESSION_LIFECYCLE_TABLE = "prompt_session_lifecycle"


def _session_lifecycle(session_id: str) -> dict | None:
    if SESSION_LIFECYCLE_TABLE not in get_existing_tables():
        return None
    rows = lance_db.open_table(SESSION_LIFECYCLE_TABLE).search().where(f'session_id = "{session_id}"').limit(2).to_list()
    if not rows:
        return None
    if len(rows) != 1:
        raise ValueError("Duplicate prompt-session lifecycle records")
    row = rows[0]
    if (row.get("version") != 1 or row.get("session_id") != session_id
            or row.get("state") not in ("active", "deleted")
            or not isinstance(row.get("generation"), int) or isinstance(row.get("generation"), bool)
            or row["generation"] < 1 or not isinstance(row.get("operation_id"), str)
            or not row["operation_id"]):
        raise ValueError("Unsupported prompt-session lifecycle record")
    validate_doc_id(row["operation_id"])
    return row


def _write_session_lifecycle(session_id: str, operation_id: str, generation: int, state: str) -> None:
    append_records(SESSION_LIFECYCLE_TABLE, [{
        "session_id": session_id,
        "version": 1,
        "operation_id": operation_id,
        "generation": generation,
        "state": state,
    }], delete_where=f'session_id = "{session_id}"', match_key="session_id")


@database_operation
def _index_if_current(session_id: str, generation: int, record: list[dict]) -> None:
    current = _session_lifecycle(session_id)
    if (current["generation"] if current else 0) != generation or (current and current["state"] != "active"):
        raise ValueError("Prompt session was deleted or changed during indexing")
    append_records(PROMPT_HISTORY_TABLE_NAME, record, delete_where=f'id = "{record[0]["id"]}"')


@database_operation
def _fenced_session_change(session_ids: list[str], operation_id: str, restore: bool) -> Dict[str, bool]:
    states = [_session_lifecycle(session_id) for session_id in session_ids]
    for state in states:
        if restore:
            if state is None or state["operation_id"] != operation_id:
                raise ValueError("Restore requires the matching deleted-session operation")
        elif state is not None and state["operation_id"] == operation_id and state["state"] == "active":
            raise ValueError("Completed restore cannot be replayed as deletion")
        elif state is not None and state["state"] == "deleted" and state["operation_id"] != operation_id:
            raise ValueError("Session has a different pending deletion")
    for session_id, state in zip(session_ids, states):
        if restore:
            if state["state"] == "deleted":
                _write_session_lifecycle(session_id, operation_id, state["generation"] + 1, "active")
        elif state is None or state["state"] == "active":
            _write_session_lifecycle(session_id, operation_id, (state["generation"] if state else 0) + 1, "deleted")
    if not restore and PROMPT_HISTORY_TABLE_NAME in get_existing_tables():
        table = lance_db.open_table(PROMPT_HISTORY_TABLE_NAME)
        for session_id in session_ids:
            table.delete(f'session_id = "{session_id}"')
    return {"success": True}


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
    lifecycle = _session_lifecycle(safe_session_id)
    if lifecycle and lifecycle["state"] == "deleted":
        raise ValueError("Prompt session is pending deletion")
    generation = lifecycle["generation"] if lifecycle else 0

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

    _index_if_current(safe_session_id, generation, record)


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
        session_id = item.get("session_id")
        lifecycle = _session_lifecycle(validate_doc_id(session_id)) if session_id else None
        if lifecycle and lifecycle["state"] == "deleted":
            continue
        distance = max(float(item.get("_distance", 0.0)), 0.0)
        # LanceDB L2 is already squared; unit vectors give cosine = 1 - distance / 2.
        score = max(0.0, 1.0 - distance / 2.0)
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
    if req.operation_id or req.restore:
        if not req.operation_id or not safe_ids or req.project_path:
            raise ValueError("Session lifecycle change requires operation_id and session_ids only")
        operation_id = validate_doc_id(req.operation_id)
        try:
            return _fenced_session_change(safe_ids, operation_id, req.restore)
        except ValueError:
            raise
        except Exception as error:
            logger.warning("Prompt session lifecycle change failed (%s)", type(error).__name__)
            return {"success": False}
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
