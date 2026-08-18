import re
from typing import List, Dict, Any
from sidecar.config import CHUNKS_TABLE_NAME, DOCS_TABLE_NAME, logger
from sidecar.schemas import SearchRequest, SearchResult
from sidecar.infrastructure.db import lance_db, get_existing_tables, validate_doc_id
from sidecar.infrastructure.embeddings import generate_embedding
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


def perform_vector_search(req: SearchRequest) -> List[SearchResult]:
    """Performs hybrid dense vector + sparse lexical BM25 search with Reciprocal Rank Fusion (RRF k=60)."""
    query_raw = req.query.strip()
    if not query_raw:
        return []

    if CHUNKS_TABLE_NAME not in get_existing_tables():
        return []

    try:
        query_vec = generate_embedding(query_raw, model=req.embedding_model or "nomic-embed-text")
        ctbl = lance_db.open_table(CHUNKS_TABLE_NAME)

        top_k = req.top_k or 5
        fetch_limit = max(top_k * 5, 50)
        search_builder = ctbl.search(query_vec)

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

        if allowed_doc_ids:
            where_clause = " OR ".join([f'doc_id = "{d_id}"' for d_id in allowed_doc_ids])
            search_builder = search_builder.where(where_clause, prefilter=True)

        # 1. Dense retrieval
        dense_results = search_builder.limit(fetch_limit).to_list()
        
        # Build map of chunk metadata
        chunk_map: Dict[str, Dict[str, Any]] = {}
        dense_ranks: Dict[str, int] = {}
        dense_rank_idx = 1

        for item in dense_results:
            c_id = str(item.get("chunk_id", ""))
            item_doc_id = str(item.get("doc_id", ""))
            if allowed_doc_ids and item_doc_id not in allowed_doc_ids:
                continue
            if c_id:
                chunk_map[c_id] = item
                dense_ranks[c_id] = dense_rank_idx
                dense_rank_idx += 1

        # 2. Sparse Lexical BM25 ranking
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
        # Pre-select top candidates for in-process cross-encoder re-ranking (up to top 15)
        top_candidates = candidate_dicts[:max(top_k * 3, 15)]

        # 5. In-process FlashRank / Cross-Encoder Re-Ranking
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
    except Exception as e:
        logger.error(f"Error executing LanceDB vector search: {e}")
        return []


def list_stored_documents() -> List[Dict[str, Any]]:
    """Returns a list of all indexed documents stored in LanceDB."""
    try:
        if DOCS_TABLE_NAME not in get_existing_tables():
            return []
        tbl = lance_db.open_table(DOCS_TABLE_NAME)
        try:
            records = tbl.to_arrow().to_pylist()
        except Exception:
            df = tbl.to_pandas()
            records = df.to_dict(orient="records")
        clean_records: List[Dict[str, Any]] = []
        for r in records:
            status_val = str(r.get("status", "indexed")).lower()
            if status_val == "indexed":
                clean_records.append({
                    "id": str(r.get("id", "")),
                    "filename": str(r.get("filename", "")),
                    "file_path": str(r.get("file_path", "")),
                    "file_size": int(r.get("file_size", 0)),
                    "num_pages": int(r.get("num_pages", 1)),
                    "num_chunks": int(r.get("num_chunks", 0)),
                    "extracted_markdown": str(r.get("extracted_markdown", "")),
                    "status": "indexed",
                    "ingested_at": str(r.get("ingested_at", "")),
                    "file_type": str(r.get("file_type", "text"))
                })
        return clean_records
    except Exception as e:
        logger.error(f"Error listing documents from LanceDB: {e}")
        return []


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
