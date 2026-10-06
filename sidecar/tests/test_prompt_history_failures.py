from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from sidecar import main
from sidecar.config import PROMPT_HISTORY_TABLE_NAME
from sidecar.infrastructure import db
from sidecar.schemas import PromptHistoryRemoveRequest
from sidecar.services import prompt_history_service as service


@pytest.mark.parametrize("failure", ["encoder", "open", "search", "catalog"])
def test_search_failure_is_unavailable_over_http(monkeypatch, failure):
    db.append_records(PROMPT_HISTORY_TABLE_NAME, [{"id": "retained", "vector": [1.0, 0.0]}])
    monkeypatch.setattr(service, "_normalized_embedding", lambda _: [1.0, 0.0])
    broken = Mock(side_effect=RuntimeError("Storage unavailable"))
    if failure == "encoder":
        monkeypatch.setattr(service, "_normalized_embedding", broken)
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


def test_recovery_started_during_embedding_blocks_search_readback(monkeypatch):
    db.append_records(PROMPT_HISTORY_TABLE_NAME, [{"id": "retained", "vector": [1.0, 0.0]}])
    with monkeypatch.context() as patch:
        def embed(_text):
            patch.setattr(db, "_recovery_error", "Synthetic pending recovery")
            return [1.0, 0.0]
        patch.setattr(service, "_normalized_embedding", embed)
        with TestClient(main.app, raise_server_exceptions=False) as client:
            response = client.post("/history/search", json={"query": "retained"})
        assert response.status_code == 500
