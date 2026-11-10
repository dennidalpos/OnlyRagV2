"""Real native FTS, with declared vectors that deliberately miss exact evidence."""
import pytest
from pathlib import Path
import hashlib
import warnings

from sidecar.infrastructure import db
from sidecar.infrastructure.embeddings import EmbeddingBatch, EmbeddingSpace
from sidecar.schemas import SearchRequest
from sidecar.services import search_service


SPACE = EmbeddingSpace("fixture", "a" * 64, 2)


def files_digest(directory):
    return {str(p.relative_to(directory)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in directory.rglob("*") if p.is_file()}


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
    monkeypatch.setattr(LanceTable, "create_index", fail)
    with pytest.raises(RuntimeError, match="FTS unavailable"):
        search_service.perform_vector_search(SearchRequest(query="ZYX987"))


def test_supported_fts_api_preserves_tokenizer_behaviour(corpus, monkeypatch):
    from lancedb.table import LanceTable
    monkeypatch.setattr(LanceTable, "create_fts_index", lambda *a, **k: pytest.fail("Deprecated FTS API used"))
    corpus.update(where="doc_id = 'zzz_evidence'", values={"text": "running the Zéphyr987 " + "long" * 30})
    with warnings.catch_warnings():
        warnings.simplefilter("error", DeprecationWarning)
        assert search_service._lexical_candidates(corpus, "running", None, 10)[0]["doc_id"] == "zzz_evidence"
    # No stemming, no stop-word removal, no folding, and no default 40-character cutoff.
    assert search_service._lexical_candidates(corpus, "run", None, 10) == []
    assert search_service._lexical_candidates(corpus, "the", None, 10)[0]["doc_id"] == "zzz_evidence"
    assert search_service._lexical_candidates(corpus, "zéphyr987", None, 10)[0]["doc_id"] == "zzz_evidence"
    assert search_service._lexical_candidates(corpus, "Zephyr987", None, 10) == []
    assert search_service._lexical_candidates(corpus, "long" * 30, None, 10)[0]["doc_id"] == "zzz_evidence"
    assert {(index.name, tuple(index.columns), index.index_type) for index in corpus.list_indices()} == {
        (f"onlyrag_lexical_{column}_v1", (column,), "FTS") for column in search_service._LEXICAL_COLUMNS
    }


def test_existing_deprecated_api_indexes_are_reused_without_replacement(corpus, monkeypatch):
    from lancedb.table import LanceTable
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        for column in search_service._LEXICAL_COLUMNS:
            corpus.create_fts_index(column, name=f"onlyrag_lexical_{column}_v1", stem=False,
                                    remove_stop_words=False, max_token_length=None, ascii_folding=False)
    indices = Path(corpus.uri) / "_indices"
    before = files_digest(indices)
    assert before
    monkeypatch.setattr(LanceTable, "create_index", lambda *a, **k: pytest.fail("Existing native index must not be replaced"))
    assert search_service.perform_vector_search(SearchRequest(query="ZYX987", top_k=1))[0].doc_id == "zzz_evidence"
    assert files_digest(indices) == before


@pytest.mark.parametrize("kind", ["scalar", "wrong-column", "tantivy"])
def test_incompatible_indexes_are_refused_without_mutation(corpus, kind):
    if kind == "tantivy":
        retained = Path(corpus.uri) / "_indices" / "fts" / "retained.bin"
        retained.parent.mkdir(parents=True)
        retained.write_bytes(b"incompatible retained data")
    else:
        from lancedb.index import BTree, FTS
        corpus.create_index("text" if kind == "scalar" else "doc_name", name="onlyrag_lexical_text_v1",
                            config=BTree() if kind == "scalar" else FTS())
    before = files_digest(Path(corpus.uri))
    with pytest.raises((ValueError, RuntimeError), match="Legacy Tantivy|Incompatible lexical"):
        search_service.perform_vector_search(SearchRequest(query="ZYX987"))
    assert files_digest(Path(corpus.uri)) == before
    if kind == "tantivy":
        assert retained.read_bytes() == b"incompatible retained data"


def test_stale_index_inventory_never_replaces_a_concurrently_created_index(corpus, monkeypatch):
    from lancedb.index import FTS
    corpus.create_index("text", name="onlyrag_lexical_text_v1", config=FTS())
    before = files_digest(Path(corpus.uri))
    monkeypatch.setattr(corpus, "list_indices", lambda: [])
    with pytest.raises((ValueError, RuntimeError), match="already exists"):
        search_service._lexical_candidates(corpus, "ZYX987", None, 10)
    assert files_digest(Path(corpus.uri)) == before
