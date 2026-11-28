"""Publish completed translations without exposing partial or replacing existing files."""
import mmap
import os
import tempfile
from pathlib import Path
from types import TracebackType
from typing import Optional
from zipfile import ZipFile

import docx
import pymupdf


class TranslationCleanupError(OSError):
    def __init__(self, message: str, stream_closed: bool):
        super().__init__(message)
        self.stream_closed = stream_closed


class TranslationOutput:
    def __init__(self, destination: str, file_type: str):
        self.destination = destination
        self.file_type = file_type
        self.directory: Optional[Path] = None
        self.path = ""
        self.published = False

    def __enter__(self) -> "TranslationOutput":
        self.directory = Path(tempfile.mkdtemp(prefix=".onlyrag-translation-", dir=os.path.dirname(self.destination)))
        self.path = str(self.directory / f"output.{self.file_type}")
        return self

    def validate(self, pages: int) -> int:
        if self.file_type == "docx":
            with ZipFile(self.path) as package:
                if package.testzip() is not None:
                    raise ValueError("Translated DOCX failed ZIP validation")
            with open(self.path, "rb") as stream:
                docx.Document(stream)
        else:
            # An invalid native filename open can retain its handle in the exception
            # traceback on Windows. Own the mapping and buffer lifetime explicitly.
            with open(self.path, "rb") as stream, mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as mapping:
                with memoryview(mapping) as buffer, pymupdf.open(stream=buffer, filetype="pdf") as document:
                    if not document.is_pdf or document.needs_pass or document.page_count != pages:
                        raise ValueError("Translated PDF failed validation")
                    for page in document:
                        page.get_text()
        # Flush only after the native serializer has closed its handles.
        with open(self.path, "rb+") as stream:
            stream.flush()
            os.fsync(stream.fileno())
            return os.fstat(stream.fileno()).st_size

    def publish(self) -> None:
        # Same-volume hard-link creation is exclusive, including on Windows. Unsupported
        # filesystems fail safely; never fall back to a replacing rename or partial copy.
        os.link(self.path, self.destination)
        self.published = True

    def __exit__(self, exc_type: Optional[type], exc: Optional[BaseException], traceback: Optional[TracebackType]) -> None:
        try:
            Path(self.path).unlink(missing_ok=True)
            if self.directory is not None:
                self.directory.rmdir()
        except OSError as cleanup_error:
            state = f"Complete output published at {self.destination}. " if self.published else "No output published. "
            raise TranslationCleanupError(
                f"{state}Translation staging cleanup failed at {self.directory}: {cleanup_error}. Original outcome: {exc}",
                stream_closed=isinstance(exc, GeneratorExit),
            ) from cleanup_error
