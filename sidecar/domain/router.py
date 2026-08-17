import os
from typing import Dict, Any
import pymupdf
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

def classify_file_type(filename: str) -> str:
    """Classifies file type category based on extension and filename."""
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".pdf":
        return DocumentCategory.PDF
    elif ext in [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".gif"]:
        return DocumentCategory.IMAGE
    elif ext in [".docx", ".doc"]:
        return DocumentCategory.DOCX
    elif ext in [".csv", ".tsv", ".xlsx", ".json", ".parquet"]:
        return DocumentCategory.TABULAR
    elif ext in [".txt", ".md", ".py", ".ts", ".js", ".html", ".css", ".yaml", ".yml", ".xml", ".sql", ".sh", ".ps1"]:
        return DocumentCategory.TEXT
    return DocumentCategory.UNKNOWN

def analyze_pdf_page_structure(page: pymupdf.Page, min_char_threshold: int = 40) -> Dict[str, Any]:
    """
    Analyzes a single PDF page to classify optimal extraction route:
    - Checks native text character count
    - Checks count of embedded images/drawings
    - Classifies as NATIVE_TEXT, OCR_REQUIRED, or HYBRID_VISION
    """
    raw_text = page.get_text("text").strip()
    char_count = len(raw_text)
    images_list = page.get_images(full=True)
    image_count = len(images_list)
    drawing_count = len(page.get_drawings())

    if char_count >= min_char_threshold:
        if image_count > 0 or drawing_count > 5:
            strategy = PageRoutingStrategy.HYBRID_VISION
        else:
            strategy = PageRoutingStrategy.NATIVE_TEXT
    else:
        strategy = PageRoutingStrategy.OCR_REQUIRED

    return {
        "strategy": strategy,
        "char_count": char_count,
        "image_count": image_count,
        "drawing_count": drawing_count,
        "has_native_text": char_count >= min_char_threshold
    }
