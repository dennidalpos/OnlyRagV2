"""Helpers for driving the NDJSON streaming endpoints from tests."""
import json
from typing import Any, Dict, List


def read_events(response: Any) -> List[Dict[str, Any]]:
    return [json.loads(line) for line in response.text.splitlines() if line.strip()]


def done_payload(response: Any) -> Dict[str, Any]:
    """Returns the `done` event data, failing with the stream's own error otherwise."""
    assert response.status_code == 200, response.text
    events = read_events(response)
    done = [e for e in events if e.get("type") == "done"]
    assert done, f"stream ended without a done event: {events[-1:] or events}"
    return done[-1]["data"]


def ingest_path(client: Any, file_path: str, **options: Any) -> Dict[str, Any]:
    response = client.post("/ingest-path-stream", json={"file_path": file_path, **options})
    return done_payload(response)