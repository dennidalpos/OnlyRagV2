"""The desktop editor's UTF-16 admission budget, without changing stored documents."""

MAX_DOCUMENT_TEXT_UNITS = 10_000_000
MAX_DOCUMENT_PAGES = 10_000


class DocumentSizeError(ValueError):
    """Refuse a document before indexing, never silently truncate its text."""


def require_document_text(text: str) -> str:
    # The cheap code-point check rejects very large inputs before scanning astral characters.
    if len(text) > MAX_DOCUMENT_TEXT_UNITS or (
            not text.isascii() and len(text) + sum(char > "\uffff" for char in text) > MAX_DOCUMENT_TEXT_UNITS):
        raise DocumentSizeError(
            "Document text exceeds the 10 million UTF-16 unit limit; export as Markdown or split the document.")
    return text


def require_document_pages(count: int) -> None:
    if count > MAX_DOCUMENT_PAGES:
        raise DocumentSizeError("Document exceeds the 10,000-page review limit; split the document.")
