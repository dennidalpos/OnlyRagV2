"""Helpers for driving the NDJSON streaming endpoints from tests."""
import json
from typing import Any, Dict, List


def retained_translation_record(path):
    """Native source/archive/store admission for focused serialization tests.

    Extraction itself is covered by ingestion tests; this fixture declares its own text.
    """
    import uuid
    from sidecar.infrastructure import db, source_provenance as source
    from sidecar.domain.translator import prepare_translation
    identifier = str(uuid.uuid4())
    retained, revision = source.retain_original(identifier, str(path), lambda: None)
    source.save_extraction(identifier, retained, revision, path.name, [(1, "Fixture extraction")], path.suffix == ".pdf")
    record = dict(id=identifier, file_path=str(path), filename=path.name, file_type=path.suffix[1:],
                  file_size=path.stat().st_size, num_pages=1, num_chunks=0, extracted_markdown="Fixture extraction",
                  status="indexed", ingested_at=identifier, used_fallback_embeddings=False)
    db.write_document_records(record, [])
    return prepare_translation(identifier)


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
