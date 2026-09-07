import hashlib
from typing import List, Sequence, Tuple

import numpy as np
from httpx import Timeout

from sidecar.config import EMBEDDING_DIM, OLLAMA_BASE_URL, httpx_client, logger

EMBEDDING_BATCH_SIZE = 32

def get_fallback_embedding(text: str, dim: int = EMBEDDING_DIM) -> List[float]:
    """Generates a deterministic normalized pseudo-embedding vector with semantic word overlap when LLM embedding API is offline."""
    words = [w for w in (text or "").lower().split() if w]
    if not words:
        words = [text or "empty"]
    vec = np.zeros(dim, dtype=np.float64)
    for word in words:
        seed_int = int(hashlib.sha256(word.encode("utf-8", errors="ignore")).hexdigest()[:8], 16)
        rng = np.random.RandomState(seed_int)
        vec += rng.randn(dim)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()

def _fit_embedding_dimension(vec: Sequence[float]) -> List[float]:
    """Keeps the persisted LanceDB vector column at its configured fixed size."""
    fitted = list(vec)
    if len(vec) < EMBEDDING_DIM:
        fitted.extend([0.0] * (EMBEDDING_DIM - len(vec)))
    elif len(vec) > EMBEDDING_DIM:
        fitted = fitted[:EMBEDDING_DIM]
    return fitted


def generate_embeddings_with_status(
    texts: Sequence[str],
    model: str = "nomic-embed-text",
    ollama_url: str = OLLAMA_BASE_URL
) -> Tuple[List[List[float]], bool]:
    """Embeds one ingestion batch and reports whether deterministic fallback vectors were used.

    A single batched request prevents the former cold-start race where four chunk workers each
    timed out after five seconds and collectively disabled Ollama for the rest of the ingestion.
    The short connect timeout still fails quickly when the daemon is offline, while the read
    timeout gives an installed model enough time to load on first use.
    """
    requested_texts = list(texts)
    if not requested_texts:
        return [], False

    try:
        vectors: List[List[float]] = []
        for start in range(0, len(requested_texts), EMBEDDING_BATCH_SIZE):
            batch = requested_texts[start:start + EMBEDDING_BATCH_SIZE]
            response = httpx_client.post(
                f"{ollama_url}/api/embed",
                json={"model": model, "input": batch},
                timeout=Timeout(60.0, connect=2.0),
            )
            if response.status_code != 200:
                raise RuntimeError(f"HTTP {response.status_code}")

            data = response.json()
            embeddings = data.get("embeddings", [])
            if (
                not isinstance(embeddings, list)
                or len(embeddings) != len(batch)
                or not all(isinstance(vec, list) and vec for vec in embeddings)
            ):
                raise ValueError("invalid embedding batch")
            vectors.extend(_fit_embedding_dimension(vec) for vec in embeddings)

        return vectors, False
    except Exception as err:
        logger.warning(
            f"Ollama embedding request for {model} failed ({err}); using deterministic fallback vectors."
        )

    return [get_fallback_embedding(text, dim=EMBEDDING_DIM) for text in requested_texts], True


def generate_embedding_with_status(
    text: str,
    model: str = "nomic-embed-text",
    ollama_url: str = OLLAMA_BASE_URL
) -> Tuple[List[float], bool]:
    """Generates one text embedding and reports whether deterministic fallback was used."""
    vectors, is_fallback = generate_embeddings_with_status([text], model=model, ollama_url=ollama_url)
    return vectors[0], is_fallback

def generate_embedding(text: str, model: str = "nomic-embed-text", ollama_url: str = OLLAMA_BASE_URL) -> List[float]:
    """Generates text embedding using local Ollama Embeddings API with dynamic model selection and fallback."""
    vec, _ = generate_embedding_with_status(text, model=model, ollama_url=ollama_url)
    return vec
