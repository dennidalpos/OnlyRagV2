"""One-time migration of Italian chunk context labels and their embeddings."""

from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
import re
import shutil
from typing import Any

from sidecar.infrastructure.db import validate_doc_id
from sidecar.infrastructure.embeddings import (
    FALLBACK_EMBEDDING_MODEL,
    generate_embeddings_with_status,
    get_fallback_embedding,
)


_LEGACY_PREFIX = re.compile(r"^\[Documento: (.*) \| Sezione: (.*)\]\n")


def updated_context_text(text: str) -> str | None:
    """Return the English-prefixed text only for chunks with the old stored format."""
    match = _LEGACY_PREFIX.match(text)
    if match is None:
        return None
    return f"[Document: {match.group(1)} | Section: {match.group(2)}]\n{text[match.end():]}"


def plan_chunk_context_migration(table: Any) -> list[tuple[str, str, str]]:
    """List legacy chunks without exposing their content in logs or changing the table."""
    planned = []
    for row in table.to_arrow().to_pylist():
        new_text = updated_context_text(str(row["text"]))
        if new_text is None:
            continue
        chunk_id = validate_doc_id(str(row["chunk_id"]))
        model = str(row.get("embedding_model") or "")
        if not model:
            raise ValueError(f"Chunk {chunk_id} has no embedding_model; run the existing column migration first")
        planned.append((chunk_id, new_text, model))
    return planned


def migrate_chunk_context(table: Any, database_dir: Path) -> tuple[int, Path | None]:
    """Re-embed legacy chunks, back up LanceDB, then update rows in place.

    The Sidecar must be stopped. An embedding failure aborts before copying or writing.
    A failed table update leaves the backup available for an offline restore.
    """
    planned = plan_chunk_context_migration(table)
    if not planned:
        return 0, None

    by_model: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for chunk_id, text, model in planned:
        by_model[model].append((chunk_id, text))

    vectors: dict[str, list[float]] = {}
    for model, items in by_model.items():
        texts = [text for _, text in items]
        if model == FALLBACK_EMBEDDING_MODEL:
            embedded = [get_fallback_embedding(text) for text in texts]
        else:
            embedded, used_fallback = generate_embeddings_with_status(texts, model=model)
            if used_fallback:
                raise RuntimeError(f"Embedding model {model} is unavailable; no chunk was changed")
        if len(embedded) != len(items):
            raise RuntimeError(f"Embedding model {model} returned {len(embedded)} vectors for {len(items)} chunks")
        vectors.update((chunk_id, vector) for (chunk_id, _), vector in zip(items, embedded))

    database_dir = database_dir.resolve(strict=True)
    backup_dir = database_dir.with_name(f"{database_dir.name}.before-context-en-{datetime.now(timezone.utc):%Y%m%dT%H%M%S%fZ}")
    shutil.copytree(database_dir, backup_dir)

    for chunk_id, text, _ in planned:
        table.update(where=f"chunk_id = '{chunk_id}'", values={"text": text, "vector": vectors[chunk_id]})

    remaining = plan_chunk_context_migration(table)
    if remaining:
        raise RuntimeError(f"{len(remaining)} legacy chunks remain; backup: {backup_dir}")
    return len(planned), backup_dir
