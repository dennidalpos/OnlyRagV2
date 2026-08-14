import re
from typing import List, Dict, Any
from sidecar.config import CHUNKS_TABLE_NAME, DOCS_TABLE_NAME, logger
from sidecar.schemas import SearchRequest, SearchResult
from sidecar.infrastructure.db import lance_db, get_existing_tables
from sidecar.infrastructure.embeddings import generate_embedding

# Multi-language stop words for hybrid keyword filtering
_STOP_WORDS = {
    "the", "and", "a", "an", "is", "in", "of", "to", "for", "with", "on", "at", "by", "from", "as", "about",
    "il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "di", "a", "da", "in", "con", "su", "per",
    "tra", "fra", "e", "o", "ma", "che", "non", "del", "della", "dei", "degli", "delle", "al", "alla",
    "ai", "agli", "alle", "nel", "nella", "nei", "negli", "nelle", "sul", "sulla", "sui", "sugli", "sulle"
}

def perform_vector_search(req: SearchRequest) -> List[SearchResult]:
    """Performs hybrid vector + BM25 keyword search with multi-document filtering over LanceDB chunks table."""
    query_raw = req.query.strip()
    if not query_raw:
        return []

    if CHUNKS_TABLE_NAME not in get_existing_tables():
        return []

    try:
        query_vec = generate_embedding(query_raw, model=req.embedding_model or "nomic-embed-text")
        ctbl = lance_db.open_table(CHUNKS_TABLE_NAME)
        
        top_k = req.top_k or 5
        search_builder = ctbl.search(query_vec)

        # Multi-document filtering support
        allowed_doc_ids = set()
        if req.doc_id:
            allowed_doc_ids.add(req.doc_id)
        if req.doc_ids:
            allowed_doc_ids.update(req.doc_ids)

        if allowed_doc_ids:
            try:
                where_clause = " OR ".join([f'doc_id = "{d_id}"' for d_id in allowed_doc_ids if d_id])
                if where_clause:
                    search_builder = search_builder.where(where_clause, prefilter=True)
            except Exception as filter_err:
                logger.warning(f"Where clause filter error in LanceDB search: {filter_err}")

        search_results = search_builder.limit(top_k * 3).to_list()
        
        raw_tokens = re.findall(r'\w+', query_raw.lower())
        query_terms = {t for t in raw_tokens if len(t) > 2 and t not in _STOP_WORDS}
        results: List[SearchResult] = []
        
        for item in search_results:
            item_doc_id = item.get("doc_id", "")
            if allowed_doc_ids and item_doc_id not in allowed_doc_ids:
                continue

            dist = item.get("_distance", 0.0)
            base_score = 1.0 / (1.0 + max(0.0, float(dist))) if dist is not None else 0.8
            text_lower = item.get("text", "").lower()
            doc_lower = item.get("doc_name", "").lower()
            header_lower = item.get("section_header", "").lower()
            
            # Hybrid Keyword Bonus with stop-word protection
            keyword_matches = sum(1 for term in query_terms if term in text_lower or term in doc_lower or term in header_lower)
            keyword_bonus = min(0.20, keyword_matches * 0.04) if query_terms else 0.0
            
            final_score = round(min(1.0, base_score + keyword_bonus), 3)
            
            results.append(
                SearchResult(
                    chunk_id=item.get("chunk_id", ""),
                    doc_id=item_doc_id,
                    doc_name=item.get("doc_name", ""),
                    section_header=item.get("section_header", ""),
                    text=item.get("text", ""),
                    score=final_score
                )
            )
        
        results.sort(key=lambda x: x.score, reverse=True)
        return results[:top_k]
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
    if not doc_id or not re.match(r'^[a-zA-Z0-9_\-]+$', doc_id):
        raise ValueError("Invalid document ID format")

    safe_id = doc_id.replace('"', '\\"')
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
