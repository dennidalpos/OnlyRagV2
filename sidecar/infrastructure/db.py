import os
import re
import time
import shutil
import lancedb
from typing import List, Optional, Any, Dict
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

def safe_open_table(table_name: str) -> Optional[Any]:
    """Safely opens a LanceDB table with automatic isolation and recovery in case of file/index corruption."""
    try:
        if table_name in get_existing_tables():
            return lance_db.open_table(table_name)
        return None
    except Exception as err:
        logger.error(f"Corruption or read error in LanceDB table '{table_name}': {err}")
        table_path = os.path.join(LANCEDB_DIR, f"{table_name}.lance")
        if os.path.exists(table_path):
            backup_path = os.path.join(LANCEDB_DIR, f"{table_name}.corrupted_{int(time.time())}.bak")
            try:
                shutil.move(table_path, backup_path)
                logger.warning(f"Moved corrupted table '{table_name}' to backup: {backup_path}")
            except Exception as move_err:
                logger.error(f"Failed to isolate corrupted table directory {table_path}: {move_err}")
        return None

def run_db_maintenance() -> Dict[str, Any]:
    """Performs compaction of fragmented Lance datasets and purges obsolete file versions."""
    results = []
    tables = get_existing_tables()
    for table_name in tables:
        try:
            tbl = lance_db.open_table(table_name)
            compacted = False
            cleaned = False

            if hasattr(tbl, 'compact_files'):
                try:
                    tbl.compact_files()
                    compacted = True
                except Exception as comp_err:
                    logger.warning(f"Compaction not supported or failed for table '{table_name}': {comp_err}")

            if hasattr(tbl, 'cleanup_old_versions'):
                try:
                    tbl.cleanup_old_versions()
                    cleaned = True
                except Exception as clean_err:
                    logger.warning(f"Cleanup old versions failed for table '{table_name}': {clean_err}")

            results.append({
                "table": table_name,
                "status": "success",
                "compacted": compacted,
                "cleaned": cleaned
            })
        except Exception as err:
            logger.warning(f"Maintenance failed on table '{table_name}': {err}")
            results.append({
                "table": table_name,
                "status": "error",
                "error": str(err)
            })

    logger.info(f"LanceDB maintenance completed for {len(results)} tables: {results}")
    return {"success": True, "tables": results}
