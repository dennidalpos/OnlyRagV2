"""The launch token keeps other local processes and web pages off the sidecar API."""
import os
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import sidecar.main as sidecar_main  # noqa: E402

client = TestClient(sidecar_main.app)


def test_routes_require_the_launch_token_when_configured(monkeypatch):
    monkeypatch.setattr(sidecar_main, "SIDECAR_AUTH_TOKEN", "s3cret")

    assert client.get("/documents").status_code == 401
    assert client.get("/documents", headers={"X-OnlyRag-Token": "wrong"}).status_code == 401
    assert client.get("/documents", headers={"X-OnlyRag-Token": "s3cret"}).status_code == 200


def test_health_stays_public_for_ownership_probes(monkeypatch):
    monkeypatch.setattr(sidecar_main, "SIDECAR_AUTH_TOKEN", "s3cret")
    assert client.get("/health").status_code == 200


def test_no_token_configured_keeps_dev_runs_open(monkeypatch):
    monkeypatch.setattr(sidecar_main, "SIDECAR_AUTH_TOKEN", "")
    assert client.get("/documents").status_code == 200
