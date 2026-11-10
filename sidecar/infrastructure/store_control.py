"""Exclusive store ownership and validated, explicit activation pointers."""
import hashlib
import os
from pathlib import Path, PurePosixPath
import sqlite3
import subprocess
from typing import Literal
import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StoreControlError(RuntimeError):
    """Preserve all artifacts when ownership or activation cannot be verified."""


class StrictRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    @field_validator("version", mode="before", check_fields=False)
    @classmethod
    def strict_version(cls, value):
        if type(value) is not int:
            raise ValueError("Manifest version must be an explicit integer.")
        return value


class StoreRef(StrictRecord):
    store_id: str = Field(pattern=r"^(legacy|[a-f0-9]{32})$")
    path: str

    @model_validator(mode="after")
    def validate_identity(self):
        expected = "lancedb_store" if self.store_id == "legacy" else f"rebuilds/{self.store_id}/store"
        if self.path != expected:
            raise ValueError("Store path does not match its identity.")
        return self


class ActiveStore(StrictRecord):
    version: Literal[1]
    store: StoreRef
    previous_store_id: str = Field(pattern=r"^(legacy|[a-f0-9]{32})$")
    rebuild_manifest: str
    rebuild_manifest_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    mode: Literal["rebuilt", "prior"]


def safe_path(root: Path, relative: str) -> Path:
    """Refuse traversal, junctions and symlinks before opening any artifact."""
    parts = PurePosixPath(relative)
    if (not relative or "\\" in relative or ":" in relative or parts.is_absolute()
            or any(part in (".", "..") for part in relative.split("/"))):
        raise StoreControlError("Invalid relative store path.")
    target = root / Path(*parts.parts)
    for candidate in (root, *root.parents):
        if candidate.is_symlink() or candidate.is_junction():
            raise StoreControlError("Store root is a linked directory.")
    current = root
    for part in parts.parts:
        current /= part
        if current.is_symlink() or current.is_junction():
            raise StoreControlError("Linked store artifacts are refused.")
    if not target.resolve().is_relative_to(root.resolve()):
        raise StoreControlError("Store path escapes the declared root.")
    return target


def read_json(path: Path, budget: int = 64 * 1024 * 1024) -> bytes:
    with path.open("rb") as stream:
        data = stream.read(budget + 1)
    if len(data) > budget:
        raise StoreControlError("Manifest exceeds its read budget.")
    return data


def sha256_file(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def atomic_json(path: Path, record: BaseModel) -> None:
    safe_path(path.parent, path.name)
    temporary = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    with temporary.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(record.model_dump_json(indent=2))
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def list_store_tables(connection) -> list[str]:
    names, page, seen = [], connection.list_tables(), set()
    while True:
        names.extend(page.tables)
        token = page.page_token
        if not token:
            return sorted(names)
        if token in seen:
            raise StoreControlError("Table listing repeated a page token.")
        seen.add(token)
        page = connection.list_tables(page_token=token)


def active_store(data: Path) -> tuple[StoreRef, ActiveStore | None]:
    path = safe_path(data, "active-store.json")
    try:
        raw = read_json(path, 16384)
    except FileNotFoundError:
        return StoreRef(store_id="legacy", path="lancedb_store"), None
    try:
        pointer = ActiveStore.model_validate_json(raw)
        manifest_path = safe_path(data, pointer.rebuild_manifest)
        payload = read_json(manifest_path)
        if hashlib.sha256(payload).hexdigest() != pointer.rebuild_manifest_sha256:
            raise StoreControlError("Active rebuild manifest hash mismatch.")
        # Import lazily: runtime startup must not load maintenance/embedding code.
        from sidecar.infrastructure.store_rebuild_manifest import RebuildManifest
        manifest = RebuildManifest.model_validate_json(payload)
        if pointer.rebuild_manifest != f"rebuilds/{manifest.target.store_id}/manifest.json":
            raise StoreControlError("Rebuild manifest path does not match its identity.")
        expected = manifest.target if pointer.mode == "rebuilt" else manifest.source
        previous = manifest.source if pointer.mode == "rebuilt" else manifest.target
        if pointer.store != expected or pointer.previous_store_id != previous.store_id:
            raise StoreControlError("Active store identity does not match its rebuild manifest.")
        target = safe_path(data, pointer.store.path)
        if not target.is_dir():
            raise StoreControlError("Active store is missing; no legacy fallback is allowed.")
        return pointer.store, pointer
    except (ValueError, OSError) as error:
        raise StoreControlError("Invalid active-store.json; preserve it and the stores.") from error


class StoreLease:
    def __init__(self, data: Path):
        path = safe_path(data, "store-lease.sqlite")
        for suffix in ("-journal", "-wal", "-shm"):
            safe_path(data, f"store-lease.sqlite{suffix}")
        data.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path, timeout=0, isolation_level=None, check_same_thread=False)
        try:
            self.connection.execute("BEGIN EXCLUSIVE")
        except sqlite3.Error as error:
            self.connection.close()
            raise StoreControlError("Store lease unavailable; close the owning Sidecar or maintenance process.") from error

    def close(self):
        self.connection.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class ProcessIdentity(StrictRecord):
    pid: int = Field(gt=0)
    executablePath: str = Field(min_length=1)
    startedAt: str = Field(min_length=1)


def refuse_owned_process(root: Path) -> None:
    """Check the old runtime marker; never terminate or adopt its process."""
    try:
        raw = read_json(safe_path(root, "sidecar-ownership.json"), 16384)
    except FileNotFoundError:
        return
    marker = ProcessIdentity.model_validate_json(raw)
    if os.name != "nt":
        raise StoreControlError("Ownership marker requires Windows identity verification on this platform.")
    command = (f"$ErrorActionPreference = 'Stop'; $p = Get-CimInstance Win32_Process -Filter 'ProcessId = {marker.pid}'; "
               "if ($p) { [pscustomobject]@{ pid = [int]$p.ProcessId; executablePath = $p.ExecutablePath; "
               "startedAt = $p.CreationDate.ToString('o') } | ConvertTo-Json -Compress }")
    result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
                            capture_output=True, text=True, timeout=15, check=True,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    if result.stdout.strip():
        current = ProcessIdentity.model_validate_json(result.stdout)
        if (current.pid == marker.pid and current.executablePath.casefold() == marker.executablePath.casefold()
                and current.startedAt == marker.startedAt):
            raise StoreControlError("The recorded Sidecar is still running; close it before maintenance.")
