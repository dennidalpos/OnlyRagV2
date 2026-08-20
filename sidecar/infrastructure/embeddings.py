import datetime
import numpy as np
from typing import List, Tuple
from sidecar.config import EMBEDDING_DIM, httpx_client, logger

OLLAMA_EMBED_FAILURE_COUNT: int = 0
OLLAMA_EMBED_DISABLED_UNTIL: float = 0.0

import hashlib

def get_fallback_embedding(text: str, dim: int = EMBEDDING_DIM) -> List[float]:
    """Generates a deterministic normalized pseudo-embedding vector when LLM embedding API is offline."""
    seed_int = int(hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()[:8], 16)
    rng = np.random.RandomState(seed_int)
    vec = rng.randn(dim)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()

def generate_embedding_with_status(
    text: str,
    model: str = "nomic-embed-text",
    ollama_url: str = "http://127.0.0.1:11434"
) -> Tuple[List[float], bool]:
    """Generates text embedding returning both the vector and a boolean indicating whether fallback was used."""
    global OLLAMA_EMBED_FAILURE_COUNT, OLLAMA_EMBED_DISABLED_UNTIL
    now = datetime.datetime.now().timestamp()
    vec: List[float] | None = None
    is_fallback = False

    if now > OLLAMA_EMBED_DISABLED_UNTIL:
        candidate_models = [m for m in [model, "nomic-embed-text", "all-minilm", "bge-m3", "mxbai-embed-large"] if m]

        for embed_m in candidate_models:
            try:
                payload = {"model": embed_m, "prompt": text}
                response = httpx_client.post(f"{ollama_url}/api/embeddings", json=payload, timeout=5.0)

                if response.status_code == 200:
                    data = response.json()
                    embedding = data.get("embedding", [])
                    if embedding and isinstance(embedding, list) and len(embedding) > 0:
                        vec = embedding
                        OLLAMA_EMBED_FAILURE_COUNT = 0
                        break
            except Exception as err:
                logger.debug(f"Ollama embedding call for {embed_m} failed: {err}")
                continue

        if not vec:
            OLLAMA_EMBED_FAILURE_COUNT += 1
            if OLLAMA_EMBED_FAILURE_COUNT >= 3:
                OLLAMA_EMBED_DISABLED_UNTIL = now + 30.0
                logger.info("Ollama embedding API unreachable or model missing. Pausing API retry for 30s.")

    if not vec:
        vec = get_fallback_embedding(text, dim=EMBEDDING_DIM)
        is_fallback = True

    # Guarantee exact EMBEDDING_DIM dimension length for LanceDB column stability
    if len(vec) < EMBEDDING_DIM:
        vec = vec + [0.0] * (EMBEDDING_DIM - len(vec))
    elif len(vec) > EMBEDDING_DIM:
        vec = vec[:EMBEDDING_DIM]

    return vec, is_fallback

def generate_embedding(text: str, model: str = "nomic-embed-text", ollama_url: str = "http://127.0.0.1:11434") -> List[float]:
    """Generates text embedding using local Ollama Embeddings API with dynamic model selection and fallback."""
    vec, _ = generate_embedding_with_status(text, model=model, ollama_url=ollama_url)
    return vec
