"""Shared recovery gate for runtime and offline maintenance."""
from pathlib import Path
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field
from sidecar.infrastructure.store_control import list_store_tables, read_json


class DocumentRecovery(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    version: Literal[1] = 1
    doc_id: str = Field(pattern=r"^[a-zA-Z0-9_\-]+$")
    versions: dict[Literal["documents", "chunks"], Annotated[int, Field(ge=1)] | None] = Field(min_length=2, max_length=2)


def restore_document(connection, recovery: DocumentRecovery) -> None:
    existing = set(list_store_tables(connection))
    for name, version in recovery.versions.items():
        if version is not None:
            table = connection.open_table(name)
            if table.version != version:
                table.restore(version)
        elif name in existing:
            column = "id" if name == "documents" else "doc_id"
            connection.open_table(name).delete(f"{column} = '{recovery.doc_id}'")


def recover_store(connection, journal: Path) -> None:
    try:
        raw = read_json(journal, 16384)
    except FileNotFoundError:
        return
    recovery = DocumentRecovery.model_validate_json(raw)
    restore_document(connection, recovery)
    journal.unlink()
