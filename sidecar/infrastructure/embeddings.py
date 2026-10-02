import hashlib
import json
import re
from dataclasses import asdict, dataclass
from numbers import Real
from typing import List, Literal, Sequence, Tuple

import numpy as np
from httpx import Timeout, TransportError

from sidecar.config import OLLAMA_BASE_URL, httpx_client, logger

EMBEDDING_BATCH_SIZE = 32
DEFAULT_EMBEDDING_MODEL = "nomic-embed-text"
FALLBACK_EMBEDDING_MODEL = "fallback-hash"
FALLBACK_DIMENSION = 768
EmbeddingRole = Literal["document", "query", "raw"]
QWEN_RETRIEVAL_INSTRUCTION = "Given a web search query, retrieve relevant passages that answer the query"


class EmbeddingPolicyError(RuntimeError):
    """Malformed or unverified embeddings cannot enter the index."""


class EmbeddingSpaceMismatchError(RuntimeError):
    """The existing vectors require an explicit backed-up rebuild."""


@dataclass(frozen=True)
class EmbeddingSpace:
    embedding_model: str
    embedding_model_digest: str
    embedding_dimension: int
    embedding_policy_version: str = "native-v1"
    embedding_normalization: str = "l2-v1"
    embedding_preparation: str = "raw-v1"

    def metadata(self) -> dict:
        values = asdict(self)
        values["embedding_space_id"] = hashlib.sha256(
            json.dumps(values, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        return values


@dataclass(frozen=True)
class EmbeddingBatch:
    vectors: List[List[float]]
    space: EmbeddingSpace

    @property
    def used_fallback(self) -> bool:
        return self.space.embedding_model == FALLBACK_EMBEDDING_MODEL


FALLBACK_SPACE = EmbeddingSpace(FALLBACK_EMBEDDING_MODEL, "sha256-word-randomstate-v1", FALLBACK_DIMENSION)


def get_fallback_embedding(text: str, dim: int = FALLBACK_DIMENSION) -> List[float]:
    """Deterministic word-hash vectors; no semantic-quality claim."""
    words = (text or "").lower().split() or [text or "empty"]
    vec = np.zeros(dim, dtype=np.float64)
    for word in words:
        seed = int(hashlib.sha256(word.encode("utf-8", errors="ignore")).hexdigest()[:8], 16)
        vec += np.random.RandomState(seed).randn(dim)
    return (vec / np.linalg.norm(vec)).tolist()


def _native_dimension(model: str) -> int:
    name, _, tag = model.lower().partition(":")
    if name == "nomic-embed-text" and tag in ("", "latest", "v1", "v1.5"):
        return 768
    if name == "bge-m3":
        return 1024
    if name == "qwen3-embedding":
        for size, dimension in (("0.6b", 1024), ("4b", 2560), ("8b", 4096)):
            if tag == size or tag.startswith(size + "-"):
                return dimension
    raise EmbeddingPolicyError(f"No verified native-dimension policy for encoder '{model}'.")


def _model_digest(model: str, ollama_url: str) -> str:
    response = httpx_client.get(f"{ollama_url}/api/tags", timeout=Timeout(15.0, connect=2.0))
    if response.status_code != 200:
        raise EmbeddingPolicyError(f"Cannot resolve local encoder digest: HTTP {response.status_code}.")
    payload = response.json()
    models = payload.get("models") if isinstance(payload, dict) else None
    if not isinstance(models, list):
        raise EmbeddingPolicyError("Invalid local encoder catalog.")
    canonical = model if ":" in model else model + ":latest"
    digests = [entry.get("digest") for entry in models if isinstance(entry, dict) and entry.get("name") == canonical]
    if len(digests) != 1 or not isinstance(digests[0], str) or not re.fullmatch(r"(?:sha256:)?[0-9a-f]{64}", digests[0]):
        raise EmbeddingPolicyError(f"Encoder '{model}' has no unique verified local digest.")
    return digests[0].removeprefix("sha256:")


def _preparation_policy(model: str, role: EmbeddingRole) -> str:
    if role not in ("document", "query", "raw"):
        raise EmbeddingPolicyError(f"Unsupported embedding role '{role}'.")
    name = model.lower().partition(":")[0]
    if role != "raw" and name == "nomic-embed-text":
        return "nomic-search-v1"
    if role != "raw" and name == "qwen3-embedding":
        return "qwen3-retrieval-v1"
    return "raw-v1"


def _prepare_text(text: str, preparation: str, role: EmbeddingRole) -> str:
    if preparation == "nomic-search-v1":
        return f"search_{role}: {text}"
    if preparation == "qwen3-retrieval-v1" and role == "query":
        return f"Instruct: {QWEN_RETRIEVAL_INSTRUCTION}\nQuery:{text}"
    return text


def resolve_embedding_space(
    model: str, ollama_url: str = OLLAMA_BASE_URL, *, role: EmbeddingRole = "document",
) -> EmbeddingSpace:
    dimension = _native_dimension(model)
    digest = _model_digest(model, ollama_url)
    response = httpx_client.post(f"{ollama_url}/api/show", json={"model": model}, timeout=Timeout(15.0, connect=2.0))
    if response.status_code != 200:
        raise EmbeddingPolicyError(f"Cannot verify encoder metadata: HTTP {response.status_code}.")
    payload = response.json()
    info = payload.get("model_info") if isinstance(payload, dict) else None
    lengths = [value for key, value in info.items() if key.endswith(".embedding_length")] if isinstance(info, dict) else []
    if len(lengths) != 1 or type(lengths[0]) is not int or lengths[0] != dimension:
        raise EmbeddingPolicyError(f"Encoder '{model}' metadata conflicts with native dimension {dimension}.")
    canonical = model if ":" in model else model + ":latest"
    return EmbeddingSpace(canonical, digest, dimension, embedding_preparation=_preparation_policy(model, role))


def validate_embedding_vectors(vectors, count: int, dimension: int) -> List[List[float]]:
    if not isinstance(vectors, list) or len(vectors) != count:
        raise EmbeddingPolicyError("Invalid embedding batch cardinality.")
    normalized = []
    for vector in vectors:
        if not isinstance(vector, list) or len(vector) != dimension:
            raise EmbeddingPolicyError(f"Expected exactly {dimension} embedding components; no padding or truncation is allowed.")
        if any(isinstance(value, bool) or not isinstance(value, Real) for value in vector):
            raise EmbeddingPolicyError("Embedding components must be real numbers, excluding booleans.")
        array = np.asarray(vector, dtype=np.float64)
        norm = np.linalg.norm(array)
        if not np.isfinite(array).all() or not np.isfinite(norm) or norm == 0:
            raise EmbeddingPolicyError("Embedding vectors must be finite with a nonzero finite norm.")
        normalized.append((array / norm).tolist())
    return normalized


def generate_embedding_batch(
    texts: Sequence[str], model: str = DEFAULT_EMBEDDING_MODEL, ollama_url: str = OLLAMA_BASE_URL,
    expected_space: EmbeddingSpace | None = None, *, role: EmbeddingRole = "document",
) -> EmbeddingBatch:
    requested = list(texts)
    if not requested:
        raise EmbeddingPolicyError("An embedding batch must contain text.")
    preparation = _preparation_policy(model, role)
    if expected_space == FALLBACK_SPACE:
        return EmbeddingBatch([get_fallback_embedding(text) for text in requested], FALLBACK_SPACE)
    _native_dimension(model)
    if expected_space is not None and expected_space.embedding_preparation != preparation:
        raise EmbeddingSpaceMismatchError("Encoder preparation changed; explicitly rebuild from preserved Markdown with verified backup/readback/rollback.")
    try:
        space = resolve_embedding_space(model, ollama_url, role=role)
        if expected_space is not None and space != expected_space:
            raise EmbeddingSpaceMismatchError("Encoder digest or policy changed; explicitly rebuild the index from preserved Markdown with verified backup/readback/rollback.")
        vectors = []
        for start in range(0, len(requested), EMBEDDING_BATCH_SIZE):
            batch = [_prepare_text(text, preparation, role) for text in requested[start:start + EMBEDDING_BATCH_SIZE]]
            response = httpx_client.post(
                f"{ollama_url}/api/embed", json={"model": model, "input": batch, "truncate": False},
                timeout=Timeout(60.0, connect=2.0),
            )
            if response.status_code != 200:
                raise EmbeddingPolicyError(f"Encoder request failed: HTTP {response.status_code}; no vectors were accepted.")
            payload = response.json()
            vectors.extend(validate_embedding_vectors(
                payload.get("embeddings") if isinstance(payload, dict) else None, len(batch), space.embedding_dimension,
            ))
        if _model_digest(model, ollama_url) != space.embedding_model_digest:
            raise EmbeddingSpaceMismatchError("Encoder changed during embedding; no vectors were accepted.")
        return EmbeddingBatch(vectors, space)
    except TransportError:
        if expected_space is not None:
            raise EmbeddingSpaceMismatchError("The stored encoder is unavailable; hash vectors cannot query its space.") from None
        logger.warning("Local encoder transport unavailable; using a separate versioned word-hash space.")
        return EmbeddingBatch([get_fallback_embedding(text) for text in requested], FALLBACK_SPACE)


def generate_embeddings_with_status(texts: Sequence[str], model: str = DEFAULT_EMBEDDING_MODEL, ollama_url: str = OLLAMA_BASE_URL) -> Tuple[List[List[float]], bool]:
    if not texts:
        return [], False
    # Legacy prompt history has no space provenance; keep it raw until its explicit rebuild.
    batch = generate_embedding_batch(texts, model, ollama_url, role="raw")
    return batch.vectors, batch.used_fallback


def generate_embedding_with_status(text: str, model: str = DEFAULT_EMBEDDING_MODEL, ollama_url: str = OLLAMA_BASE_URL) -> Tuple[List[float], bool]:
    vectors, fallback = generate_embeddings_with_status([text], model, ollama_url)
    return vectors[0], fallback


def generate_embedding(text: str, model: str = DEFAULT_EMBEDDING_MODEL, ollama_url: str = OLLAMA_BASE_URL) -> List[float]:
    return generate_embedding_with_status(text, model, ollama_url)[0]
