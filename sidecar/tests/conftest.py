import pytest
import sidecar.infrastructure.embeddings as embeddings_module

@pytest.fixture(autouse=True)
def fast_fallback_embeddings(monkeypatch):
    """Ensure unit and regression tests run instantly using deterministic embeddings without external network timeouts."""
    def fake_generate_embedding_with_status(text, model="nomic-embed-text", ollama_url="http://127.0.0.1:11434"):
        return embeddings_module.get_fallback_embedding(text, dim=embeddings_module.EMBEDDING_DIM), False

    def fake_generate_embedding(text, model="nomic-embed-text", ollama_url="http://127.0.0.1:11434"):
        return embeddings_module.get_fallback_embedding(text, dim=embeddings_module.EMBEDDING_DIM)

    monkeypatch.setattr(embeddings_module, "generate_embedding_with_status", fake_generate_embedding_with_status)
    monkeypatch.setattr(embeddings_module, "generate_embedding", fake_generate_embedding)
