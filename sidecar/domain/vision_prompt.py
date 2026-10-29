"""
Vision OCR prompt assembly.

The `images:analysis` prompt node is authored, overridden and persisted on the Electron side as a
Mustache template. Three of the four variables it declares (`currentPage`, `numPages`,
`activePageContent`) are only known here, inside the sidecar's page loop, so the renderer ships the
raw template and this module renders it once per page.

Wire contract: a non-empty `vision_prompt` on an ingestion request means "the user selected the
multimodal Vision LLM as OCR engine" (`AppSettings.ocrEngine === 'vision_model'`). The renderer owns
that decision; the sidecar only honours it. When it is absent, ingestion stays on local RapidOCR.
"""

from typing import Optional

import chevron

# Mirrors `run_vision_ocr`'s own default, used when a template renders to nothing (an override
# emptied by the user) so the vision model still receives a usable instruction.
FALLBACK_VISION_PROMPT = (
    "Extract all text, tables, and key structure from this document image in clean Markdown format."
)


def is_vision_ocr_requested(vision_prompt: Optional[str]) -> bool:
    """True when the request carries a vision prompt, i.e. the user picked the Vision LLM engine."""
    return bool(vision_prompt and vision_prompt.strip())


def render_vision_prompt(
    template: Optional[str],
    filename: str,
    current_page: int,
    num_pages: int,
    active_page_content: str = ""
) -> str:
    """
    Renders the `images:analysis` Mustache template for one page.

    Falls back to the built-in instruction when the template is missing or renders empty; a
    malformed template (a half-typed override that reached disk) is passed through verbatim rather
    than aborting the page, since an imperfect instruction still yields usable OCR.
    """
    if not template or not template.strip():
        return FALLBACK_VISION_PROMPT

    view = {
        "filename": filename,
        "currentPage": current_page,
        "numPages": num_pages,
        "activePageContent": active_page_content or "",
    }

    try:
        rendered = chevron.render(template, view).strip()
    except Exception:
        return template.strip()

    return rendered or FALLBACK_VISION_PROMPT
