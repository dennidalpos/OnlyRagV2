import asyncio
import logging

from sidecar import main
from sidecar.schemas import SearchRequest


def test_vector_search_logs_metadata_without_query_body(monkeypatch, caplog):
    monkeypatch.setattr(main, "perform_vector_search", lambda request: [])
    with caplog.at_level(logging.INFO, logger="PythonSidecar"):
        assert asyncio.run(main.search_vector_db(SearchRequest(query="private dummy query token=dummy-secret"))) == []
    assert "vector search" in caplog.text
    assert "private dummy query" not in caplog.text
    assert "dummy-secret" not in caplog.text
