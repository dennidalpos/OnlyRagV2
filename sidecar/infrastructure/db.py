import re
import atexit
from contextlib import contextmanager
from functools import wraps
from pathlib import Path
from threading import RLock
import lancedb
import pyarrow as pa
from typing import List, Optional, Any, Dict
from sidecar.config import DATA_DIR, DOCS_TABLE_NAME, CHUNKS_TABLE_NAME, logger
from sidecar.infrastructure.embeddings import EmbeddingSpaceMismatchError, validate_embedding_vectors
from sidecar.infrastructure.chunk_storage import CHUNK_PROVENANCE_FIELDS, chunk_embedding_space, chunk_schema, require_versioned_chunk_table
from sidecar.infrastructure.document_recovery import DocumentRecovery, restore_document
from sidecar.infrastructure.store_control import StoreLease, active_store, atomic_json, list_store_tables, read_json, safe_path
from sidecar import config

_store_lease = StoreLease(Path(DATA_DIR))
atexit.register(_store_lease.close)
_active_store, _active_pointer = active_store(Path(DATA_DIR))
LANCEDB_DIR = str(safe_path(Path(DATA_DIR), _active_store.path))
config.LANCEDB_DIR = LANCEDB_DIR
safe_path(Path(DATA_DIR), "exports").mkdir(exist_ok=True)
lance_db = lancedb.connect(LANCEDB_DIR)
_database_lock = RLock()
_recovery_error: Optional[str] = None
_mutation_active = False
_journal_path = Path(DATA_DIR) / "document-recovery.json"


class DatabaseRecoveryError(RuntimeError):
    """The store is unavailable until its pending recovery succeeds."""


def database_operation(function):
    """Keep readers and single-table writers outside coordinated document commits."""
    @wraps(function)
    def guarded(*args, **kwargs):
        with _database_lock:
            if _recovery_error or (_journal_path.exists() and not _mutation_active):
                raise DatabaseRecoveryError(_recovery_error or "Pending document recovery must complete first.")
            return function(*args, **kwargs)
    return guarded


def _restore_document(recovery: DocumentRecovery) -> None:
    restore_document(lance_db, recovery)


def recover_database() -> None:
    """Recover before migrations or maintenance can remove the saved versions."""
    global _recovery_error
    with _database_lock:
        try:
            if _journal_path.exists():
                journal = safe_path(_journal_path.parent, _journal_path.name)
                recovery = DocumentRecovery.model_validate_json(read_json(journal, 16384))
                _restore_document(recovery)
                _journal_path.unlink()
            _recovery_error = None
        except Exception as err:
            _recovery_error = "Document recovery failed; preserve document-recovery.json and the database."
            logger.error(f"{_recovery_error} {err}")
            raise DatabaseRecoveryError(_recovery_error) from err


@contextmanager
def document_mutation(doc_id: str):
    """Restore both tables on failure; a durable journal also covers process interruption."""
    global _recovery_error, _mutation_active
    with _database_lock:
        if _recovery_error or _journal_path.exists():
            raise DatabaseRecoveryError(_recovery_error or "Pending document recovery must complete first.")
        validate_doc_id(doc_id)
        existing = set(get_existing_tables())
        recovery = DocumentRecovery(doc_id=doc_id, versions={
            name: lance_db.open_table(name).version if name in existing else None
            for name in (DOCS_TABLE_NAME, CHUNKS_TABLE_NAME)
        })
        atomic_json(safe_path(_journal_path.parent, _journal_path.name), recovery)
        _mutation_active = True
        try:
            yield
            _journal_path.unlink()
        except Exception:
            try:
                _restore_document(recovery)
                _journal_path.unlink()
            except Exception as err:
                _recovery_error = "Document rollback failed; preserve document-recovery.json and the database."
                raise DatabaseRecoveryError(_recovery_error) from err
            raise
        finally:
            _mutation_active = False

_DOC_ID_PATTERN = re.compile(r'^[a-zA-Z0-9_\-]+$')

def validate_doc_id(doc_id: str) -> str:
    """Validates a document id against the safe id charset before it is interpolated into a
    LanceDB filter string. Raises ValueError on empty/malformed ids (e.g. containing quotes),
    preventing filter injection via crafted doc_id/doc_ids values."""
    if not doc_id or not _DOC_ID_PATTERN.match(doc_id):
        raise ValueError(f"Invalid document ID format: {doc_id!r}")
    return doc_id

@database_operation
def get_existing_tables() -> List[str]:
    """An unavailable store must never look like an empty one."""
    return list_store_tables(lance_db)

class SchemaMismatchError(RuntimeError):
    """Raised when a record cannot be appended to an existing table.

    Carries the table name so callers can surface which store needs migrating.
    """

    def __init__(self, table_name: str, cause: Exception):
        self.table_name = table_name
        self.cause = cause
        super().__init__(
            f"Cannot append to LanceDB table '{table_name}': the record does not match the "
            f"stored schema ({cause}). Preserve the existing data and use an explicit "
            f"rebuild with verified backup, readback and rollback."
        )


@database_operation
def append_records(
    table_name: str,
    records: List[Dict[str, Any]],
    delete_where: Optional[str] = None,
    match_key: str = "id",
) -> Any:
    """Append or atomically replace matching rows without deleting rejected records."""
    try:
        if table_name == CHUNKS_TABLE_NAME:
            spaces = [chunk_embedding_space(row) for row in records]
            dimension = spaces[0].embedding_dimension
            schema = chunk_schema(dimension)
            normalized_records = []
            for row, space in zip(records, spaces):
                if space.embedding_dimension != dimension or set(row) != set(schema.names):
                    raise ValueError("Chunk records must have one native dimension and the explicit schema fields.")
                vector = validate_embedding_vectors([row["vector"]], 1, dimension)[0]
                normalized_records.append({**row, "vector": vector})
            if table_name in get_existing_tables():
                stored_table = lance_db.open_table(table_name)
                stored_dimension = require_versioned_chunk_table(stored_table)
                if stored_dimension != dimension:
                    raise EmbeddingSpaceMismatchError(f"Index dimension is {stored_dimension}, encoder dimension is {dimension}; explicitly rebuild with verified backup/readback/rollback before changing encoder.")
                stored_rows = stored_table.search().select(list(CHUNK_PROVENANCE_FIELDS)).limit(None).to_list()
                incoming_policies = {space.embedding_model.partition(":")[0]: space.embedding_preparation for space in spaces}
                for row in stored_rows:
                    stored_space = chunk_embedding_space(row)
                    incoming = incoming_policies.get(stored_space.embedding_model.partition(":")[0])
                    if incoming is not None and incoming != stored_space.embedding_preparation:
                        raise EmbeddingSpaceMismatchError("Encoder preparation changed; preserve the store and explicitly rebuild with verified backup/readback/rollback.")
            records = pa.Table.from_pylist(normalized_records, schema=schema)
        if table_name not in get_existing_tables():
            return lance_db.create_table(table_name, data=records)
        tbl = lance_db.open_table(table_name)
        if delete_where:
            tbl.merge_insert(match_key).when_matched_update_all().when_not_matched_insert_all().when_not_matched_by_source_delete(delete_where).execute(records)
        else:
            tbl.add(records)
    except ValueError as err:
        logger.error(f"Schema mismatch appending to LanceDB table '{table_name}': {err}")
        raise SchemaMismatchError(table_name, err) from err
    return tbl


def write_document_records(document: Dict[str, Any], chunks: List[Dict[str, Any]]) -> None:
    doc_id = validate_doc_id(document["id"])
    if any(chunk["doc_id"] != doc_id for chunk in chunks):
        raise ValueError("Chunk document id does not match the document.")
    with document_mutation(doc_id):
        if chunks:
            append_records(CHUNKS_TABLE_NAME, chunks, delete_where=f"doc_id = '{doc_id}'", match_key="chunk_id")
        elif CHUNKS_TABLE_NAME in get_existing_tables():
            lance_db.open_table(CHUNKS_TABLE_NAME).delete(f"doc_id = '{doc_id}'")
        append_records(DOCS_TABLE_NAME, [document], delete_where=f"id = '{doc_id}'")


def delete_document_records(doc_id: str) -> None:
    with document_mutation(doc_id):
        existing = set(get_existing_tables())
        for name, column in ((DOCS_TABLE_NAME, "id"), (CHUNKS_TABLE_NAME, "doc_id")):
            if name in existing:
                lance_db.open_table(name).delete(f"{column} = '{doc_id}'")


@database_operation
def run_db_maintenance() -> Dict[str, Any]:
    """Optimize only when recovery has completed."""
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
