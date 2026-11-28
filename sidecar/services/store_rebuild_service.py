"""Explicit offline rebuild with retained backup, readback and atomic activation."""
from contextlib import contextmanager
import hashlib
import inspect
import math
from pathlib import Path
import re
import shutil
import uuid

import lancedb
import pyarrow as pa

from sidecar.domain.ingestion import create_semantic_chunks
from sidecar.infrastructure.chunk_storage import chunk_embedding_space, chunk_schema, require_versioned_chunk_table
from sidecar.infrastructure.document_recovery import recover_store
from sidecar.infrastructure.embeddings import (
    EMBEDDING_BATCH_SIZE, EmbeddingSpace, generate_embedding_batch, resolve_embedding_space, validate_embedding_vectors,
)
from sidecar.infrastructure.store_control import (
    ActiveStore, StoreControlError, StoreLease, StoreRef, active_store, atomic_json,
    list_store_tables, read_json, refuse_owned_process, safe_path, sha256_file,
)
from sidecar.infrastructure.store_rebuild_manifest import RebuildManifest, TableEvidence


def connect(path: Path):
    return lancedb.connect(str(path), session=lancedb.Session())


def file_inventory(root: Path) -> dict[str, str]:
    if not root.exists():
        return {}
    inventory = {}
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        checked = safe_path(root, relative)
        if checked.is_file():
            inventory[relative] = sha256_file(checked)
        elif not checked.is_dir():
            raise StoreControlError("Unsupported store artifact.")
    return inventory


def table_evidence(connection) -> dict[str, TableEvidence]:
    result = {}
    for name in list_store_tables(connection):
        table = connection.open_table(name)
        schema = table.schema
        hashes = []
        for batch in table.search().limit(None).to_batches(batch_size=64):
            for row in batch.to_pylist():
                buffer = pa.BufferOutputStream()
                with pa.ipc.new_stream(buffer, schema) as writer:
                    writer.write_table(pa.Table.from_pylist([row], schema=schema))
                hashes.append(hashlib.sha256(buffer.getvalue()).digest())
        result[name] = TableEvidence(rows=len(hashes),
                                    schema_sha256=hashlib.sha256(schema.serialize()).hexdigest(),
                                    records_sha256=hashlib.sha256(b"".join(sorted(hashes))).hexdigest())
    return result


def chunker_hash() -> str:
    return sha256_file(Path(inspect.getfile(create_semantic_chunks)))


def documents(connection):
    if "documents" not in list_store_tables(connection):
        if "chunks" in list_store_tables(connection) and connection.open_table("chunks").count_rows():
            raise StoreControlError("Chunks have no retained documents; rebuild refused.")
        return
    seen = set()
    for batch in connection.open_table("documents").search().limit(None).to_batches(batch_size=32):
        for document in batch.to_pylist():
            identifier = document.get("id")
            if (not isinstance(identifier, str) or not re.fullmatch(r"[a-zA-Z0-9_\-]+", identifier)
                    or identifier in seen):
                raise StoreControlError("Document IDs are invalid or duplicated.")
            seen.add(identifier)
            for key in ("filename", "file_type", "ingested_at", "extracted_markdown"):
                if not isinstance(document.get(key), str):
                    raise StoreControlError(f"Document {identifier} has no retained {key}.")
            if len(document["extracted_markdown"]) > 10_000_000:
                raise StoreControlError("Retained Markdown exceeds the rebuild read budget.")
            yield document


def document_chunks(document):
    count = document.get("num_chunks")
    if type(count) is not int or count < 0:
        raise StoreControlError("Document chunk count is invalid.")
    raw = create_semantic_chunks(document["filename"], document["extracted_markdown"]) if count else []
    if len(raw) != count:
        raise StoreControlError("Current chunking changes document counts; preserve the store and review a separate metadata migration.")
    return raw


def verify_source_coverage(connection) -> int:
    identifiers, count = set(), 0
    for document in documents(connection):
        raw = document_chunks(document)
        count += len(raw)
        if raw:
            identifiers.add(document["id"])
    if "chunks" in list_store_tables(connection):
        table = connection.open_table("chunks")
        if "doc_id" not in table.schema.names:
            raise StoreControlError("Legacy chunks have no document ownership; rebuild refused.")
        for batch in table.search().select(["doc_id"]).limit(None).to_batches(batch_size=256):
            if any(row["doc_id"] not in identifiers for row in batch.to_pylist()):
                raise StoreControlError("Source has orphan chunks without indexed retained Markdown.")
    return count


@contextmanager
def maintenance(root: Path):
    if not root.is_absolute() or not root.is_dir():
        raise StoreControlError("An existing absolute userData root is required.")
    data = safe_path(root, "data")
    if not data.is_dir():
        raise StoreControlError("Declared root has no data directory.")
    refuse_owned_process(root)
    with StoreLease(data):
        refuse_owned_process(root)
        source, pointer = active_store(data)
        path = safe_path(data, source.path)
        if not path.is_dir():
            raise StoreControlError("Declared active store does not exist.")
        connection = connect(path)
        journal = safe_path(data, "document-recovery.json")
        try:
            recover_store(connection, journal)
        except (ValueError, OSError, RuntimeError) as error:
            raise StoreControlError("Document recovery failed; preserve the journal and stores.") from error
        yield data, source, pointer, connection


def preview(root: Path) -> dict:
    with maintenance(root) as (data, source, pointer, connection):
        inventory = file_inventory(safe_path(data, source.path))
        tables = table_evidence(connection)
        count = verify_source_coverage(connection)
        return {"source": source.model_dump(), "tables": {k: v.model_dump() for k, v in tables.items()},
                "files": len(inventory), "rebuilt_chunks": count, "active_manifest": pointer is not None}


def verify_chunks(connection, space: EmbeddingSpace) -> None:
    table = connection.open_table("chunks")
    if require_versioned_chunk_table(table) != space.embedding_dimension or table.schema != chunk_schema(space.embedding_dimension):
        raise StoreControlError("Rebuilt chunk schema does not match the native encoder.")
    expected_count = 0
    for document in documents(connection):
        raw = document_chunks(document)
        rows = table.search().where(f"doc_id = '{document['id']}'", prefilter=True).limit(None).to_list()
        expected_count += len(raw)
        if len(rows) != len(raw):
            raise StoreControlError("Rebuilt document coverage mismatch.")
        rows.sort(key=lambda row: row["chunk_index"])
        for row, (index, text, section) in zip(rows, raw):
            expected = {"chunk_id": f"{document['id']}_chunk_{index}", "doc_id": document["id"],
                        "chunk_index": index, "text": text, "section_header": section,
                        "doc_name": document["filename"], "file_type": document["file_type"],
                        "ingested_at": document["ingested_at"], **space.metadata()}
            if any(row[key] != value for key, value in expected.items()) or chunk_embedding_space(row) != space:
                raise StoreControlError("Rebuilt chunk identity, text or provenance mismatch.")
            validate_embedding_vectors([row["vector"]], 1, space.embedding_dimension)
            if not math.isclose(sum(value * value for value in row["vector"]), 1, abs_tol=1e-5):
                raise StoreControlError("Rebuilt vector is not L2 normalized.")
        if rows:
            match = table.search(rows[0]["vector"]).where(f"doc_id = '{document['id']}'", prefilter=True).limit(1).to_list()
            if not match or not math.isclose(match[0]["_distance"], 0, abs_tol=1e-5):
                raise StoreControlError("Rebuilt filtered vector readback failed.")
    if table.count_rows() != expected_count:
        raise StoreControlError("Rebuilt index has orphan or missing chunks.")


def prepare(root: Path, model: str) -> dict:
    with maintenance(root) as (data, source, pointer, connection):
        # Resolve once; every subsequent batch must retain this exact space.
        space = resolve_embedding_space(model, role="document")
        verify_source_coverage(connection)
        source_path = safe_path(data, source.path)
        original_files = file_inventory(source_path)
        original_tables = table_evidence(connection)
        archive = safe_path(data, "source-documents")
        archive_files = file_inventory(archive)
        identifier = uuid.uuid4().hex
        job = safe_path(data, f"rebuilds/{identifier}")
        job.mkdir(parents=True, exist_ok=False)
        backup = job / "backup"
        shutil.copytree(source_path, backup)
        if archive.exists():
            shutil.copytree(archive, job / "source-documents")
        if (file_inventory(backup) != original_files or table_evidence(connect(backup)) != original_tables
                or file_inventory(job / "source-documents") != archive_files):
            raise StoreControlError("Complete backup verification failed; no activation manifest written.")
        target = StoreRef(store_id=identifier, path=f"rebuilds/{identifier}/store")
        target_path = safe_path(data, target.path)
        shutil.copytree(backup, target_path)
        rebuilt = connect(target_path)
        if "chunks" in list_store_tables(rebuilt):
            rebuilt.drop_table("chunks")
        table = rebuilt.create_table("chunks", schema=chunk_schema(space.embedding_dimension))
        for document in documents(connection):
            raw = document_chunks(document)
            for start in range(0, len(raw), EMBEDDING_BATCH_SIZE):
                selected = raw[start:start + EMBEDDING_BATCH_SIZE]
                batch = generate_embedding_batch([item[1] for item in selected], model=model, expected_space=space, role="document")
                if batch.space != space or batch.used_fallback:
                    raise StoreControlError("Requested native encoder changed or fell back; no activation allowed.")
                vectors = validate_embedding_vectors(batch.vectors, len(selected), space.embedding_dimension)
                records = [{"vector": vector, "chunk_id": f"{document['id']}_chunk_{index}",
                            "doc_id": document["id"], "doc_name": document["filename"], "text": text,
                            "chunk_index": index, "section_header": section, "file_type": document["file_type"],
                            "ingested_at": document["ingested_at"], **space.metadata()}
                           for (index, text, section), vector in zip(selected, vectors)]
                table.add(pa.Table.from_pylist(records, schema=chunk_schema(space.embedding_dimension)))
        verify_chunks(connect(target_path), space)
        target_tables = table_evidence(connect(target_path))
        if {k: v for k, v in target_tables.items() if k != "chunks"} != {k: v for k, v in original_tables.items() if k != "chunks"}:
            raise StoreControlError("Unrelated table readback changed; no activation allowed.")
        if file_inventory(source_path) != original_files or file_inventory(archive) != archive_files:
            raise StoreControlError("Source changed during preparation; no activation allowed.")
        manifest = RebuildManifest(version=1, source=source, target=target, previous_active=pointer, model=model,
                                   embedding_space=space.metadata(), source_files=original_files, archive_files=archive_files,
                                   target_files=file_inventory(target_path), source_tables=original_tables,
                                   target_tables=target_tables, chunker_sha256=chunker_hash())
        atomic_json(job / "manifest.json", manifest)
        return {"rebuild_id": identifier, "manifest": f"rebuilds/{identifier}/manifest.json",
                "target": target.model_dump(), "activation": "pending"}


def load_manifest(data: Path, identifier: str) -> tuple[RebuildManifest, str, str]:
    if not re.fullmatch(r"[a-f0-9]{32}", identifier):
        raise StoreControlError("Invalid rebuild ID.")
    relative = f"rebuilds/{identifier}/manifest.json"
    payload = read_json(safe_path(data, relative))
    manifest = RebuildManifest.model_validate_json(payload)
    if manifest.target != StoreRef(store_id=identifier, path=f"rebuilds/{identifier}/store"):
        raise StoreControlError("Rebuild target identity mismatch.")
    return manifest, relative, hashlib.sha256(payload).hexdigest()


def verify_retained(data: Path, manifest: RebuildManifest) -> None:
    source = safe_path(data, manifest.source.path)
    backup = safe_path(data, f"rebuilds/{manifest.target.store_id}/backup")
    archive = safe_path(data, "source-documents")
    retained = safe_path(data, f"rebuilds/{manifest.target.store_id}/source-documents")
    if not source.is_dir() or not backup.is_dir():
        raise StoreControlError("Source or backup store is missing.")
    if (file_inventory(source) != manifest.source_files or file_inventory(backup) != manifest.source_files
            or file_inventory(archive) != manifest.archive_files or file_inventory(retained) != manifest.archive_files):
        raise StoreControlError("Source, complete backup or retained originals changed.")
    if table_evidence(connect(source)) != manifest.source_tables or table_evidence(connect(backup)) != manifest.source_tables:
        raise StoreControlError("Source or backup table readback mismatch.")


def activate(root: Path, identifier: str) -> dict:
    with maintenance(root) as (data, source, pointer, connection):
        manifest, relative, digest = load_manifest(data, identifier)
        expected = ActiveStore(version=1, store=manifest.target, previous_store_id=manifest.source.store_id,
                               rebuild_manifest=relative, rebuild_manifest_sha256=digest, mode="rebuilt")
        if pointer != expected and (source != manifest.source or pointer != manifest.previous_active):
            raise StoreControlError("Active source changed since preparation.")
        verify_retained(data, manifest)
        target = safe_path(data, manifest.target.path)
        if not target.is_dir() or file_inventory(target) != manifest.target_files:
            raise StoreControlError("Prepared target changed or is missing.")
        if chunker_hash() != manifest.chunker_sha256:
            raise StoreControlError("Chunking source changed; explicitly prepare again.")
        if table_evidence(connect(target)) != manifest.target_tables:
            raise StoreControlError("Prepared target table readback mismatch.")
        values = dict(manifest.embedding_space)
        values.pop("embedding_space_id")
        verify_chunks(connect(target), EmbeddingSpace(**values))
        if safe_path(data, "document-recovery.json").exists():
            raise StoreControlError("Pending recovery blocks activation.")
        atomic_json(safe_path(data, "active-store.json"), expected)
        return {"active": manifest.target.model_dump(), "rebuild_id": identifier}


def rollback(root: Path, identifier: str) -> dict:
    with maintenance(root) as (data, source, pointer, connection):
        manifest, relative, digest = load_manifest(data, identifier)
        expected = ActiveStore(version=1, store=manifest.source, previous_store_id=manifest.target.store_id,
                               rebuild_manifest=relative, rebuild_manifest_sha256=digest, mode="prior")
        if pointer != expected and (source != manifest.target or pointer is None
                                   or pointer.rebuild_manifest_sha256 != digest or pointer.mode != "rebuilt"):
            raise StoreControlError("This rebuild is not the active rollback owner.")
        verify_retained(data, manifest)
        if safe_path(data, "document-recovery.json").exists():
            raise StoreControlError("Pending recovery blocks rollback.")
        atomic_json(safe_path(data, "active-store.json"), expected)
        return {"active": manifest.source.model_dump(), "rebuild_id": identifier, "retained": True}
