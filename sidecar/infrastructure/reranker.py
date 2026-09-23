import re
from typing import List, Dict, Any

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
    """Re-ranks the shortlist by blending its fused score with a lexical cross-score."""
    if not candidates or not query.strip():
        return candidates[:top_k]

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
