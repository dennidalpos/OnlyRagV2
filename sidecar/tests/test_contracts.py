from fastapi.testclient import TestClient

from sidecar.main import app


client = TestClient(app)


def test_essential_response_contracts_are_stable_and_versioned():
    health = client.get("/health")
    assert health.status_code == 200
    payload = health.json()
    assert payload["status"] == "online"
    assert payload["version"] == "2.3.0"
    assert isinstance(payload["documents_count"], int)
    assert isinstance(payload["chunks_count"], int)

    export = client.post("/export", json={"markdown_content": "# contract", "export_format": "html"})
    assert export.status_code == 200
    export_payload = export.json()
    assert {"status", "format", "file_name", "file_path", "base64_content", "message"} <= export_payload.keys()
    assert export_payload["status"] == "success"
    assert export_payload["format"] == "html"

    openapi = app.openapi()
    assert openapi["info"]["version"] == "2.3.0"
    assert openapi["paths"]["/health"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]["$ref"] == "#/components/schemas/HealthResponse"
    assert openapi["paths"]["/export"]["post"]["responses"]["200"]["content"]["application/json"]["schema"]["$ref"] == "#/components/schemas/ExportResponse"


def test_contract_errors_are_structured_and_non_destructive():
    unknown_field = client.post("/vector/search", json={"query": "contract", "unexpected": True})
    assert unknown_field.status_code == 422
    assert isinstance(unknown_field.json()["detail"], list)
    assert unknown_field.json()["detail"][0]["loc"] == ["body", "unexpected"]

    unsupported_format = client.post("/export", json={"markdown_content": "# title", "export_format": "txt"})
    assert unsupported_format.status_code == 422
    assert unsupported_format.json()["detail"][0]["loc"] == ["body", "export_format"]

    missing_document = client.put("/documents/not-found-contract", json={"markdown_content": "# title"})
    assert missing_document.status_code == 404
