import os
from typing import Dict, Any, Optional
import pymupdf
import puremagic
from sidecar.config import logger

class DocumentCategory:
    PDF = "pdf"
    IMAGE = "image"
    DOCX = "docx"
    TABULAR = "tabular"
    TEXT = "text"
    UNKNOWN = "unknown"

class PageRoutingStrategy:
    NATIVE_TEXT = "native_text"
    OCR_REQUIRED = "ocr_required"
    HYBRID_VISION = "hybrid_vision"

def classify_file_type(filename: str, content_bytes: Optional[bytes] = None) -> str:
    """Classifies file type category based on extension, filename, and magic bytes header."""
    ext = os.path.splitext(filename)[1].lower() if filename else ""

    # Check magic byte signature if extension is missing or unknown
    if content_bytes and len(content_bytes) >= 16 and (not ext or ext in [".bin", ".dat"]):
        try:
            detected_ext = puremagic.from_string(content_bytes[:2048])
            if detected_ext:
                ext = detected_ext.lower()
        except Exception:
            pass

    if ext == ".pdf":
        return DocumentCategory.PDF
    elif ext in [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".gif"]:
        return DocumentCategory.IMAGE
    elif ext in [".docx", ".doc"]:
        return DocumentCategory.DOCX
    elif ext in [".csv", ".tsv", ".xlsx", ".xls", ".json", ".parquet"]:
        return DocumentCategory.TABULAR
    elif ext in [".txt", ".md", ".py", ".ts", ".js", ".html", ".css", ".yaml", ".yml", ".xml", ".sql", ".sh", ".ps1"]:
        return DocumentCategory.TEXT
    return DocumentCategory.UNKNOWN

def analyze_pdf_page_structure(page: pymupdf.Page, min_char_threshold: int = 40) -> Dict[str, Any]:
    """
    Analyzes a single PDF page to classify optimal extraction route:
    - NATIVE_TEXT: Page contains sufficient native text (>= min_char_threshold) or image-free short text
    - OCR_REQUIRED: Page has missing or sparse text layer with images/drawings (scanned page, graphic layout)
    """
    raw_text = page.get_text("text").strip()
    char_count = len(raw_text)
    images_list = page.get_images(full=True)
    image_count = len(images_list)
    drawing_count = len(page.get_drawings())

    if char_count >= min_char_threshold:
        strategy = PageRoutingStrategy.NATIVE_TEXT
    elif char_count > 0 and image_count == 0 and drawing_count == 0:
        # Genuine short image-free text layer (e.g. short note or translated line)
        strategy = PageRoutingStrategy.NATIVE_TEXT
    else:
        # Missing or sparse text layer with images or vector drawings: requires OCR
        strategy = PageRoutingStrategy.OCR_REQUIRED

    return {
        "strategy": strategy,
        "char_count": char_count,
        "image_count": image_count,
        "drawing_count": drawing_count,
        "has_native_text": char_count >= min_char_threshold or (char_count > 0 and image_count == 0)
    }
