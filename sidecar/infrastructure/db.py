import re
import lancedb
from typing import List
from sidecar.config import LANCEDB_DIR, logger

lance_db = lancedb.connect(LANCEDB_DIR)

_DOC_ID_PATTERN = re.compile(r'^[a-zA-Z0-9_\-]+$')

def validate_doc_id(doc_id: str) -> str:
    """Validates a document id against the safe id charset before it is interpolated into a
    LanceDB filter string. Raises ValueError on empty/malformed ids (e.g. containing quotes),
    preventing filter injection via crafted doc_id/doc_ids values."""
    if not doc_id or not _DOC_ID_PATTERN.match(doc_id):
        raise ValueError(f"Invalid document ID format: {doc_id!r}")
    return doc_id

def get_existing_tables() -> List[str]:
    """Returns a clean list of table name strings robustly across LanceDB versions."""
    try:
        tables = lance_db.list_tables()
        if hasattr(tables, "tables"):
            return list(tables.tables)
        if isinstance(tables, list):
            return tables
        return [str(t) for t in tables]
    except Exception:
        try:
            return lance_db.table_names()
        except Exception:
            return []
