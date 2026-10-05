"""Capture real local normalization options; keep budget refusals separate from model quality."""
from contextlib import contextmanager
import datetime
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from types import SimpleNamespace
import urllib.request
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
HOST = "http://127.0.0.1:11434"
MODEL = "qwen3.5:9b"


def main():
    live_root = Path(os.environ.get("ONLYRAG_LIVE_ROOT", Path.home() / "OnlyRag-Live"))
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    evidence = live_root / f"normalization-context-{stamp}-{uuid.uuid4().hex[:8]}"
    evidence.mkdir(parents=True)
    os.environ["ONLYRAG_DATA_DIR"] = str(evidence / "isolated-store")
    from sidecar.domain.llm_normalizer import NormalizationReviewRequired, normalize_page_markdown_with_llm

    corpus_path = ROOT / "sidecar/tests/fixtures/content-acceptance-it-en.json"
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    (evidence / "corpus.json").write_bytes(corpus_path.read_bytes())
    report = {"complete": False, "cases": [], "source_sha256": {},
              "corpus_sha256": hashlib.sha256(corpus_path.read_bytes()).hexdigest()}
    save = lambda: (evidence / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Evidence: {evidence}", flush=True)
    try:
        with urllib.request.urlopen(f"{HOST}/api/tags", timeout=5) as response:
            models = json.load(response)["models"]
        model = next(item for item in models if item["name"] == MODEL)
        report["model"] = model
        with urllib.request.urlopen(f"{HOST}/api/version", timeout=5) as response:
            report["runtime"] = json.load(response)
        cases = [{**case, "num_ctx": 4096} for case in corpus["normalization_live"]]
        source = "The complete original report requires written consent before payment."
        cases += [{"id": "context-missing", "source": source, "num_ctx": None, "expected_reason": "context_missing"},
                  {"id": "context-small", "source": source, "num_ctx": 512, "expected_reason": "context_budget_exceeded"},
                  {"id": "output-overflow", "source": "界" * 800, "num_ctx": 32768, "expected_reason": "context_budget_exceeded"}]
        original_urlopen = urllib.request.urlopen
        for case in cases:
            captured = {**case, "requests": [], "response": None}

            @contextmanager
            def capture(request, timeout):
                captured["requests"].append({"payload": json.loads(request.data), "timeout": timeout})
                with original_urlopen(request, timeout=timeout) as response:
                    body = response.read()
                    captured["response"] = json.loads(body)
                    yield SimpleNamespace(status=response.status, read=lambda: body)

            started = time.monotonic()
            with patch("urllib.request.urlopen", capture):
                try:
                    captured["accepted_output"] = normalize_page_markdown_with_llm(case["source"], model=MODEL, num_ctx=case["num_ctx"], think=False)
                    captured["issues"] = []
                except NormalizationReviewRequired as refusal:
                    captured["accepted_output"] = None
                    captured["original_preserved"] = refusal.original_markdown == case["source"]
                    captured["issues"] = refusal.issues
            captured["elapsed_seconds"] = time.monotonic() - started
            report["cases"].append(captured)
            save()
            if "expected_reason" in case:
                assert not captured["requests"] and captured["original_preserved"]
                assert captured["issues"] == [{"page": 1, "reason": case["expected_reason"]}]
            else:
                assert len(captured["requests"]) == 1 and captured["response"] is not None
                request = captured["requests"][0]
                payload = request["payload"]
                assert payload["model"] == MODEL and payload["think"] is False and request["timeout"] == 25.0
                assert payload["options"]["num_ctx"] == case["num_ctx"]
                assert 0 < payload["options"]["num_predict"] <= 2048
                assert len(payload["prompt"].encode("utf-8")) + 128 + payload["options"]["num_predict"] <= case["num_ctx"]
            print(f"[PASS] {case['id']}: context/options/refusal mechanics only", flush=True)
        report["complete"] = True
    finally:
        for file in [Path(__file__), ROOT / "sidecar/domain/llm_normalizer.py", ROOT / "sidecar/domain/ingestion.py", ROOT / "sidecar/services/ingest_service.py"]:
            report["source_sha256"][str(file.relative_to(ROOT))] = hashlib.sha256(file.read_bytes()).hexdigest()
        save()


if __name__ == "__main__":
    main()
