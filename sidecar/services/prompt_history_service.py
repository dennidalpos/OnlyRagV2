import hashlib
import numpy as np
from typing import Any, Dict, List
from sidecar.config import PROMPT_HISTORY_TABLE_NAME, logger
from sidecar.schemas import (
    IndexPromptHistoryRequest,
    PromptHistorySearchRequest,
    PromptHistorySearchResult,
    PromptHistoryRemoveRequest,
)
from sidecar.infrastructure.db import lance_db, get_existing_tables, validate_doc_id
from sidecar.infrastructure.embeddings import generate_embedding


def compute_project_id(project_path: str) -> str:
    """Derives a filter-safe project identifier from a raw filesystem path, which may contain
    characters unsafe to interpolate into a LanceDB filter string (e.g. Windows drive colons)."""
    normalized = (project_path or "").strip().lower()
    return hashlib.sha256(normalized.encode("utf-8", errors="ignore")).hexdigest()[:16]


def _normalized_embedding(text: str) -> List[float]:
    """L2-normalizes the embedding so LanceDB's default L2 distance between two normalized
    vectors relates directly to cosine similarity (cos_sim = 1 - distance^2 / 2), giving an
    intuitive bounded [0, 1] score instead of an unbounded raw-distance transform."""
    vec = np.array(generate_embedding(text), dtype=np.float64)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


def index_prompt_history(req: IndexPromptHistoryRequest) -> None:
    """Embeds and upserts one completed prompt into the semantic history index. Idempotent by
    `id` (delete-then-add), since the renderer's completion trigger could in theory fire twice
    for the same executed prompt."""
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

    try:
        tbl = lance_db.open_table(PROMPT_HISTORY_TABLE_NAME)
        try:
            tbl.delete(f'id = "{safe_id}"')
        except Exception:
            pass
        tbl.add(record)
    except Exception:
        try:
            lance_db.create_table(PROMPT_HISTORY_TABLE_NAME, data=record)
        except Exception as err:
            logger.warning(f"Re-creating {PROMPT_HISTORY_TABLE_NAME} table due to schema update/error: {err}")
            try:
                lance_db.drop_table(PROMPT_HISTORY_TABLE_NAME)
            except Exception:
                pass
            lance_db.create_table(PROMPT_HISTORY_TABLE_NAME, data=record)


def search_prompt_history(req: PromptHistorySearchRequest) -> List[PromptHistorySearchResult]:
    """Pure dense cosine-similarity search over the prompt history index, across every indexed
    project unless `project_paths` narrows it. No FTS/RRF/reranker -- deliberately simpler than
    perform_vector_search's document pipeline."""
    query_raw = (req.query or "").strip()
    if not query_raw:
        return []
    if PROMPT_HISTORY_TABLE_NAME not in get_existing_tables():
        return []

    try:
        query_vec = _normalized_embedding(query_raw)
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
            # Vectors are L2-normalized at index/query time, so squared L2 distance relates
            # directly to cosine similarity: cos_sim = 1 - distance^2 / 2.
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
    except Exception as e:
        logger.error(f"Error executing prompt history search: {e}")
        return []


def remove_prompt_history(req: PromptHistoryRemoveRequest) -> Dict[str, Any]:
    """Deletes prompt-history rows by session id(s) and/or project, keeping the index from
    ever pointing at sessions/projects the user has already deleted."""
    if PROMPT_HISTORY_TABLE_NAME not in get_existing_tables():
        return {"success": True}

    try:
        tbl = lance_db.open_table(PROMPT_HISTORY_TABLE_NAME)
    except Exception as e:
        logger.warning(f"Could not open {PROMPT_HISTORY_TABLE_NAME} for removal: {e}")
        return {"success": False}

    if req.session_ids:
        safe_ids = []
        for sid in req.session_ids:
            try:
                safe_ids.append(validate_doc_id(sid))
            except ValueError as invalid_id_err:
                logger.warning(f"Rejected malformed session_id in history removal request: {invalid_id_err}")
        if safe_ids:
            where_clause = " OR ".join([f'session_id = "{sid}"' for sid in safe_ids])
            try:
                tbl.delete(where_clause)
            except Exception as err:
                logger.warning(f"Failed deleting prompt history for session(s) {safe_ids}: {err}")

    if req.project_path:
        project_id = compute_project_id(req.project_path)
        try:
            tbl.delete(f'project_id = "{project_id}"')
        except Exception as err:
            logger.warning(f"Failed deleting prompt history for project {req.project_path!r}: {err}")

    return {"success": True}
