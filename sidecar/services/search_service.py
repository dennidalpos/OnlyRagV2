from typing import Any, Dict, List, Optional
from sidecar.config import CHUNKS_TABLE_NAME, DOCS_TABLE_NAME, logger
from sidecar.schemas import SearchRequest, SearchResult
from sidecar.infrastructure.db import lance_db, get_existing_tables, validate_doc_id, database_operation, delete_document_records, CHUNK_PROVENANCE_FIELDS, chunk_embedding_space, require_versioned_chunk_table
from sidecar.infrastructure.embeddings import (
    generate_embedding_batch,
    EmbeddingSpaceMismatchError,
)
from sidecar.infrastructure.reranker import rerank_candidates

_LEXICAL_COLUMNS = ("text", "doc_name", "section_header")

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


def _stored_embedding_spaces(ctbl: Any, doc_filter: Optional[str]) -> list:
    """Do not assign a current digest or policy retroactively to old rows."""
    dimension = require_versioned_chunk_table(ctbl)
    query = ctbl.search().select(list(CHUNK_PROVENANCE_FIELDS))
    if doc_filter:
        query = query.where(doc_filter, prefilter=True)
    rows = query.limit(None).to_list()
    spaces = {}
    for row in rows:
        space = chunk_embedding_space(row)
        if space.embedding_dimension != dimension:
            raise EmbeddingSpaceMismatchError("Chunk dimension conflicts with its stored vector schema; rebuild explicitly.")
        spaces[row["embedding_space_id"]] = space
    return [spaces[key] for key in sorted(spaces)]


def _lexical_candidates(ctbl: Any, query: str, doc_filter: Optional[str], limit: int) -> list:
    """Native BM25 searches the store, including unindexed fragments."""
    indexes = {index.name: index for index in ctbl.list_indices()}
    for column in _LEXICAL_COLUMNS:
        name = f"onlyrag_lexical_{column}_v1"
        if name in indexes:
            index = indexes[name]
            if index.index_type != "FTS" or index.columns != [column]:
                raise RuntimeError(f"Incompatible lexical index: {name}")
        else:
            ctbl.create_fts_index(
                column, name=name, use_tantivy=False, stem=False,
                remove_stop_words=False, max_token_length=None, ascii_folding=False,
            )
    search = ctbl.search(query, query_type="fts", fts_columns=list(_LEXICAL_COLUMNS))
    if doc_filter:
        search = search.where(doc_filter, prefilter=True)
    return search.limit(limit).to_list()


@database_operation
def perform_vector_search(req: SearchRequest) -> List[SearchResult]:
    """Fuse independent dense and native lexical ranks, then apply the lexical heuristic."""
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

    if raw_doc_ids and not allowed_doc_ids:
        return []

    doc_filter = " OR ".join([f"doc_id = '{d_id}'" for d_id in sorted(allowed_doc_ids)]) if allowed_doc_ids else None

    # Dense retrieval per embedding model; rankings merged by rank across spaces
    chunk_map: Dict[str, Dict[str, Any]] = {}
    dense_ranks: Dict[str, int] = {}

    for space in _stored_embedding_spaces(ctbl, doc_filter):
        batch = generate_embedding_batch([query_raw], model=space.embedding_model, expected_space=space, role="query")
        if batch.space != space:
            raise EmbeddingSpaceMismatchError("Query and stored embedding spaces differ.")
        query_vec = batch.vectors[0]
        model_filter = f"embedding_space_id = '{_sql_literal(space.metadata()['embedding_space_id'])}'"
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

    sparse_ranks: Dict[str, int] = {}
    lexical_scores: Dict[str, float] = {}
    for item in _lexical_candidates(ctbl, query_raw, doc_filter, fetch_limit):
        c_id = str(item.get("chunk_id", ""))
        if not c_id or (allowed_doc_ids and item.get("doc_id") not in allowed_doc_ids):
            continue
        chunk_map.setdefault(c_id, item)
        sparse_ranks[c_id] = len(sparse_ranks) + 1
        lexical_scores[c_id] = float(item["_score"])

    # RRF fusion (k=60)
    K_RRF = 60
    rrf_fused = reciprocal_rank_fusion(dense_ranks, sparse_ranks, k=K_RRF)

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
            "score": normalized_score,
            "dense_rank": dense_ranks.get(c_id),
            "lexical_rank": sparse_ranks.get(c_id),
            "lexical_score": lexical_scores.get(c_id),
            "rrf_score": rrf_score,
        })

    candidate_dicts.sort(key=lambda x: (-x["rrf_score"], x["chunk_id"]))
    for rank, candidate in enumerate(candidate_dicts, 1):
        candidate["fused_rank"] = rank
    top_candidates = candidate_dicts[:max(top_k * 3, 15)]

    # Lexical cross-scoring
    reranked_dicts = rerank_candidates(query=query_raw, candidates=top_candidates, top_k=top_k)
    for rank, candidate in enumerate(reranked_dicts, 1):
        logger.debug(
            "Retrieval rank chunk=%s dense=%s lexical=%s bm25=%s rrf=%s fused=%s final=%s score=%s",
            candidate["chunk_id"], candidate["dense_rank"], candidate["lexical_rank"],
            candidate["lexical_score"], candidate["rrf_score"], candidate["fused_rank"], rank, candidate["score"],
        )

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


# Documents with fallback embeddings carry "indexed_fallback"
LISTABLE_STATUSES = {"indexed", "indexed_fallback"}

# Metadata-only columns for document list; full markdown loaded via GET /documents/{doc_id}
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
    return tbl.search().select(DOCUMENT_SUMMARY_COLUMNS).limit(None).to_list()


@database_operation
def list_stored_documents() -> List[Dict[str, Any]]:
    """Returns the metadata of every listable document stored in LanceDB, without its Markdown."""
    if DOCS_TABLE_NAME not in get_existing_tables():
        return []
    tbl = lance_db.open_table(DOCS_TABLE_NAME)
    return [
        _document_summary(row, str(row.get("status", "indexed")).lower())
        for row in _read_document_summary_rows(tbl)
        if str(row.get("status", "indexed")).lower() in LISTABLE_STATUSES
    ]


@database_operation
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
    delete_document_records(safe_id)
    return {"status": "success", "message": f"Deleted document {doc_id} from LanceDB."}
