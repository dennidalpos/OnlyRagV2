import re
import json
import urllib.request
import urllib.error
from typing import Optional
from sidecar.config import OLLAMA_BASE_URL, logger
from sidecar.domain.sanitizer import sanitize_extracted_text

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
    model: str = "llama3.2",
    timeout_seconds: float = 10.0,
    ollama_url: Optional[str] = None
) -> str:
    """
    Optional, per-page LLM Markdown normalizer.
    Calls local Ollama to clean up OCR line breaks, hyphenation, and fragmented layouts.
    Strictly preserves all factual content and falls back gracefully to deterministic sanitization
    on timeout, network error, or empty response.
    """
    if not should_normalize_page_with_llm(page_text):
        return sanitize_extracted_text(page_text)

    endpoint = f"{ollama_url or OLLAMA_BASE_URL}/api/generate"
    prompt = (
        f"You are an expert OCR Markdown layout normalizer.\n"
        f"Task: Clean up the following OCR-extracted text from Page {page_num}.\n\n"
        f"Strict Rules:\n"
        f"1. Fix broken word wraps, OCR spacing artifacts, and fragmented sentences.\n"
        f"2. Reconstruct clean Markdown structure (paragraphs, bullet points, headers, tables).\n"
        f"3. NEVER hallucinate, never invent information, and never omit existing names, codes, dates, or numbers.\n"
        f"4. Return ONLY the cleaned Markdown text without any preamble, conversational text, or enclosing ``` markdown fences.\n\n"
        f"--- RAW OCR TEXT FOR PAGE {page_num} ---\n"
        f"{page_text}\n"
        f"--- END RAW OCR TEXT ---"
    )

    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
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
            if response.status == 200:
                res_body = json.loads(response.read().decode("utf-8"))
                cleaned_output = res_body.get("response", "").strip()
                if cleaned_output:
                    # Strip markdown block fences if the LLM wrapped its entire response in ```markdown ... ```
                    cleaned_output = re.sub(r'^```(?:markdown)?\s*', '', cleaned_output)
                    cleaned_output = re.sub(r'\s*```$', '', cleaned_output).strip()
                    logger.info(f"Page {page_num} successfully normalized via LLM ({model})")
                    return sanitize_extracted_text(cleaned_output)
    except Exception as err:
        logger.debug(f"LLM normalization skipped on page {page_num} (falling back to deterministic): {err}")

    # Fallback guarantee: deterministic sanitization
    return sanitize_extracted_text(page_text)
