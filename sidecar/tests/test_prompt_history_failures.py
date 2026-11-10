from types import SimpleNamespace
from unittest.mock import Mock
from concurrent.futures import ThreadPoolExecutor
from threading import Event
import math

import pytest
from fastapi.testclient import TestClient

from sidecar import main
from sidecar.config import PROMPT_HISTORY_TABLE_NAME
from sidecar.infrastructure import db
from sidecar.infrastructure.embeddings import EmbeddingSpace
from sidecar.schemas import IndexPromptHistoryRequest, PromptHistoryRemoveRequest, PromptHistorySearchRequest
from sidecar.services import prompt_history_service as service

SPACE = EmbeddingSpace("synthetic-history", "f" * 64, 2)


@pytest.mark.parametrize("failure", ["encoder", "open", "search", "catalog"])
def test_search_failure_is_unavailable_over_http(monkeypatch, failure):
    db.append_records(PROMPT_HISTORY_TABLE_NAME, [{"id": "retained", "vector": [1.0, 0.0], **SPACE.metadata()}])
    monkeypatch.setattr(service, "_history_embedding", lambda *_: ([1.0, 0.0], SPACE))
    broken = Mock(side_effect=RuntimeError("Storage unavailable"))
    if failure == "encoder":
        monkeypatch.setattr(service, "_history_embedding", broken)
    elif failure == "open":
        monkeypatch.setattr(service.lance_db, "open_table", broken)
    elif failure == "search":
        monkeypatch.setattr(service.lance_db, "open_table", lambda _: SimpleNamespace(search=broken))
    else:
        monkeypatch.setattr(service, "get_existing_tables", broken)
    with TestClient(main.app, raise_server_exceptions=False) as client:
        response = client.post("/history/search", json={"query": "retained"})
    assert response.status_code == 500
    assert response.json()["detail"] == "Internal Server Error"


@pytest.mark.parametrize("scope", ["session", "project", "both", "both-second"])
def test_failed_delete_is_refused_and_retry_removes_only_owned_rows(monkeypatch, scope):
    project_path = "C:/synthetic/project"
    db.append_records(PROMPT_HISTORY_TABLE_NAME, [
        {"id": "owned", "session_id": "session", "project_id": service.compute_project_id(project_path)},
        {"id": "other", "session_id": "other", "project_id": service.compute_project_id("C:/synthetic/other")},
    ])
    table = db.lance_db.open_table(PROMPT_HISTORY_TABLE_NAME)
    request = {"session_ids": ["session"]} if scope == "session" else {"project_path": project_path}
    if scope.startswith("both"):
        request["session_ids"] = ["session"]
    with monkeypatch.context() as patch:
        calls = 0
        def delete(where):
            nonlocal calls
            calls += 1
            if scope == "both-second" and calls == 1:
                return table.delete(where)
            raise RuntimeError("Locked")
        patch.setattr(service.lance_db, "open_table", lambda _: SimpleNamespace(delete=delete))
        with TestClient(main.app) as client:
            assert client.post("/history/remove", json=request).json() == {"success": False}
        expected_ids = {"other"} if scope == "both-second" else {"owned", "other"}
        assert {row["id"] for row in table.to_arrow().to_pylist()} == expected_ids
    with TestClient(main.app) as client:
        assert client.post("/history/remove", json=request).json() == {"success": True}
    assert [row["id"] for row in db.lance_db.open_table(PROMPT_HISTORY_TABLE_NAME).to_arrow().to_pylist()] == ["other"]


def test_invalid_removal_identity_cannot_partially_delete(monkeypatch):
    monkeypatch.setattr(service, "get_existing_tables", lambda: [PROMPT_HISTORY_TABLE_NAME])
    delete = Mock()
    monkeypatch.setattr(service.lance_db, "open_table", lambda _: SimpleNamespace(delete=delete))
    with pytest.raises(ValueError):
        service.remove_prompt_history(PromptHistoryRemoveRequest(session_ids=["valid", 'invalid"id']))
    with TestClient(main.app) as client:
        assert client.post("/history/remove", json={"session_ids": ["valid", 'invalid"id']}).status_code == 400
    delete.assert_not_called()


def test_missing_history_is_a_successful_empty_search_and_idempotent_delete():
    with TestClient(main.app) as client:
        assert client.post("/history/search", json={"query": "missing"}).json() == []
        assert client.post("/history/remove", json={"session_ids": ["missing"]}).json() == {"success": True}


def test_deleted_session_refuses_late_index_and_explicit_restore_changes_generation(monkeypatch):
    started = Event()
    release = Event()

    def paused_embedding(*_):
        started.set()
        assert release.wait(5)
        return [1.0, 0.0], SPACE

    monkeypatch.setattr(service, "_history_embedding", paused_embedding)
    request = IndexPromptHistoryRequest(
        id="prompt", session_id="session", project_path="C:/synthetic/project",
        prompt="retained", outcome="success", started_at="2026-10-11T00:00:00Z",
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        late_index = pool.submit(service.index_prompt_history, request)
        assert started.wait(5)
        with TestClient(main.app) as client:
            assert client.post("/history/remove", json={"session_ids": ["session"], "operation_id": "delete1"}).json() == {"success": True}
            assert client.post("/history/remove", json={"session_ids": ["session"], "operation_id": "delete1"}).json() == {"success": True}
            assert client.post("/history/remove", json={"session_ids": ["session"], "operation_id": "delete1", "restore": True}).json() == {"success": True}
        release.set()
        with pytest.raises(ValueError, match="deleted or changed"):
            late_index.result(timeout=5)
    assert PROMPT_HISTORY_TABLE_NAME not in db.get_existing_tables()
    monkeypatch.setattr(service, "_history_embedding", lambda *_: ([1.0, 0.0], SPACE))
    service.index_prompt_history(request)
    with TestClient(main.app) as client:
        assert client.post("/history/remove", json={"session_ids": ["session"], "operation_id": "delete1", "restore": True}).json() == {"success": True}
        assert client.post("/history/remove", json={"session_ids": ["session"], "operation_id": "delete1"}).status_code == 400
        assert client.post("/history/remove", json={"session_ids": ["session"], "operation_id": "delete2"}).json() == {"success": True}
    assert db.lance_db.open_table(PROMPT_HISTORY_TABLE_NAME).count_rows() == 0


def test_corrupt_lifecycle_blocks_index_and_delete(monkeypatch):
    db.append_records(service.SESSION_LIFECYCLE_TABLE, [{
        "session_id": "session", "version": 2, "operation_id": "delete1", "generation": 1, "state": "deleted",
    }])
    monkeypatch.setattr(service, "_history_embedding", lambda *_: ([1.0, 0.0], SPACE))
    request = IndexPromptHistoryRequest(
        id="prompt", session_id="session", project_path="C:/synthetic/project",
        prompt="retained", outcome="success", started_at="2026-10-11T00:00:00Z",
    )
    with pytest.raises(ValueError, match="Unsupported"):
        service.index_prompt_history(request)
    with TestClient(main.app) as client:
        assert client.post("/history/remove", json={"session_ids": ["session"], "operation_id": "delete1"}).status_code == 400


def test_fenced_delete_is_scoped_and_rejects_wrong_restore_operation(monkeypatch):
    monkeypatch.setattr(service, "_history_embedding", lambda *_: ([1.0, 0.0], SPACE))
    for session_id in ("owned", "other"):
        service.index_prompt_history(IndexPromptHistoryRequest(
            id=f"prompt_{session_id}", session_id=session_id, project_path="C:/synthetic/project",
            prompt=session_id, outcome="success", started_at="2026-10-11T00:00:00Z",
        ))
    with TestClient(main.app) as client:
        assert client.post("/history/remove", json={"session_ids": ["owned"], "operation_id": "delete1"}).json() == {"success": True}
        assert client.post("/history/remove", json={"session_ids": ["owned"], "operation_id": "wrong", "restore": True}).status_code == 400
        assert client.post("/history/remove", json={"session_ids": ["owned"], "operation_id": "invalid\"id"}).status_code == 400
    assert [row["id"] for row in db.lance_db.open_table(PROMPT_HISTORY_TABLE_NAME).to_arrow().to_pylist()] == ["prompt_other"]
    service.index_prompt_history(IndexPromptHistoryRequest(
        id="another_other", session_id="other", project_path="C:/synthetic/project",
        prompt="available", outcome="success", started_at="2026-10-11T00:00:00Z",
    ))
    assert db.lance_db.open_table(PROMPT_HISTORY_TABLE_NAME).count_rows() == 2


def test_failed_row_removal_keeps_persisted_fence_for_explicit_retry(monkeypatch):
    import lancedb

    db.append_records(PROMPT_HISTORY_TABLE_NAME, [{"id": "prompt", "session_id": "session", "vector": [1.0, 0.0], **SPACE.metadata()}])
    open_table = service.lance_db.open_table

    def failing_open(name):
        table = open_table(name)
        if name == PROMPT_HISTORY_TABLE_NAME:
            return SimpleNamespace(delete=Mock(side_effect=RuntimeError("locked")))
        return table

    with monkeypatch.context() as patch:
        patch.setattr(service.lance_db, "open_table", failing_open)
        assert service.remove_prompt_history(PromptHistoryRemoveRequest(session_ids=["session"], operation_id="delete1")) == {"success": False}
    db.lance_db.__init__(db.LANCEDB_DIR, session=lancedb.Session())
    assert service._session_lifecycle("session")["state"] == "deleted"
    monkeypatch.setattr(service, "_history_embedding", lambda *_: ([1.0, 0.0], SPACE))
    assert service.search_prompt_history(PromptHistorySearchRequest(query="retained")) == []
    request = IndexPromptHistoryRequest(
        id="late", session_id="session", project_path="C:/synthetic/project",
        prompt="late", outcome="success", started_at="2026-10-11T00:00:00Z",
    )
    with pytest.raises(ValueError, match="pending deletion"):
        service.index_prompt_history(request)
    assert service.remove_prompt_history(PromptHistoryRemoveRequest(session_ids=["session"], operation_id="delete1")) == {"success": True}
    assert db.lance_db.open_table(PROMPT_HISTORY_TABLE_NAME).count_rows() == 0


def test_recovery_started_during_embedding_blocks_search_readback(monkeypatch):
    db.append_records(PROMPT_HISTORY_TABLE_NAME, [{"id": "retained", "vector": [1.0, 0.0], **SPACE.metadata()}])
    with monkeypatch.context() as patch:
        def embed(*_):
            patch.setattr(db, "_recovery_error", "Synthetic pending recovery")
            return [1.0, 0.0], SPACE
        patch.setattr(service, "_history_embedding", embed)
        with TestClient(main.app, raise_server_exceptions=False) as client:
            response = client.post("/history/search", json={"query": "retained"})
        assert response.status_code == 500


@pytest.mark.parametrize("cosine, expected_score", [(1.0, 1.0), (0.75, 0.75), (0.0, 0.0), (-1.0, 0.0)])
def test_history_score_uses_native_squared_l2(monkeypatch, cosine, expected_score):
    project = "C:/synthetic/selected"
    db.append_records(PROMPT_HISTORY_TABLE_NAME, [
        {"id": "selected", "project_id": service.compute_project_id(project),
         "vector": [cosine, math.sqrt(1.0 - cosine * cosine)], **SPACE.metadata()},
        {"id": "unrelated", "project_id": service.compute_project_id("C:/synthetic/other"),
         "vector": [1.0, 0.0], **SPACE.metadata()},
    ])
    table = db.lance_db.open_table(PROMPT_HISTORY_TABLE_NAME)
    rows = table.search([1.0, 0.0]).where('id = "selected"', prefilter=True).to_list()
    assert rows[0]["_distance"] == pytest.approx(2.0 * (1.0 - cosine))
    monkeypatch.setattr(service, "_history_embedding", lambda *_: ([1.0, 0.0], SPACE))
    with TestClient(main.app) as client:
        response = client.post("/history/search", json={"query": "selected", "project_paths": [project], "top_k": 1})
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == ["selected"]
    assert response.json()[0]["score"] == pytest.approx(expected_score)
