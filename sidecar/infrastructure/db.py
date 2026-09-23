import re
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

class SchemaMismatchError(RuntimeError):
    """Raised when a record cannot be appended to an existing table.

    Carries the table name so callers can surface which store needs migrating.
    """

    def __init__(self, table_name: str, cause: Exception):
        self.table_name = table_name
        self.cause = cause
        super().__init__(
            f"Cannot append to LanceDB table '{table_name}': the record does not match the "
            f"stored schema ({cause}). The existing data was left untouched -- migrate or "
            f"remove the table deliberately before ingesting again."
        )


def append_records(
    table_name: str,
    records: List[Dict[str, Any]],
    delete_where: Optional[str] = None,
) -> Any:
    """Appends records to a table, creating it on first use, and returns the table handle.

    Deliberately non-destructive. Earlier revisions answered a failed `add` by dropping and
    re-creating the table from the incoming record alone, which silently deleted every row the
    user had already indexed whenever a schema changed. A mismatch now raises SchemaMismatchError
    and leaves the stored data intact: losing an ingest is recoverable, losing the corpus is not.
    """
    if table_name not in get_existing_tables():
        return lance_db.create_table(table_name, data=records)

    tbl = lance_db.open_table(table_name)
    if delete_where:
        tbl.delete(delete_where)
    try:
        tbl.add(records)
    except Exception as err:
        logger.error(f"Schema mismatch appending to LanceDB table '{table_name}': {err}")
        raise SchemaMismatchError(table_name, err) from err
    return tbl


def ensure_chunk_embedding_model_column(
    chunks_table: str,
    docs_table: str,
    default_model: str,
    fallback_model: str,
) -> None:
    """Adds the per-chunk `embedding_model` column to stores created before it existed.

    Search embeds the query once per stored model, so every row must say which model produced
    its vector. Legacy rows were always embedded with the default model, except those of
    documents marked `indexed_fallback`, whose vectors came from the deterministic hash.
    """
    if chunks_table not in get_existing_tables():
        return
    tbl = lance_db.open_table(chunks_table)
    if "embedding_model" in tbl.schema.names:
        return
    tbl.add_columns({"embedding_model": f"'{default_model}'"})
    if docs_table not in get_existing_tables():
        return
    fallback_ids = [
        str(row.get("id"))
        for row in lance_db.open_table(docs_table).to_arrow().to_pylist()
        if str(row.get("status", "")) == "indexed_fallback" and _DOC_ID_PATTERN.match(str(row.get("id", "")))
    ]
    if fallback_ids:
        id_list = ", ".join(f"'{doc_id}'" for doc_id in fallback_ids)
        tbl.update(where=f"doc_id IN ({id_list})", values={"embedding_model": fallback_model})
    logger.info(f"Migrated '{chunks_table}' with an embedding_model column ({len(fallback_ids)} fallback documents).")


def run_db_maintenance() -> Dict[str, Any]:
    """Compacts fragmented Lance datasets, prunes obsolete versions and refreshes indices.

    Uses `Table.optimize()`, the supported entry point since LanceDB 0.21. The previous
    implementation called `compact_files()` and `cleanup_old_versions()`, both deprecated and
    both requiring the optional `pylance` package: without it every call raised, yet each table
    was still reported as "success" with compacted/cleaned silently False, so a maintenance run
    that did nothing at all was indistinguishable from one that worked.
    """
    results = []
    all_succeeded = True

    for table_name in get_existing_tables():
        try:
            lance_db.open_table(table_name).optimize()
            results.append({"table": table_name, "status": "success", "optimized": True})
        except Exception as err:
            all_succeeded = False
            logger.warning(f"Maintenance failed on table '{table_name}': {err}")
            results.append({
                "table": table_name,
                "status": "error",
                "optimized": False,
                "error": str(err),
            })

    failed = [r["table"] for r in results if r["status"] == "error"]
    if failed:
        logger.error(f"LanceDB maintenance failed on {len(failed)} of {len(results)} tables: {failed}")
    else:
        logger.info(f"LanceDB maintenance optimized {len(results)} tables successfully.")

    return {"success": all_succeeded, "tables": results}
