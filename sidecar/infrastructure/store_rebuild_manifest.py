"""Versioned evidence required before store activation or rollback."""
from typing import Annotated, Literal
from pydantic import Field, model_validator
from sidecar.infrastructure.store_control import StrictRecord, StoreRef, ActiveStore


class TableEvidence(StrictRecord):
    rows: int = Field(ge=0)
    schema_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    records_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class RebuildManifest(StrictRecord):
    version: Literal[1]
    source: StoreRef
    target: StoreRef
    previous_active: ActiveStore | None
    model: str
    embedding_space: dict[str, str | int]
    source_files: dict[str, Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]]
    archive_files: dict[str, Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]]
    target_files: dict[str, Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]]
    source_tables: dict[str, TableEvidence]
    target_tables: dict[str, TableEvidence]
    chunker_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def validate_stores(self):
        if self.target.store_id == "legacy" or self.source.store_id == self.target.store_id:
            raise ValueError("Rebuild requires a new adjacent store identity.")
        if self.previous_active is None and self.source.store_id != "legacy":
            raise ValueError("Nonlegacy source requires its previous active pointer.")
        if self.previous_active is not None and self.previous_active.store != self.source:
            raise ValueError("Previous active store differs from the rebuild source.")
        return self
