"""Real native FTS, with declared vectors that deliberately miss exact evidence."""
import pytest

from sidecar.infrastructure import db
from sidecar.infrastructure.embeddings import EmbeddingBatch, EmbeddingSpace
from sidecar.schemas import SearchRequest
from sidecar.services import search_service


SPACE = EmbeddingSpace("fixture", "a" * 64, 2)


def chunk(identifier, text="ordinary unrelated passage", **values):
    return {
        "chunk_id": identifier, "doc_id": identifier, "doc_name": "ordinary.md",
        "text": text, "section_header": "General", "chunk_index": 0,
        "file_type": "md", "ingested_at": "2026-10-02", "vector": [1.0, 0.0],
        **SPACE.metadata(), **values,
    }


@pytest.fixture
def corpus(monkeypatch):
    records = [chunk(f"noise_{i}") for i in range(70)]
    records.append(chunk("zzz_evidence", "Contract ZYX987: delivery within thirty days.", vector=[0.0, 1.0]))
    table = db.append_records("chunks", records)
    monkeypatch.setattr(search_service, "generate_embedding_batch", lambda texts, **kwargs: EmbeddingBatch([[1.0, 0.0]], SPACE))
    return table


@pytest.mark.parametrize("field,query,value", [
    ("text", "ZYX987", "Contract ZYX987: delivery within thirty days."),
    ("doc_name", "Zéphyr987", "Zéphyr987.md"),
    ("section_header", "clausola987", "clausola987 consegna"),
    ("text", "AB-17/42", "AB-17/42 identifies the required replacement."),
    ("text", "XY", "XY identifies the required replacement."),
    ("text", "delivery within thirty days", "Delivery within thirty days is mandatory."),
])
def test_lexical_evidence_outside_dense_shortlist_enters_results(corpus, field, query, value):
    corpus.update(where="doc_id = 'zzz_evidence'", values={field: value})
    dense = corpus.search([1.0, 0.0]).limit(50).to_list()
    assert "zzz_evidence" not in {row["chunk_id"] for row in dense}
    result = search_service.perform_vector_search(SearchRequest(query=query, top_k=1))
    assert [row.chunk_id for row in result] == ["zzz_evidence"]


def test_fts_prefilter_retrieves_selected_documents_before_limit(corpus):
    corpus.update(where="doc_id != 'zzz_evidence'", values={"text": "ZYX987"})
    result = search_service.perform_vector_search(SearchRequest(query="ZYX987", doc_ids=["zzz_evidence"], top_k=1))
    assert [row.doc_id for row in result] == ["zzz_evidence"]
    assert search_service.perform_vector_search(SearchRequest(query="ZYX987", doc_ids=["' OR 1=1"])) == []


def test_new_replaced_and_deleted_rows_remain_correct_without_optimize(corpus):
    search_service.perform_vector_search(SearchRequest(query="ZYX987"))
    db.append_records("chunks", [chunk("later", "NEWCODE789", vector=[0.0, 1.0])])
    assert search_service.perform_vector_search(SearchRequest(query="NEWCODE789", top_k=1))[0].chunk_id == "later"
    db.append_records("chunks", [chunk("later", "REPLACED789", vector=[0.0, 1.0])], delete_where="doc_id = 'later'", match_key="chunk_id")
    assert corpus.search("NEWCODE789", query_type="fts", fts_columns="text").to_list() == []
    assert search_service.perform_vector_search(SearchRequest(query="REPLACED789", top_k=1))[0].chunk_id == "later"
    db.delete_document_records("later")
    latest = db.lance_db.open_table("chunks")
    assert latest.count_rows("doc_id = 'later'") == 0
    assert latest.search("REPLACED789", query_type="fts", fts_columns="text").to_list() == []
    assert all(row.chunk_id != "later" for row in search_service.perform_vector_search(SearchRequest(query="REPLACED789")))


def test_ranks_are_traceable_and_search_preserves_rows(corpus, monkeypatch):
    captured = []
    rerank = search_service.rerank_candidates
    def record(**kwargs):
        captured.extend(kwargs["candidates"])
        return rerank(**kwargs)
    monkeypatch.setattr(search_service, "rerank_candidates", record)
    before = corpus.to_arrow().to_pylist()
    search_service.perform_vector_search(SearchRequest(query="ZYX987", top_k=1))
    evidence = next(row for row in captured if row["chunk_id"] == "zzz_evidence")
    assert evidence["dense_rank"] is None
    assert evidence["lexical_rank"] == 1
    assert evidence["rrf_score"] == pytest.approx(1 / 61)
    assert evidence["fused_rank"] == 2
    assert corpus.to_arrow().to_pylist() == before
    indexes = list(corpus.list_indices())
    search_service.perform_vector_search(SearchRequest(query="ZYX987"))
    assert list(corpus.list_indices()) == indexes


def test_pending_recovery_blocks_fts_creation(corpus):
    db._journal_path.write_text("{}", encoding="utf-8")
    try:
        with pytest.raises(db.DatabaseRecoveryError):
            search_service.perform_vector_search(SearchRequest(query="ZYX987"))
        assert list(corpus.list_indices()) == []
    finally:
        db._journal_path.unlink()


def test_fts_failure_is_not_silently_replaced_by_dense_search(corpus, monkeypatch):
    from lancedb.table import LanceTable
    def fail(*args, **kwargs):
        raise RuntimeError("FTS unavailable")
    monkeypatch.setattr(LanceTable, "create_fts_index", fail)
    with pytest.raises(RuntimeError, match="FTS unavailable"):
        search_service.perform_vector_search(SearchRequest(query="ZYX987"))
