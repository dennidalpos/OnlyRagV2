import json
from pathlib import Path

from sidecar.main import app


CONTRACT_PATH = Path(__file__).parents[1] / "contracts" / "openapi-2.3.0.json"


def test_versioned_openapi_fixture_matches_runtime_contract():
    fixture = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

    assert fixture == app.openapi()
    assert fixture["info"]["version"] == "2.3.0"
