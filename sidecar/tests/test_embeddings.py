import json
import httpx
import numpy as np
import pytest
from sidecar.infrastructure import embeddings as module

# Capture the production entry point before the mechanics fixture replaces it.
generate = module.generate_embedding_batch
generate_legacy = module.generate_embeddings_with_status
DIGEST = "a" * 64

class Response:
    def __init__(self, payload, status=200):
        self.status_code = status
        self.payload = payload
    def json(self):
        return self.payload


def wire(monkeypatch, model="nomic-embed-text", dimension=768, vectors=None):
    calls = []
    canonical = model if ":" in model else model + ":latest"
    monkeypatch.setattr(module.httpx_client, "get", lambda *a, **k: Response({"models": [{"name": canonical, "digest": DIGEST}]}))
    def post(url, json, timeout):
        calls.append((url, json, timeout))
        if url.endswith("/api/show"):
            return Response({"model_info": {"encoder.embedding_length": dimension}})
        return Response({"embeddings": vectors if vectors is not None else [[1.0] * dimension for _ in json["input"]]})
    monkeypatch.setattr(module.httpx_client, "post", post)
    return calls


def test_batch_preserves_cold_load_timeout_and_disables_silent_input_truncation(monkeypatch):
    calls = wire(monkeypatch)
    result = generate(["first chunk", "second chunk"])
    embeds = [c for c in calls if c[0].endswith("/api/embed")]
    assert len(embeds) == 1
    assert embeds[0][1] == {"model": "nomic-embed-text", "input": ["search_document: first chunk", "search_document: second chunk"], "truncate": False}
    assert embeds[0][2].connect == 2.0
    assert embeds[0][2].read == 60.0
    assert not result.used_fallback
    assert result.space.embedding_model_digest == DIGEST
    assert all(len(v) == 768 and np.linalg.norm(v) == pytest.approx(1) for v in result.vectors)


@pytest.mark.parametrize("model,dimension", [("nomic-embed-text:v1.5", 768), ("qwen3-embedding:0.6b", 1024), ("qwen3-embedding:4b", 2560), ("qwen3-embedding:8b", 4096), ("bge-m3", 1024)])
def test_official_native_dimensions_keep_geometry(monkeypatch, model, dimension):
    a = [0.0] * dimension
    b = [0.0] * dimension
    a[-1], b[-2] = 2.0, 3.0
    wire(monkeypatch, model, dimension, [a, b])
    result = generate(["a", "b"], model)
    assert result.space.embedding_dimension == dimension
    assert len(result.vectors[0]) == dimension
    assert result.vectors[0][-1] == 1.0
    assert result.vectors[1][-2] == 1.0
    assert np.dot(*result.vectors) == 0.0


@pytest.mark.parametrize("vectors", [[], [[1.0, 2.0]], [[0.0]*768], [[True]*768], [["1"]*768], [[float("nan")]*768], [[float("inf")]*768], [None], [[1.0]*768, [1.0]*768]])
def test_malformed_vectors_fail_without_hash_fallback(monkeypatch, vectors):
    wire(monkeypatch, vectors=vectors)
    with pytest.raises(module.EmbeddingPolicyError):
        generate(["text"])


def test_transport_fallback_has_its_own_space_and_does_not_poison_recovery(monkeypatch):
    def unavailable(*a, **k):
        raise httpx.ConnectError("daemon unavailable")
    monkeypatch.setattr(module.httpx_client, "get", unavailable)
    fallback = generate(["offline"])
    assert fallback.space == module.FALLBACK_SPACE
    assert fallback.used_fallback
    wire(monkeypatch)
    recovered = generate(["recovered"])
    assert not recovered.used_fallback
    assert recovered.space.metadata()["embedding_space_id"] != fallback.space.metadata()["embedding_space_id"]


def test_expected_space_never_falls_back(monkeypatch):
    monkeypatch.setattr(module.httpx_client, "get", lambda *a, **k: (_ for _ in ()).throw(httpx.ConnectError("offline")))
    with pytest.raises(module.EmbeddingSpaceMismatchError, match="unavailable"):
        generate(["query"], expected_space=module.EmbeddingSpace("nomic-embed-text:latest", DIGEST, 768, embedding_preparation="nomic-search-v1"), role="query")


def test_native_metadata_and_policy_must_agree(monkeypatch):
    wire(monkeypatch, "qwen3-embedding:0.6b", 768)
    with pytest.raises(module.EmbeddingPolicyError, match="metadata conflicts"):
        generate(["text"], "qwen3-embedding:0.6b")
    with pytest.raises(module.EmbeddingPolicyError, match="No verified"):
        generate(["text"], "unknown-encoder")


def test_tag_digest_change_during_batch_discards_the_result(monkeypatch):
    wire(monkeypatch)
    digests = iter([DIGEST, "b"*64])
    monkeypatch.setattr(module.httpx_client, "get", lambda *a, **k: Response({"models": [{"name": "nomic-embed-text:latest", "digest": next(digests)}]}))
    with pytest.raises(module.EmbeddingSpaceMismatchError, match="changed during"):
        generate(["text"])


def test_existing_digest_mismatch_is_rejected_before_embedding(monkeypatch):
    calls = wire(monkeypatch)
    with pytest.raises(module.EmbeddingSpaceMismatchError, match="digest or policy"):
        generate(["query"], expected_space=module.EmbeddingSpace("nomic-embed-text:latest", "b"*64, 768, embedding_preparation="nomic-search-v1"), role="query")
    assert not any(url.endswith("/api/embed") for url, _, _ in calls)


def test_http_error_is_not_service_unavailability(monkeypatch):
    wire(monkeypatch)
    monkeypatch.setattr(module.httpx_client, "post", lambda *a, **k: Response({}, 400))
    with pytest.raises(module.EmbeddingPolicyError):
        generate(["text"])


@pytest.mark.parametrize("model,dimension,policy,document,query", [
    ("nomic-embed-text", 768, "nomic-search-v1", "search_document: Clausola AB-12", "search_query: Clausola AB-12"),
    ("nomic-embed-text:v1", 768, "nomic-search-v1", "search_document: Clausola AB-12", "search_query: Clausola AB-12"),
    ("nomic-embed-text:v1.5", 768, "nomic-search-v1", "search_document: Clausola AB-12", "search_query: Clausola AB-12"),
    ("qwen3-embedding:0.6b", 1024, "qwen3-retrieval-v1", "Clausola AB-12", "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:Clausola AB-12"),
    ("qwen3-embedding:4b", 2560, "qwen3-retrieval-v1", "Clausola AB-12", "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:Clausola AB-12"),
    ("qwen3-embedding:8b", 4096, "qwen3-retrieval-v1", "Clausola AB-12", "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:Clausola AB-12"),
    ("bge-m3", 1024, "raw-v1", "Clausola AB-12", "Clausola AB-12"),
])
def test_official_role_requests_share_the_policy_pair(monkeypatch, model, dimension, policy, document, query):
    calls = wire(monkeypatch, model, dimension)
    documents = generate(["Clausola AB-12"], model, role="document")
    queries = generate(["Clausola AB-12"], model, expected_space=documents.space, role="query")
    assert [body["input"] for url, body, _ in calls if url.endswith("/api/embed")] == [[document], [query]]
    assert documents.space.embedding_preparation == policy
    assert documents.space.metadata() == queries.space.metadata()


@pytest.mark.parametrize("model,dimension", [("nomic-embed-text", 768), ("qwen3-embedding:0.6b", 1024)])
def test_raw_index_refusal_happens_before_any_encoder_request(monkeypatch, model, dimension):
    calls = wire(monkeypatch, model, dimension)
    raw_space = module.EmbeddingSpace(model, DIGEST, dimension)
    before = raw_space.metadata()
    with pytest.raises(module.EmbeddingSpaceMismatchError, match="preparation changed"):
        generate(["query"], model, expected_space=raw_space, role="query")
    assert calls == []
    assert raw_space.metadata() == before


def test_legacy_prompt_history_keeps_raw_requests(monkeypatch):
    calls = wire(monkeypatch)
    monkeypatch.setattr(module, "generate_embedding_batch", generate)
    vectors, fallback = generate_legacy(["unchanged history"])
    assert [body["input"] for url, body, _ in calls if url.endswith("/api/embed")] == [["unchanged history"]]
    assert len(vectors[0]) == 768 and not fallback


def test_invalid_role_is_rejected_without_network(monkeypatch):
    calls = wire(monkeypatch)
    with pytest.raises(module.EmbeddingPolicyError, match="Unsupported embedding role"):
        generate(["text"], role="classification")
    assert calls == []


def test_preparation_is_preserved_across_batch_boundaries(monkeypatch):
    calls = wire(monkeypatch)
    texts = [f"testo {index}" for index in range(33)]
    generate(texts, role="query")
    inputs = [body["input"] for url, body, _ in calls if url.endswith("/api/embed")]
    assert list(map(len, inputs)) == [32, 1]
    assert [text for batch in inputs for text in batch] == [f"search_query: {text}" for text in texts]


def test_query_fallback_space_uses_original_text_without_a_task_prefix(monkeypatch):
    calls = wire(monkeypatch)
    result = generate(["query"], model=module.FALLBACK_EMBEDDING_MODEL, expected_space=module.FALLBACK_SPACE, role="query")
    assert result.space == module.FALLBACK_SPACE
    assert result.vectors == [module.get_fallback_embedding("query")]
    assert calls == []


def test_ingestion_and_search_persist_the_same_real_preparation_policy(tmp_path, monkeypatch):
    from sidecar.infrastructure import db
    from sidecar.services import ingest_service, search_service
    from sidecar.schemas import SearchRequest

    calls = wire(monkeypatch)
    monkeypatch.setattr(ingest_service, "generate_embedding_batch", generate)
    monkeypatch.setattr(search_service, "generate_embedding_batch", generate)
    path = tmp_path / "clause.md"
    path.write_text("Clausola AB-12: pagamento entro trenta giorni.", encoding="utf-8")
    events = [json.loads(event) for event in ingest_service.process_and_index_document_generator(str(path))]
    assert events[-1]["type"] == "done"
    doc_id = events[-1]["data"]["id"]
    rows = db.lance_db.open_table("chunks").to_arrow().to_pylist()
    assert all(row["embedding_preparation"] == "nomic-search-v1" for row in rows)
    results = search_service.perform_vector_search(SearchRequest(query="When is payment due?", doc_id=doc_id))
    assert results and all(result.doc_id == doc_id for result in results)
    inputs = [body["input"] for url, body, _ in calls if url.endswith("/api/embed")]
    assert all(text.startswith("search_document: ") for text in inputs[0])
    assert inputs[-1] == ["search_query: When is payment due?"]
    assert all(db.chunk_embedding_space(row).metadata()["embedding_space_id"] == row["embedding_space_id"] for row in rows)
