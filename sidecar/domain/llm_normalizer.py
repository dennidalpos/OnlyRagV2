import re
import json
import urllib.request
import urllib.error
import unicodedata
from collections import Counter
from typing import Optional, List, Dict, Any
from sidecar.config import OLLAMA_BASE_URL, logger
from sidecar.domain.sanitizer import sanitize_extracted_text

_PROTECTED_TOKEN = re.compile(r"(?<!\w)[+-]?\w*\d[\w./:@+-]*\b")


class NormalizationReviewRequired(Exception):
    def __init__(self, original_markdown: str, issues: List[Dict[str, Any]]):
        super().__init__("Normalization requires review; the original extraction was preserved and was not indexed.")
        self.original_markdown = original_markdown
        self.issues = issues

    def wire_payload(self) -> Dict[str, Any]:
        return {"original_markdown": self.original_markdown, "issues": self.issues}


def _content_sequence(text: str) -> str:
    # Compare content order while allowing spacing, Markdown and accent cleanup.
    text = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "", text)
    normalized = unicodedata.normalize("NFKD", text).casefold()
    return "".join(char for char in normalized if char.isalnum() or char in "@=+%?!")


def _review(page_text: str, page_num: int, reason: str) -> NormalizationReviewRequired:
    return NormalizationReviewRequired(page_text, [{"page": page_num, "reason": reason}])

def should_normalize_page_with_llm(page_text: str) -> bool:
    """Heuristic check to determine if a page's extracted text warrants LLM normalization."""
    if not page_text or not page_text.strip():
        return False
    stripped = page_text.strip()
    if len(stripped) < 30:
        return False
    if stripped in ("[Empty Page Content]", "[Scanned page - No readable text detected]"):
        return False
    return True


def normalize_page_markdown_with_llm(
    page_text: str,
    page_num: int = 1,
    model: Optional[str] = None,
    timeout_seconds: float = 25.0,
    ollama_url: Optional[str] = None,
    think: bool = False
) -> str:
    """Accept conservative layout cleanup or retain the source for explicit review."""
    if not should_normalize_page_with_llm(page_text):
        return sanitize_extracted_text(page_text)
    if not model:
        raise _review(page_text, page_num, "model_missing")

    endpoint = f"{ollama_url or OLLAMA_BASE_URL}/api/generate"
    prompt = (
        f"You are an expert OCR Markdown layout normalizer.\n"
        f"Task: Clean up the following OCR-extracted text from Page {page_num}.\n\n"
        f"Strict Rules:\n"
        f"1. Fix fused words, missing spaces, and glued tokens (e.g., separate 'RICHIESTACESSAZIONECONTRATTO' into 'RICHIESTA CESSAZIONE CONTRATTO').\n"
        f"2. Fix broken line wraps, OCR spacing artifacts, and fragmented sentences.\n"
        f"3. Reconstruct clean Markdown structure (paragraphs, bullet points, headers, tables).\n"
        f"4. NEVER hallucinate, never invent information, and never omit existing names, codes, dates, or numbers.\n"
        f"5. Return ONLY the cleaned document body text. DO NOT add title banners like '**Cleaned Markdown Text**', and DO NOT add conversational notes, disclaimers, or comments at the end.\n\n"
        f"--- RAW OCR TEXT FOR PAGE {page_num} ---\n"
        f"{page_text}\n"
        f"--- END RAW OCR TEXT ---"
    )

    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "think": bool(think),
        "options": {
            "temperature": 0.1,
            "num_predict": 2048,
        }
    }

    try:
        req_data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            endpoint,
            data=req_data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
            if response.status != 200:
                raise _review(page_text, page_num, "request_failed")
            res_body = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, json.JSONDecodeError, UnicodeDecodeError):
        raise _review(page_text, page_num, "request_failed") from None

    if not isinstance(res_body, dict):
        raise _review(page_text, page_num, "incomplete_response")
    if res_body.get("done_reason") == "length":
        raise _review(page_text, page_num, "truncated")
    if res_body.get("done") is not True or res_body.get("done_reason") != "stop":
        raise _review(page_text, page_num, "incomplete_response")
    cleaned_output = res_body.get("response")
    if not isinstance(cleaned_output, str) or not cleaned_output.strip():
        raise _review(page_text, page_num, "empty_response")
    cleaned_output = cleaned_output.strip()
    if cleaned_output.startswith("```") and cleaned_output.endswith("```"):
        cleaned_output = re.sub(r'^```(?:markdown)?\s*', '', cleaned_output)
        cleaned_output = re.sub(r'\s*```$', '', cleaned_output).strip()
    cleaned_output = sanitize_extracted_text(cleaned_output)
    if Counter(_PROTECTED_TOKEN.findall(page_text)) != Counter(_PROTECTED_TOKEN.findall(cleaned_output)):
        raise _review(page_text, page_num, "entities_changed")
    if not cleaned_output or _content_sequence(page_text) != _content_sequence(cleaned_output):
        raise _review(page_text, page_num, "content_changed")
    logger.info("Page %s passed conservative LLM layout checks (%s); semantic fidelity is not certified.", page_num, model)
    return cleaned_output
