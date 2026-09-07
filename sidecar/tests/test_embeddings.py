from sidecar.infrastructure import embeddings as embeddings_module


# Captured during collection, before the suite's autouse speed fixture replaces the public
# single-vector functions. These tests intentionally exercise the real transport policy.
generate_embeddings_with_status = embeddings_module.generate_embeddings_with_status


class _Response:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def test_embedding_batch_uses_one_modern_ollama_request_and_allows_cold_load(monkeypatch):
    calls = []

    def fake_post(url, json, timeout):
        calls.append((url, json, timeout))
        return _Response(200, {"embeddings": [[1.0, 2.0], [3.0, 4.0]]})

    monkeypatch.setattr(embeddings_module.httpx_client, "post", fake_post)

    vectors, used_fallback = generate_embeddings_with_status(
        ["first chunk", "second chunk"],
        model="nomic-embed-text",
    )

    assert used_fallback is False
    assert len(calls) == 1
    assert calls[0][0].endswith("/api/embed")
    assert calls[0][1] == {
        "model": "nomic-embed-text",
        "input": ["first chunk", "second chunk"],
    }
    assert calls[0][2].connect == 2.0
    assert calls[0][2].read == 60.0
    assert len(vectors) == 2
    assert all(len(vector) == embeddings_module.EMBEDDING_DIM for vector in vectors)


def test_embedding_batch_falls_back_once_without_poisoning_later_requests(monkeypatch):
    outcomes = [ConnectionError("daemon unavailable"), _Response(200, {"embeddings": [[1.0, 2.0]]})]

    def fake_post(_url, json, timeout):
        assert timeout.connect == 2.0
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        assert json["input"] == ["retry after daemon recovery"]
        return outcome

    monkeypatch.setattr(embeddings_module.httpx_client, "post", fake_post)

    fallback_vectors, first_used_fallback = generate_embeddings_with_status(["offline chunk"])
    recovered_vectors, second_used_fallback = generate_embeddings_with_status(["retry after daemon recovery"])

    assert first_used_fallback is True
    assert second_used_fallback is False
    assert len(fallback_vectors[0]) == embeddings_module.EMBEDDING_DIM
    assert len(recovered_vectors[0]) == embeddings_module.EMBEDDING_DIM
    assert outcomes == []
