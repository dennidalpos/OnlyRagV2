import re
from typing import List, Dict, Any
from sidecar.config import logger

_ranker_instance = None
_has_flashrank = None

def _get_flashrank_ranker():
    global _ranker_instance, _has_flashrank
    if _has_flashrank is False:
        return None
    if _ranker_instance is not None:
        return _ranker_instance
    try:
        from flashrank import Ranker
        _ranker_instance = Ranker(model_name="ms-marco-TinyBERT-L-2-v2", cache_dir=None)
        _has_flashrank = True
        logger.info("FlashRank in-process CPU cross-encoder initialized successfully.")
        return _ranker_instance
    except Exception as e:
        _has_flashrank = False
        logger.debug(f"FlashRank optional package not loaded, using deterministic in-process cross-scorer: {e}")
        return None


def calculate_cross_score(query: str, text: str, header: str = "") -> float:
    """Fast in-process cross-scoring calculating query phrase coverage, term density and header relevance."""
    clean_query = query.lower().strip()
    clean_text = text.lower()
    clean_header = (header or "").lower()

    if not clean_query or not clean_text:
        return 0.0

    terms = [t for t in re.findall(r'\w+', clean_query) if len(t) > 2]
    if not terms:
        return 0.5

    # 1. Exact phrase match bonus
    phrase_bonus = 0.35 if clean_query in clean_text else 0.0

    # 2. Term coverage percentage
    matched_terms = sum(1 for t in terms if t in clean_text)
    coverage_score = (matched_terms / len(terms)) * 0.40

    # 3. Header relevance boost
    header_matches = sum(1 for t in terms if t in clean_header)
    header_bonus = min(0.15, header_matches * 0.05)

    # 4. Density / frequency score
    total_occurrences = sum(clean_text.count(t) for t in terms)
    density_score = min(0.10, total_occurrences * 0.02)

    return round(min(1.0, phrase_bonus + coverage_score + header_bonus + density_score), 3)


def rerank_candidates(
    query: str,
    candidates: List[Dict[str, Any]],
    top_k: int = 5
) -> List[Dict[str, Any]]:
    """
    Re-ranks top candidate passages using FlashRank in-process CPU cross-encoder
    or high-fidelity semantic cross-scoring fallback.
    """
    if not candidates or not query.strip():
        return candidates[:top_k]

    ranker = _get_flashrank_ranker()
    if ranker is not None:
        try:
            from flashrank import RerankRequest
            passages = [
                {"id": str(c.get("chunk_id", idx)), "text": c.get("text", "")}
                for idx, c in enumerate(candidates)
            ]
            req = RerankRequest(query=query, passages=passages)
            ranked_output = ranker.rerank(req)

            score_map = {str(item.get("id", "")): float(item.get("score", 0.0)) for item in ranked_output}
            
            reranked = []
            for c in candidates:
                c_id = str(c.get("chunk_id", ""))
                flash_score = score_map.get(c_id, float(c.get("score", 0.5)))
                c_copy = dict(c)
                c_copy["score"] = round(min(1.0, max(0.0, flash_score)), 3)
                reranked.append(c_copy)

            reranked.sort(key=lambda x: x["score"], reverse=True)
            return reranked[:top_k]
        except Exception as err:
            logger.warning(f"FlashRank reranking error, falling back to in-process cross-scorer: {err}")

    # High-fidelity in-process cross-scorer
    reranked = []
    for c in candidates:
        initial_score = float(c.get("score", 0.5))
        cross_score = calculate_cross_score(
            query=query,
            text=c.get("text", ""),
            header=c.get("section_header", "")
        )
        fused_score = round(0.45 * initial_score + 0.55 * cross_score, 3)
        c_copy = dict(c)
        c_copy["score"] = fused_score
        reranked.append(c_copy)

    reranked.sort(key=lambda x: x["score"], reverse=True)
    return reranked[:top_k]
