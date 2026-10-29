"""Revision-bound original locations without migrating existing vector tables."""
import base64
import hashlib
import os
from pathlib import Path
from typing import Callable, Literal, Optional

import pymupdf
from pydantic import BaseModel, ConfigDict, Field

from sidecar.config import DATA_DIR, DOCS_TABLE_NAME, CHUNKS_TABLE_NAME
from sidecar.infrastructure.db import database_operation, get_existing_tables, lance_db, validate_doc_id
from sidecar.schemas import SourceProvenance, SourceLocationResponse
from sidecar.infrastructure.store_control import safe_path
from sidecar.domain.document_limits import require_document_text, require_document_pages

SOURCE_ROOT = Path(DATA_DIR) / "source-documents"
MAX_SOURCE_BYTES = 512 * 1024 * 1024
# Preserve the historical code-point read budget for old archives; new writes also pass the UTF-16 guard.
MAX_EXTRACTION_CHARS = 10_000_000


class SourcePage(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    number: int = Field(ge=1)
    start: int = Field(ge=0)
    end: int = Field(ge=0)


class SourceArchive(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    version: Literal[1] = 1
    source_revision: str = Field(pattern=r"^[a-f0-9]{64}$")
    extraction_revision: str = Field(pattern=r"^[a-f0-9]{64}$")
    original_name: str = Field(max_length=4096)
    original_file: str = Field(pattern=r"^original\.[a-z0-9]+$")
    raw_markdown: str = Field(max_length=MAX_EXTRACTION_CHARS)
    pages: list[SourcePage] = Field(max_length=10_000)
    paginated: bool


def text_revision(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _path(doc_id: str, name: str) -> Path:
    validate_doc_id(doc_id)
    root = SOURCE_ROOT.resolve()
    target = SOURCE_ROOT / doc_id / name
    if SOURCE_ROOT.is_symlink() or target.parent.is_symlink() or target.is_symlink() or not target.resolve().is_relative_to(root):
        raise ValueError("Source location escapes the document root.")
    return target


def retain_original(doc_id: str, file_path: str, check_cancelled,
                    on_created: Optional[Callable[[Path], None]] = None) -> tuple[Path, str]:
    """Copy and hash bounded blocks before extraction; never modify the caller's file."""
    suffix = Path(file_path).suffix.lower().lstrip(".")
    if not suffix.isascii() or not suffix.isalnum():
        suffix = "bin"
    target = _path(doc_id, f"original.{suffix}")
    target.parent.mkdir(parents=True, exist_ok=False)
    if on_created is not None:
        on_created(target.parent)
    digest = hashlib.sha256()
    total = 0
    with open(file_path, "rb") as source, target.open("xb") as retained:
        while block := source.read(1024 * 1024):
            check_cancelled()
            total += len(block)
            if total > MAX_SOURCE_BYTES:
                raise ValueError("Original exceeds the 512 MiB retention limit; no indexing performed.")
            retained.write(block)
            digest.update(block)
        retained.flush()
        os.fsync(retained.fileno())
    return target, digest.hexdigest()


def remove_owned_archive(doc_id: str, owned_directory: Path) -> None:
    """Remove only the new task's directory, after its database rollback succeeded."""
    validate_doc_id(doc_id)
    directory = safe_path(SOURCE_ROOT, doc_id)
    if directory != owned_directory:
        raise ValueError("Source cleanup ownership mismatch.")
    if not directory.exists():
        return
    entries = list(directory.iterdir())
    for entry in entries:
        safe_path(directory, entry.name)
        if not entry.is_file() or not (entry.name.startswith("original.") or entry.name in ("extraction.json", "extraction.tmp")):
            raise ValueError("Unexpected source cleanup artifact; preserve the archive.")
    for entry in entries:
        safe_path(directory, entry.name).unlink()
    directory.rmdir()


def save_extraction(doc_id: str, retained: Path, source_revision: str, filename: str,
                    pages: list[tuple[int, str]], paginated: bool) -> None:
    require_document_pages(len(pages))
    parts = [f"# {filename}\n\n"]
    spans = []
    cursor = len(parts[0])
    for number, text in pages:
        heading = f"## Page {number}\n\n"
        parts.extend([heading, text, "\n\n"])
        start = cursor + len(heading)
        spans.append(SourcePage(number=number, start=start, end=start + len(text)))
        cursor = start + len(text) + 2
    raw = "".join(parts).removesuffix("\n\n")
    require_document_text(raw)
    archive = SourceArchive(source_revision=source_revision, extraction_revision=text_revision(raw),
                            original_name=filename, original_file=retained.name, raw_markdown=raw,
                            pages=spans, paginated=paginated)
    temporary = _path(doc_id, "extraction.tmp")
    final = _path(doc_id, "extraction.json")
    if final.exists():
        raise ValueError("Original extraction is immutable.")
    with temporary.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(archive.model_dump_json())
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, final)


def _archive(doc_id: str) -> Optional[SourceArchive]:
    path = _path(doc_id, "extraction.json")
    if not path.exists():
        return None
    if path.stat().st_size > 64 * 1024 * 1024:
        raise ValueError("Source extraction exceeds its read budget.")
    archive = SourceArchive.model_validate_json(path.read_text(encoding="utf-8"))
    if text_revision(archive.raw_markdown) != archive.extraction_revision:
        raise ValueError("Original extraction revision mismatch.")
    return archive


def _record(table_name: str, column: str, identifier: str) -> Optional[dict]:
    validate_doc_id(identifier)
    if table_name not in get_existing_tables():
        return None
    rows = lance_db.open_table(table_name).search().where(f"{column} = '{identifier}'", prefilter=True).limit(1).to_list()
    return rows[0] if rows else None


@database_operation
def require_current_document(document: dict) -> None:
    """A selection is a canonical revision, never just a reusable document identifier."""
    current = _record(DOCS_TABLE_NAME, "id", document["id"])
    fields = ("id", "ingested_at", "extracted_markdown", "filename", "file_path", "file_type")
    if current is None or not document.get("ingested_at") or any(current.get(key) != document.get(key) for key in fields):
        raise ValueError("Document revision changed or is unavailable; reload before continuing.")


@database_operation
def read_retained_source(document: dict) -> tuple[SourceArchive, bytes]:
    """Return the exact verified bytes to consume, without reopening a mutable pathname."""
    require_current_document(document)
    try:
        archive = _archive(document["id"])
    except OSError as error:
        raise ValueError("Original archive could not be read.") from error
    if archive is None:
        raise ValueError("Verified original archive is unavailable; no external source substitution is allowed.")
    if archive.original_name != document.get("filename"):
        raise ValueError("Original archive does not match the selected document name.")
    if (document.get("_source_revision", archive.source_revision) != archive.source_revision
            or document.get("_extraction_revision", archive.extraction_revision) != archive.extraction_revision):
        raise ValueError("Original archive revision changed; reload before continuing.")
    original = _path(document["id"], archive.original_file)
    digest = hashlib.sha256()
    content = bytearray()
    try:
        with original.open("rb") as stream:
            while block := stream.read(1024 * 1024):
                if len(content) + len(block) > MAX_SOURCE_BYTES:
                    raise ValueError("Retained original exceeds its read budget.")
                content.extend(block)
                digest.update(block)
    except OSError as error:
        raise ValueError("Retained original could not be read.") from error
    if digest.hexdigest() != archive.source_revision:
        raise ValueError("Retained original revision mismatch.")
    return archive, bytes(content)


def chunk_source_provenance(doc_id: str, text: str, section: Optional[str]) -> Optional[SourceProvenance]:
    return chunk_source_provenance_batch([(doc_id, text, section)])[0]


@database_operation
def chunk_source_provenance_batch(chunks: list[tuple[Optional[str], str, Optional[str]]]) -> list[Optional[SourceProvenance]]:
    """Read each document once within this operation; never reuse it across requests."""
    groups: dict[str, list[tuple[int, str, Optional[str]]]] = {}
    results: list[Optional[SourceProvenance]] = [None] * len(chunks)
    for index, (doc_id, text, section) in enumerate(chunks):
        if doc_id is not None:
            groups.setdefault(doc_id, []).append((index, text, section))
    for doc_id, entries in groups.items():
        # The helper releases this document's archive before loading the next one.
        for index, provenance in _document_chunk_provenances(doc_id, entries):
            results[index] = provenance
    return results


def _document_chunk_provenances(doc_id: str, entries: list[tuple[int, str, Optional[str]]]) -> list[tuple[int, SourceProvenance]]:
    archive = _archive(doc_id)
    document = _record(DOCS_TABLE_NAME, "id", doc_id)
    if archive is None or document is None:
        return []
    index_revision = text_revision(document["extracted_markdown"])
    return [(index, _chunk_provenance(archive, index_revision, text, section)) for index, text, section in entries]


def _chunk_provenance(archive: SourceArchive, index_revision: str, text: str, section: Optional[str]) -> SourceProvenance:
    body = text.partition("\n")[2] if text.startswith("[Document: ") else text
    base = dict(source_revision=archive.source_revision, extraction_revision=archive.extraction_revision,
                index_revision=index_revision, section_header=section)
    start = archive.raw_markdown.find(body) if body else -1
    # Repeated text and rewritten content have no reliable original span.
    if start < 0 or archive.raw_markdown.find(body, start + 1) >= 0:
        return SourceProvenance(**base, location_kind="derived")
    end = start + len(body)
    page = next((page for page in archive.pages if page.start <= start and end <= page.end), None)
    if page is None:
        return SourceProvenance(**base, location_kind="derived")
    if index_revision != archive.extraction_revision:
        base["section_header"] = None
    return SourceProvenance(**base, location_kind="original", span_start=start, span_end=end,
                            exact_quote=body, page_number=page.number if archive.paginated else None)


@database_operation
def resolve_source_location(doc_id: str, chunk_id: str, source_revision: str,
                            extraction_revision: str, index_revision: str,
                            span_start: int, span_end: int) -> SourceLocationResponse:
    chunk = _record(CHUNKS_TABLE_NAME, "chunk_id", chunk_id)
    if chunk is None or chunk["doc_id"] != doc_id:
        raise ValueError("Source chunk is missing or belongs to another document.")
    provenance = chunk_source_provenance(doc_id, chunk["text"], chunk.get("section_header"))
    if (provenance is None or provenance.location_kind != "original"
            or provenance.source_revision != source_revision or provenance.extraction_revision != extraction_revision
            or provenance.index_revision != index_revision or span_start != provenance.span_start
            or not span_start < span_end <= provenance.span_end):
        raise ValueError("Source reference is stale, unavailable or outside the supplied chunk.")
    archive = _archive(doc_id)
    original = _path(doc_id, archive.original_file)
    digest = hashlib.sha256()
    total = 0
    with original.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            total += len(block)
            if total > MAX_SOURCE_BYTES:
                raise ValueError("Retained original exceeds its read budget.")
            digest.update(block)
    if digest.hexdigest() != source_revision:
        raise ValueError("Retained original revision mismatch.")
    image = None
    if original.suffix == ".pdf" and provenance.page_number is not None:
        with pymupdf.open(original) as pdf:
            page = pdf.load_page(provenance.page_number - 1)
            if page.rect.width * page.rect.height * (120 / 72) ** 2 > 16_000_000:
                raise ValueError("Original page exceeds its rendering budget.")
            image = base64.b64encode(page.get_pixmap(dpi=120).tobytes("png")).decode("ascii")
    return SourceLocationResponse(doc_id=doc_id, chunk_id=chunk_id, source_revision=source_revision,
                                  extraction_revision=extraction_revision, index_revision=index_revision,
                                  page_number=provenance.page_number, section_header=provenance.section_header,
                                  span_start=span_start, span_end=span_end,
                                  exact_quote=archive.raw_markdown[span_start:span_end], image_base64=image)
