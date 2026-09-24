import re
from typing import Any, Dict, List, Optional
from sidecar.config import CHUNKS_TABLE_NAME, DOCS_TABLE_NAME, logger
from sidecar.schemas import SearchRequest, SearchResult
from sidecar.infrastructure.db import lance_db, get_existing_tables, validate_doc_id
from sidecar.infrastructure.embeddings import (
    DEFAULT_EMBEDDING_MODEL,
    FALLBACK_EMBEDDING_MODEL,
    generate_embedding_with_status,
    get_fallback_embedding,
)
from sidecar.infrastructure.reranker import rerank_candidates

# Multi-language stop words for hybrid keyword filtering
_STOP_WORDS = {
    "the", "and", "a", "an", "is", "in", "of", "to", "for", "with", "on", "at", "by", "from", "as", "about",
    "il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "di", "a", "da", "in", "con", "su", "per",
    "tra", "fra", "e", "o", "ma", "che", "non", "del", "della", "dei", "degli", "delle", "al", "alla",
    "ai", "agli", "alle", "nel", "nella", "nei", "negli", "nelle", "sul", "sulla", "sui", "sugli", "sulle"
}

def reciprocal_rank_fusion(
    dense_ranks: Dict[str, int],
    sparse_ranks: Dict[str, int],
    k: int = 60
) -> Dict[str, float]:
    """Computes Reciprocal Rank Fusion (RRF k=60) scores across dense and sparse ranking sets."""
    rrf_scores: Dict[str, float] = {}
    all_keys = set(dense_ranks.keys()).union(sparse_ranks.keys())

    for chunk_id in all_keys:
        score = 0.0
        if chunk_id in dense_ranks:
            score += 1.0 / (k + dense_ranks[chunk_id])
        if chunk_id in sparse_ranks:
            score += 1.0 / (k + sparse_ranks[chunk_id])
        rrf_scores[chunk_id] = score

    return rrf_scores


def _sql_literal(value: str) -> str:
    return value.replace("'", "''")


def _stored_embedding_models(ctbl: Any, doc_filter: Optional[str]) -> List[str]:
    """Distinct embedding models among the searchable rows."""
    query = ctbl.search().select(["embedding_model"])
    if doc_filter:
        query = query.where(doc_filter, prefilter=True)
    rows = query.limit(None).to_list()
    return sorted({str(row.get("embedding_model") or DEFAULT_EMBEDDING_MODEL) for row in rows})


def perform_vector_search(req: SearchRequest) -> List[SearchResult]:
    """Dense vector search per embedding model, fused with a lexical re-rank via Reciprocal Rank Fusion (RRF k=60)."""
    query_raw = req.query.strip()
    if not query_raw:
        return []

    if CHUNKS_TABLE_NAME not in get_existing_tables():
        return []

    ctbl = lance_db.open_table(CHUNKS_TABLE_NAME)

    top_k = req.top_k or 5
    fetch_limit = max(top_k * 5, 50)

    # Multi-document filtering support
    raw_doc_ids = set()
    if req.doc_id:
        raw_doc_ids.add(req.doc_id)
    if req.doc_ids:
        raw_doc_ids.update(req.doc_ids)

    allowed_doc_ids = set()
    for d_id in raw_doc_ids:
        try:
            allowed_doc_ids.add(validate_doc_id(d_id))
        except ValueError as invalid_id_err:
            logger.warning(f"Rejected malformed doc_id in search request: {invalid_id_err}")

    doc_filter = " OR ".join([f'doc_id = "{d_id}"' for d_id in allowed_doc_ids]) if allowed_doc_ids else None

    # 1. Dense retrieval, once per embedding space. Vectors from different models are not
    # comparable, so each model's rows are searched with a query embedded by that model and
    # the per-model rankings are merged by rank (best rank wins), never by raw distance.
    chunk_map: Dict[str, Dict[str, Any]] = {}
    dense_ranks: Dict[str, int] = {}

    for model in _stored_embedding_models(ctbl, doc_filter):
        if model == FALLBACK_EMBEDDING_MODEL:
            query_vec = get_fallback_embedding(query_raw)
        else:
            query_vec, query_used_fallback = generate_embedding_with_status(query_raw, model=model)
            if query_used_fallback:
                logger.warning(f"Skipping dense search over '{model}' chunks: the query could not be embedded.")
                continue

        model_filter = f"embedding_model = '{_sql_literal(model)}'"
        where_clause = f"({doc_filter}) AND {model_filter}" if doc_filter else model_filter
        dense_results = ctbl.search(query_vec).where(where_clause, prefilter=True).limit(fetch_limit).to_list()

        rank = 1
        for item in dense_results:
            c_id = str(item.get("chunk_id", ""))
            item_doc_id = str(item.get("doc_id", ""))
            if not c_id or (allowed_doc_ids and item_doc_id not in allowed_doc_ids):
                continue
            chunk_map[c_id] = item
            dense_ranks[c_id] = min(rank, dense_ranks.get(c_id, rank))
            rank += 1

    # 2. Lexical re-ranking of the dense candidates (term counts, not a BM25 index)
    raw_tokens = re.findall(r'\w+', query_raw.lower())
    query_terms = [t for t in raw_tokens if len(t) > 2 and t not in _STOP_WORDS]

    sparse_scores: Dict[str, float] = {}
    for c_id, item in chunk_map.items():
        text_lower = item.get("text", "").lower()
        doc_lower = item.get("doc_name", "").lower()
        header_lower = item.get("section_header", "").lower()

        term_matches = sum(
            (text_lower.count(term) * 1.0) + (doc_lower.count(term) * 2.0) + (header_lower.count(term) * 2.0)
            for term in query_terms
        )
        sparse_scores[c_id] = term_matches

    # Sort chunks with matches to assign sparse ranks
    matched_sparse = [c_id for c_id, score in sparse_scores.items() if score > 0]
    matched_sparse.sort(key=lambda c_id: sparse_scores[c_id], reverse=True)
    sparse_ranks: Dict[str, int] = {c_id: idx + 1 for idx, c_id in enumerate(matched_sparse)}

    # 3. Reciprocal Rank Fusion (RRF k=60)
    K_RRF = 60
    rrf_fused = reciprocal_rank_fusion(dense_ranks, sparse_ranks, k=K_RRF)

    # 4. Assemble candidate search results
    max_possible_rrf = 2.0 / (K_RRF + 1.0)
    candidate_dicts: List[Dict[str, Any]] = []

    for c_id, rrf_score in rrf_fused.items():
        item = chunk_map.get(c_id)
        if not item:
            continue

        normalized_score = round(min(1.0, rrf_score / max_possible_rrf), 3)
        candidate_dicts.append({
            "chunk_id": c_id,
            "doc_id": item.get("doc_id", ""),
            "doc_name": item.get("doc_name", ""),
            "section_header": item.get("section_header", ""),
            "text": item.get("text", ""),
            "score": normalized_score
        })

    candidate_dicts.sort(key=lambda x: x["score"], reverse=True)
    # Shortlist for the final lexical cross-scoring pass (up to top 15)
    top_candidates = candidate_dicts[:max(top_k * 3, 15)]

    # 5. Lexical cross-scoring of the fused shortlist
    reranked_dicts = rerank_candidates(query=query_raw, candidates=top_candidates, top_k=top_k)

    return [
        SearchResult(
            chunk_id=d["chunk_id"],
            doc_id=d.get("doc_id"),
            doc_name=d["doc_name"],
            section_header=d.get("section_header"),
            text=d["text"],
            score=d["score"]
        )
        for d in reranked_dicts
    ]


# Documents ingested with fallback embeddings carry status "indexed_fallback" (see ingest_service.doc_status).
LISTABLE_STATUSES = {"indexed", "indexed_fallback"}

# The list carries metadata only: the extracted Markdown of every document made each refresh (window
# focus, tab change) ship the whole corpus to the renderer. GET /documents/{doc_id} returns it on demand.
DOCUMENT_SUMMARY_COLUMNS = ["id", "filename", "file_path", "file_size", "num_pages", "num_chunks", "status", "ingested_at", "file_type"]


def _document_summary(r: Dict[str, Any], status_val: str) -> Dict[str, Any]:
    return {
        "id": str(r.get("id", "")),
        "filename": str(r.get("filename", "")),
        "file_path": str(r.get("file_path", "")),
        "file_size": int(r.get("file_size", 0)),
        "num_pages": int(r.get("num_pages", 1)),
        "num_chunks": int(r.get("num_chunks", 0)),
        "status": status_val,
        "ingested_at": str(r.get("ingested_at", "")),
        "file_type": str(r.get("file_type", "text")),
        "used_fallback_embeddings": status_val == "indexed_fallback",
    }


def _read_document_summary_rows(tbl: Any) -> List[Dict[str, Any]]:
    try:
        return tbl.search().select(DOCUMENT_SUMMARY_COLUMNS).limit(max(1, tbl.count_rows())).to_list()
    except Exception:
        pass
    try:
        return tbl.to_arrow().to_pylist()
    except Exception:
        return tbl.to_pandas().to_dict(orient="records")


def list_stored_documents() -> List[Dict[str, Any]]:
    """Returns the metadata of every listable document stored in LanceDB, without its Markdown."""
    try:
        if DOCS_TABLE_NAME not in get_existing_tables():
            return []
        tbl = lance_db.open_table(DOCS_TABLE_NAME)
        clean_records: List[Dict[str, Any]] = []
        for r in _read_document_summary_rows(tbl):
            status_val = str(r.get("status", "indexed")).lower()
            if status_val in LISTABLE_STATUSES:
                clean_records.append(_document_summary(r, status_val))
        return clean_records
    except Exception as e:
        logger.error(f"Error listing documents from LanceDB: {e}")
        return []


def get_stored_document(doc_id: str) -> Optional[Dict[str, Any]]:
    """Returns one listable document with its extracted Markdown, or None when it does not exist."""
    safe_id = validate_doc_id(doc_id)
    if DOCS_TABLE_NAME not in get_existing_tables():
        return None
    tbl = lance_db.open_table(DOCS_TABLE_NAME)
    records = tbl.search().where(f'id = "{safe_id}"', prefilter=True).limit(1).to_list()
    if not records:
        return None
    record = records[0]
    status_val = str(record.get("status", "indexed")).lower()
    if status_val not in LISTABLE_STATUSES:
        return None
    return {**_document_summary(record, status_val), "extracted_markdown": str(record.get("extracted_markdown", ""))}


def delete_stored_document(doc_id: str) -> Dict[str, str]:
    """Deletes document record and associated vector chunks from LanceDB tables."""
    safe_id = validate_doc_id(doc_id)
    existing_tables = get_existing_tables()
    
    if DOCS_TABLE_NAME in existing_tables:
        try:
            dtbl = lance_db.open_table(DOCS_TABLE_NAME)
            dtbl.delete(f'id = "{safe_id}"')
        except Exception as e:
            logger.warning(f"Could not delete from {DOCS_TABLE_NAME}: {e}")

    if CHUNKS_TABLE_NAME in existing_tables:
        try:
            ctbl = lance_db.open_table(CHUNKS_TABLE_NAME)
            ctbl.delete(f'doc_id = "{safe_id}"')
        except Exception as e:
            logger.warning(f"Could not delete from {CHUNKS_TABLE_NAME}: {e}")

    return {"status": "success", "message": f"Deleted document {doc_id} from LanceDB."}
