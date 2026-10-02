"""Actual LanceDB geometry and transactional preservation with declared vectors."""
import numpy as np
import pytest
from fastapi.testclient import TestClient

from sidecar.infrastructure import db
from sidecar.infrastructure.embeddings import EmbeddingSpace, EmbeddingBatch, EmbeddingSpaceMismatchError
from sidecar.services import ingest_service, search_service
from sidecar.schemas import SearchRequest
from sidecar.main import app
from _stream import ingest_path


def encoder_fixture(monkeypatch, dimension=1024, digest="a" * 64, preparation="qwen3-retrieval-v1"):
    space = EmbeddingSpace("qwen3-embedding:0.6b", digest, dimension, embedding_preparation=preparation)
    def generate(texts, **kwargs):
        vectors = []
        for text in texts:
            vector = [0.0] * dimension
            vector[-1 if "Alpha" in text else -2] = 1.0
            vectors.append(vector)
        return EmbeddingBatch(vectors, space)
    monkeypatch.setattr(ingest_service, "generate_embedding_batch", generate)
    monkeypatch.setattr(search_service, "generate_embedding_batch", generate)
    return space


def ingest(tmp_path, name, text):
    file = tmp_path / name
    file.write_text(text, encoding="utf-8")
    return ingest_path(TestClient(app), str(file), embedding_model="qwen3-embedding:0.6b")


def test_explicit_native_arrow_schema_keeps_distinct_tail_coordinates(tmp_path, monkeypatch):
    space = encoder_fixture(monkeypatch)
    ingest(tmp_path, "a.md", "Alpha clause")
    ingest(tmp_path, "b.md", "Beta clause")
    table = db.lance_db.open_table("chunks")
    assert table.schema.field("vector").type.list_size == 1024
    rows = table.to_arrow().to_pylist()
    assert all(row["embedding_space_id"] == space.metadata()["embedding_space_id"] for row in rows)
    assert np.dot(rows[0]["vector"], rows[1]["vector"]) == 0
    result = table.search(rows[0]["vector"]).limit(2).to_list()
    assert result[0]["_distance"] == pytest.approx(0)
    assert result[1]["_distance"] == pytest.approx(2)
    assert all(np.linalg.norm(row["vector"]) == pytest.approx(1) for row in rows)


def test_different_native_dimension_rejects_replacement_without_data_loss(tmp_path, monkeypatch):
    encoder_fixture(monkeypatch)
    doc = ingest(tmp_path, "a.md", "Alpha original")
    before = db.lance_db.open_table("documents").to_arrow().to_pylist(), db.lance_db.open_table("chunks").to_arrow().to_pylist()
    encoder_fixture(monkeypatch, 768)
    with pytest.raises(EmbeddingSpaceMismatchError, match="Index dimension is 1024"):
        ingest_service.update_and_reindex_document(doc["id"], "Alpha replacement")
    assert (db.lance_db.open_table("documents").to_arrow().to_pylist(), db.lance_db.open_table("chunks").to_arrow().to_pylist()) == before
    assert not db._journal_path.exists()


def test_selected_document_filter_does_not_query_another_digest(tmp_path, monkeypatch):
    first = encoder_fixture(monkeypatch)
    doc = ingest(tmp_path, "a.md", "Alpha original")
    second = encoder_fixture(monkeypatch, digest="b" * 64)
    ingest(tmp_path, "b.md", "Beta other")
    seen = []
    def query(texts, model, expected_space, *, role):
        assert role == "query"
        seen.append(expected_space)
        vector = [0.0] * 1024
        vector[-1] = 1
        return EmbeddingBatch([vector], expected_space)
    monkeypatch.setattr(search_service, "generate_embedding_batch", query)
    results = search_service.perform_vector_search(SearchRequest(query="Alpha", doc_id=doc["id"]))
    assert seen == [first]
    assert all(result.doc_id == doc["id"] for result in results)
    assert second not in seen


def test_legacy_search_and_append_preserve_original_schema_and_markdown(tmp_path, monkeypatch):
    encoder_fixture(monkeypatch)
    db.lance_db.create_table("chunks", data=[{"vector": [0.0, 1.0], "chunk_id": "old_0", "doc_id": "old"}])
    table = db.lance_db.open_table("chunks")
    before, version = table.to_arrow().to_pylist(), table.version
    with pytest.raises(EmbeddingSpaceMismatchError, match="Legacy index"):
        search_service.perform_vector_search(SearchRequest(query="anything"))
    file = tmp_path / "notes.md"
    file.write_text("Alpha source", encoding="utf-8")
    with pytest.raises(AssertionError, match="Legacy index"):
        ingest_path(TestClient(app), str(file))
    assert table.to_arrow().to_pylist() == before
    assert table.version == version
    assert "documents" not in db.get_existing_tables()
    assert file.read_text(encoding="utf-8") == "Alpha source"


def test_malformed_stored_provenance_never_reaches_vector_comparison(tmp_path, monkeypatch):
    encoder_fixture(monkeypatch)
    ingest(tmp_path, "a.md", "Alpha content")
    table = db.lance_db.open_table("chunks")
    table.update(values={"embedding_space_id": "tampered"})
    def forbidden(*args, **kwargs):
        raise AssertionError("query encoder must not be called")
    monkeypatch.setattr(search_service, "generate_embedding_batch", forbidden)
    with pytest.raises(EmbeddingSpaceMismatchError, match="malformed"):
        search_service.perform_vector_search(SearchRequest(query="Alpha"))


@pytest.mark.parametrize("replacement", [False, True])
def test_preparation_change_requires_rebuild_and_preserves_original_records(tmp_path, monkeypatch, replacement):
    encoder_fixture(monkeypatch, preparation="raw-v1")
    doc = ingest(tmp_path, "a.md", "Alpha original")
    before = db.lance_db.open_table("documents").to_arrow().to_pylist(), db.lance_db.open_table("chunks").to_arrow().to_pylist()
    encoder_fixture(monkeypatch)
    if replacement:
        with pytest.raises(EmbeddingSpaceMismatchError, match="preparation changed"):
            ingest_service.update_and_reindex_document(doc["id"], "Alpha replacement")
    else:
        with pytest.raises(AssertionError, match="preparation changed"):
            ingest(tmp_path, "b.md", "Beta new")
    assert (db.lance_db.open_table("documents").to_arrow().to_pylist(), db.lance_db.open_table("chunks").to_arrow().to_pylist()) == before
    assert not db._journal_path.exists()
    assert (tmp_path / "a.md").read_text(encoding="utf-8") == "Alpha original"
