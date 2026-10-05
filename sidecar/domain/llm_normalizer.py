import re
import json
import urllib.request
import urllib.error
from collections import Counter
from typing import Optional, List, Dict, Any
from sidecar.config import OLLAMA_BASE_URL, logger

_PROTECTED_TOKEN = re.compile(r"(?<!\w)[+-]?\w*\d[\w./:@+-]*\b")


class NormalizationReviewRequired(Exception):
    def __init__(self, original_markdown: str, issues: List[Dict[str, Any]]):
        super().__init__("Normalization requires review; the original extraction was preserved and was not indexed.")
        self.original_markdown = original_markdown
        self.issues = issues

    def wire_payload(self) -> Dict[str, Any]:
        return {"original_markdown": self.original_markdown, "issues": self.issues}


def _layout_only(source: str, candidate: str) -> bool:
    if source == candidate:
        return True
    if source.split() != candidate.split():
        return False
    # Preserve whitespace-sensitive code, tables, markup and list structure exactly.
    for text in (source, candidate):
        if any(char in text for char in "`|<>\t#*_[]~"):
            return False
        if any(char.isspace() and char not in " \r\n" for char in text):
            return False
        for line in text.splitlines():
            stripped = line.lstrip()
            if line.startswith("    ") or stripped.startswith(("- ", "+ ")) or any(stripped.partition(marker)[0].isdigit() for marker in (". ", ") ")):
                return False
    return True


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
    think: bool = False,
    num_ctx: Optional[int] = None,
) -> str:
    """Accept conservative layout cleanup or retain the source for explicit review."""
    if not should_normalize_page_with_llm(page_text):
        return page_text
    if not model:
        raise _review(page_text, page_num, "model_missing")
    if isinstance(num_ctx, bool) or not isinstance(num_ctx, int) or not 256 <= num_ctx <= 131072:
        raise _review(page_text, page_num, "context_missing")

    endpoint = f"{ollama_url or OLLAMA_BASE_URL}/api/generate"
    prompt = (
        f"You are a conservative OCR whitespace normalizer.\n"
        f"Task: Clean up only ordinary prose spaces and line wraps from Page {page_num}.\n\n"
        f"Strict Rules:\n"
        f"1. Preserve every word, word boundary, punctuation mark, accent, letter case, name, code, date and number exactly.\n"
        f"2. NEVER split or fuse words, remove line-wrap hyphens, correct spelling or accents, or insert or remove Markdown markers.\n"
        f"3. Preserve code, tables, markup and lists exactly, including their whitespace. When unsure, return the original text unchanged.\n"
        f"4. Return ONLY the document body. Do not add code fences, titles, commentary or missing information.\n\n"
        f"--- RAW OCR TEXT FOR PAGE {page_num} ---\n"
        f"{page_text}\n"
        f"--- END RAW OCR TEXT ---"
    )

    # Conservative UTF-8 byte admission, plus template/EOS space; never slice the source.
    input_budget = len(prompt.encode("utf-8")) + 128
    output_budget = min(2048, num_ctx - input_budget)
    if output_budget < len(page_text.encode("utf-8")) + 64:
        raise _review(page_text, page_num, "context_budget_exceeded")

    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "think": bool(think),
        "options": {
            "temperature": 0.1,
            "num_ctx": num_ctx,
            "num_predict": output_budget,
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
    if Counter(_PROTECTED_TOKEN.findall(page_text)) != Counter(_PROTECTED_TOKEN.findall(cleaned_output)):
        raise _review(page_text, page_num, "entities_changed")
    if not _layout_only(page_text, cleaned_output):
        raise _review(page_text, page_num, "content_changed")
    logger.info("Page %s preserves words/punctuation under whitespace-only normalization (%s); semantic fidelity is not certified.", page_num, model)
    return cleaned_output
