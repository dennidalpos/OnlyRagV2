"""Native isolated stores and declared encoders; no live inference or user-store migration."""
from dataclasses import replace
from unittest.mock import Mock

import pytest
import httpx
import lancedb

from sidecar.config import PROMPT_HISTORY_TABLE_NAME
from sidecar.infrastructure import db
from sidecar.infrastructure.embeddings import EmbeddingBatch, EmbeddingSpace, EmbeddingSpaceMismatchError, FALLBACK_SPACE
from sidecar.infrastructure.embeddings import generate_embedding_batch as production_generate
from sidecar.infrastructure import embeddings
from sidecar.schemas import IndexPromptHistoryRequest, PromptHistorySearchRequest
from sidecar.services import prompt_history_service as service

SPACE = EmbeddingSpace("synthetic-history", "a" * 64, 2)


def request():
    return IndexPromptHistoryRequest(id="prompt", session_id="session", project_path="C:/isolated/project",
                                     prompt="Original text", summary="Original summary", outcome="success", started_at="2026-10-20")


def seed(space=SPACE):
    db.append_records(PROMPT_HISTORY_TABLE_NAME, [{
        "id": "prompt", "session_id": "session", "project_id": service.compute_project_id("C:/isolated/project"),
        "prompt": "Original text", "vector": [1.0, 0.0], **space.metadata(),
    }])


def snapshot():
    table = db.lance_db.open_table(PROMPT_HISTORY_TABLE_NAME)
    return table.version, table.to_arrow().to_pylist()


def test_new_history_stores_exact_encoder_space_and_normalized_vectors(monkeypatch):
    encode = Mock(return_value=EmbeddingBatch([[3.0, 4.0]], SPACE))
    monkeypatch.setattr(service, "generate_embedding_batch", encode)
    service.index_prompt_history(request())
    encode.assert_called_once_with(["Original text\n\nOriginal summary"], role="document")
    row = snapshot()[1][0]
    assert row["vector"] == pytest.approx([0.6, 0.8])
    assert {key: row[key] for key in SPACE.metadata()} == SPACE.metadata()
    assert row["prompt"] == "Original text" and row["summary"] == "Original summary"


def test_search_uses_stored_model_space_query_role_and_preserves_records(monkeypatch):
    seed()
    before = snapshot()
    encode = Mock(return_value=EmbeddingBatch([[1.0, 0.0]], SPACE))
    monkeypatch.setattr(service, "generate_embedding_batch", encode)
    results = service.search_prompt_history(PromptHistorySearchRequest(query="query"))
    encode.assert_called_once_with(["query"], model=SPACE.embedding_model, expected_space=SPACE, role="query")
    assert [(item.id, item.score) for item in results] == [("prompt", 1.0)]
    assert snapshot() == before


def test_transport_fallback_space_survives_reopen_without_switching_encoder(monkeypatch):
    monkeypatch.setattr(service, "generate_embedding_batch", production_generate)
    unavailable = Mock(side_effect=httpx.ConnectError("Synthetic offline transport"))
    monkeypatch.setattr(embeddings.httpx_client, "get", unavailable)
    service.index_prompt_history(request())
    before = snapshot()
    assert {key: before[1][0][key] for key in FALLBACK_SPACE.metadata()} == FALLBACK_SPACE.metadata()
    unavailable.assert_called_once()
    monkeypatch.setattr(embeddings.httpx_client, "get", Mock(side_effect=AssertionError("Stored hash space must not switch to a live model")))
    db.lance_db.__init__(db.LANCEDB_DIR, session=lancedb.Session())
    results = service.search_prompt_history(PromptHistorySearchRequest(query="Original text"))
    assert [item.id for item in results] == ["prompt"]
    assert snapshot() == before


@pytest.mark.parametrize("operation", ["search", "index"])
@pytest.mark.parametrize("changed", [replace(SPACE, embedding_model_digest="b" * 64),
                                       replace(SPACE, embedding_model="fallback-hash"),
                                       replace(SPACE, embedding_preparation="different-v1"),
                                       replace(SPACE, embedding_dimension=3)])
def test_incompatible_encoder_is_refused_without_mutation(monkeypatch, operation, changed):
    seed()
    before = snapshot()
    monkeypatch.setattr(service, "generate_embedding_batch", lambda *args, **kwargs: EmbeddingBatch([[1.0] * changed.embedding_dimension], changed))
    with pytest.raises(EmbeddingSpaceMismatchError, match="spaces differ"):
        if operation == "search":
            service.search_prompt_history(PromptHistorySearchRequest(query="query"))
        else:
            service.index_prompt_history(request())
    assert snapshot() == before


@pytest.mark.parametrize("operation", ["search", "index"])
@pytest.mark.parametrize("provenance", ["legacy", "forged", "mixed", "dimension"])
def test_untrusted_existing_history_is_preserved_before_any_encoding(monkeypatch, operation, provenance):
    metadata = {} if provenance == "legacy" else SPACE.metadata()
    if provenance == "forged":
        metadata["embedding_space_id"] = "0" * 64
    if provenance == "dimension":
        metadata = replace(SPACE, embedding_dimension=3).metadata()
    rows = [{"id": "prompt", "prompt": "Preserved source", "vector": [1.0, 0.0], **metadata}]
    if provenance == "mixed":
        rows.append({**rows[0], "id": "other", **replace(SPACE, embedding_model_digest="b" * 64).metadata()})
    db.append_records(PROMPT_HISTORY_TABLE_NAME, rows)
    before = snapshot()
    encode = Mock(side_effect=AssertionError("Untrusted store must be refused before inference"))
    monkeypatch.setattr(service, "generate_embedding_batch", encode)
    with pytest.raises(EmbeddingSpaceMismatchError):
        if operation == "search":
            service.search_prompt_history(PromptHistorySearchRequest(query="query"))
        else:
            service.index_prompt_history(request())
    encode.assert_not_called()
    assert snapshot() == before


@pytest.mark.parametrize("operation", ["search", "index"])
def test_concurrent_history_change_during_encoding_is_not_overwritten(monkeypatch, operation):
    seed()
    def encode(*args, **kwargs):
        db.lance_db.open_table(PROMPT_HISTORY_TABLE_NAME).update(where='id = "prompt"', values={"prompt": "Concurrent edit"})
        return EmbeddingBatch([[1.0, 0.0]], SPACE)
    monkeypatch.setattr(service, "generate_embedding_batch", encode)
    with pytest.raises(db.DatabaseConflictError, match="changed during"):
        if operation == "search":
            service.search_prompt_history(PromptHistorySearchRequest(query="query"))
        else:
            service.index_prompt_history(request())
    assert snapshot()[1][0]["prompt"] == "Concurrent edit"


@pytest.mark.parametrize("vector", [[0.0, 0.0], [float("nan"), 1.0], [True, 1.0], [1.0]])
def test_invalid_vectors_do_not_replace_an_existing_prompt(monkeypatch, vector):
    seed()
    before = snapshot()
    monkeypatch.setattr(service, "generate_embedding_batch", lambda *args, **kwargs: EmbeddingBatch([vector], SPACE))
    with pytest.raises(RuntimeError):
        service.index_prompt_history(request())
    assert snapshot() == before
