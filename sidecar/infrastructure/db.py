import lancedb
from typing import List
from sidecar.config import LANCEDB_DIR, logger

lance_db = lancedb.connect(LANCEDB_DIR)

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
