"""Collect actual extraction/retrieval and normalization evidence on frozen synthetic data."""
import csv
import datetime
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import sys
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
HOST = "http://127.0.0.1:11434"
ENCODER = "nomic-embed-text:latest"
MODEL = "qwen3.5:9b"
CORPUS = ROOT / "sidecar/tests/fixtures/content-acceptance-it-en.json"
POLICY = ROOT / "sidecar/tests/fixtures/normalization-whitespace-policy.json"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def create_source(item, directory):
    import pymupdf
    from openpyxl import Workbook

    path = directory / f"{item['id']}.{item['format']}"
    if item["format"] == "pdf":
        with pymupdf.open() as pdf:
            for index, text in enumerate(item["pages"]):
                if index < len(item["pages"]) - 1:
                    text = "\n\n".join([text] * item.get("repeat_intro_pages", 1))
                page = pdf.new_page()
                if page.insert_textbox(pymupdf.Rect(50, 50, 545, 790), text, fontsize=10) < 0:
                    raise ValueError(f"Frozen page does not fit: {item['id']} page {index + 1}")
            pdf.save(path)
    elif item["format"] == "xlsx":
        book = Workbook()
        for index, sheet in enumerate(item["sheets"]):
            target = book.active if index == 0 else book.create_sheet()
            target.title = sheet["name"]
            for row in sheet["rows"]:
                target.append(row)
        book.save(path)
        book.close()
    elif item["format"] == "csv":
        with path.open("w", encoding="utf-8", newline="") as output:
            csv.writer(output).writerows(item["rows"])
    else:
        path.write_text("\n\n".join(item["pages"]), encoding="utf-8", newline="\n")
    return path


def matches(row, expected, identities):
    return identities[row["doc_id"]] == expected["document"] and all(value in row["text"] for value in expected["contains"])


def main():
    evidence = Path(sys.argv[1]).resolve()
    live_root = Path(os.environ.get("ONLYRAG_LIVE_ROOT", Path.home() / "OnlyRag-Live")).resolve()
    if evidence.parent != live_root or not evidence.name.startswith("content-acceptance-"):
        raise ValueError("Evidence must be a new campaign directory immediately inside OnlyRag-Live.")
    if (evidence / "isolated-store").exists():
        raise ValueError("Never reuse a previous campaign store.")
    evidence.mkdir(parents=True, exist_ok=True)
    corpus_bytes = CORPUS.read_bytes()
    (evidence / "corpus.json").write_bytes(corpus_bytes)
    corpus = json.loads(corpus_bytes)
    policy = json.loads(POLICY.read_text(encoding="utf-8"))
    if set(policy["expected_auto_acceptance"]) != {pair["id"] for pair in corpus["normalization_pairs"]}:
        raise ValueError("The approved decision policy must cover each frozen normalization pair exactly.")
    (evidence / "normalization-policy.json").write_bytes(POLICY.read_bytes())
    os.environ["ONLYRAG_DATA_DIR"] = str(evidence / "isolated-store")
    os.environ["OLLAMA_BASE_URL"] = HOST

    from sidecar.config import httpx_client
    from sidecar.domain.llm_normalizer import NormalizationReviewRequired, normalize_page_markdown_with_llm
    from sidecar.infrastructure.db import lance_db, recover_database
    from sidecar.infrastructure.embeddings import generate_embedding_batch
    from sidecar.infrastructure.source_provenance import resolve_source_location
    from sidecar.schemas import SearchRequest
    from sidecar.services.ingest_service import process_and_index_document_generator
    from sidecar.services.search_service import get_stored_document, perform_vector_search

    report = {"corpus_sha256": hashlib.sha256(corpus_bytes).hexdigest(), "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "python": platform.python_version(), "extraction": [], "retrieval": [], "normalization_pairs": [],
              "normalization_live": [], "normalization_policy": policy, "wire": [], "complete": False}
    for endpoint in ("version", "tags"):
        response = httpx_client.get(f"{HOST}/api/{endpoint}")
        response.raise_for_status()
        value = response.json()
        report[endpoint] = value if endpoint == "version" else [item for item in value["models"] if item["name"] in (MODEL, ENCODER)]
    if {item["name"] for item in report["tags"]} != {MODEL, ENCODER}:
        raise ValueError("The two permitted installed models are required; never install a substitute.")
    report["packages"] = {name: importlib.metadata.version(name) for name in ("pymupdf", "openpyxl", "pandas", "lancedb", "rapidocr", "onnxruntime-gpu")}
    original_post = httpx_client.post

    def capture(url, **kwargs):
        if str(url).endswith("/api/embed"):
            report["wire"].append(kwargs["json"])
        return original_post(url, **kwargs)

    httpx_client.post = capture
    try:
        recover_database()
        documents = {}
        identities = {}
        for item in corpus["documents"]:
            source = create_source(item, evidence)
            before = sha256(source)
            events = [json.loads(event) for event in process_and_index_document_generator(str(source), embedding_model=ENCODER)]
            write_json(evidence / f"{item['id']}-ingestion.json", events)
            if not events or events[-1]["type"] != "done" or events[-1]["data"]["status"] != "indexed":
                raise RuntimeError(f"Indexing failed: {item['id']}; inspect retained ingestion events.")
            document = get_stored_document(events[-1]["data"]["id"])
            documents[item["id"]] = document
            identities[document["id"]] = item["id"]
            missing = [value for value in item["required_extraction"] if value not in document["extracted_markdown"]]
            report["extraction"].append({"id": item["id"], "source_sha256": before, "source_unchanged": before == sha256(source),
                                         "missing": missing, "markdown": document["extracted_markdown"], "num_pages": document["num_pages"]})
        table = lance_db.open_table("chunks")
        rows = table.to_arrow().to_pylist()
        spaces = {row["embedding_space_id"] for row in rows}
        if len(spaces) != 1 or any(row["embedding_preparation"] != "nomic-search-v1" for row in rows):
            raise ValueError("Mixed encoder/preparation space in the isolated store.")
        report["space"] = {key: value for key, value in rows[0].items() if key.startswith("embedding_")}
        bundle = []
        for case in corpus["queries"]:
            batch = generate_embedding_batch([case["text"]], ENCODER, role="query")
            if batch.used_fallback or batch.space.metadata()["embedding_space_id"] not in spaces:
                raise ValueError("Actual native query vectors are required.")
            dense = table.search(batch.vectors[0]).limit(len(rows)).to_list()
            pipeline = perform_vector_search(SearchRequest(query=case["text"], top_k=3))
            selected = [documents[identity] for identity in case["selected"]]
            filtered = perform_vector_search(SearchRequest(query=case["text"], top_k=3, doc_ids=[item["id"] for item in selected]))
            expected_results = []
            for expected in case["evidence"]:
                dense_rank = next((index + 1 for index, row in enumerate(dense) if matches(row, expected, identities)), None)
                pipeline_rank = next((index + 1 for index, row in enumerate(pipeline) if matches(row.model_dump(), expected, identities)), None)
                filtered_rank = next((index + 1 for index, row in enumerate(filtered) if matches(row.model_dump(), expected, identities)), None)
                expected_results.append({**expected, "dense_rank": dense_rank, "pipeline_rank": pipeline_rank, "filtered_rank": filtered_rank})
            locations = {}
            for result in filtered:
                p = result.provenance
                if p is None:
                    raise ValueError("Actual original-file provenance is required.")
                if p.location_kind == "derived":
                    locations[result.chunk_id] = None
                    continue
                location = resolve_source_location(result.doc_id, result.chunk_id, p.source_revision, p.extraction_revision,
                                                   p.index_revision, p.span_start, p.span_end)
                locations[result.chunk_id] = location.model_dump()
            report["retrieval"].append({"id": case["id"], "kind": case["kind"], "expected": expected_results,
                                        "dense_order": [{"document": identities[row["doc_id"]], "text": row["text"]} for row in dense],
                                        "pipeline": [item.model_dump() for item in pipeline], "filtered": [item.model_dump() for item in filtered]})
            bundle.append({"case": case, "documents": selected, "results": [item.model_dump() for item in filtered], "locations": locations})
        write_json(evidence / "bundle.json", bundle)

        for pair in corpus["normalization_pairs"]:
            body = json.dumps({"response": pair["candidate"], "done": True, "done_reason": "stop"}).encode()

            @contextmanager
            def fixture_response(request, timeout):
                yield SimpleNamespace(status=200, read=lambda: body)

            with patch("urllib.request.urlopen", fixture_response):
                try:
                    normalize_page_markdown_with_llm(pair["source"], model="declared-pair-fixture", num_ctx=4096)
                    accepted, reasons = True, []
                except NormalizationReviewRequired as refusal:
                    accepted, reasons = False, refusal.issues
            expected = policy["expected_auto_acceptance"][pair["id"]]
            report["normalization_pairs"].append({**pair, "accepted": accepted, "reasons": reasons,
                                                  "expected_auto_acceptance": expected, "correct": accepted == expected, "transport": "declared fixture"})

        original_urlopen = urllib.request.urlopen
        for case in corpus["normalization_live"]:
            captured = {}

            @contextmanager
            def live_response(request, timeout):
                captured["request"] = json.loads(request.data)
                captured["timeout_seconds"] = timeout
                with original_urlopen(request, timeout=timeout) as response:
                    body = response.read()
                    captured["response"] = json.loads(body)
                    yield SimpleNamespace(status=response.status, read=lambda: body)

            with patch("urllib.request.urlopen", live_response):
                try:
                    output = normalize_page_markdown_with_llm(case["source"], model=MODEL, think=False, num_ctx=4096)
                    accepted, reasons = True, []
                except NormalizationReviewRequired as refusal:
                    output, accepted, reasons = None, False, refusal.issues
            report["normalization_live"].append({**case, **captured, "accepted": accepted, "output": output, "reasons": reasons, "semantic_review": None})

        expected = [item for case in report["retrieval"] for item in case["expected"]]
        report["metrics"] = {
            "expected_passages": len(expected),
            "dense_recall_at_1": sum(item["dense_rank"] == 1 for item in expected) / len(expected),
            "dense_recall_at_3": sum(item["dense_rank"] is not None and item["dense_rank"] <= 3 for item in expected) / len(expected),
            "dense_mrr": sum(1 / item["dense_rank"] if item["dense_rank"] else 0 for item in expected) / len(expected),
            "pipeline_recall_at_3": sum(item["pipeline_rank"] is not None for item in expected) / len(expected),
            "filtered_recall_at_3": sum(item["filtered_rank"] is not None for item in expected) / len(expected),
            "normalization_false_acceptance": sum(item["accepted"] and not item["safe"] for item in report["normalization_pairs"]),
            "normalization_false_rejection": sum(not item["accepted"] and item["safe"] for item in report["normalization_pairs"]),
        }
        report["mechanical_acceptance"] = all(not item["missing"] and item["source_unchanged"] for item in report["extraction"]) and all(item["pipeline_rank"] is not None and item["filtered_rank"] is not None for item in expected) and all(item["correct"] for item in report["normalization_pairs"])
        report["complete"] = True
        print(json.dumps({"evidence": str(evidence), "metrics": report["metrics"], "mechanical_acceptance": report["mechanical_acceptance"]}))
    finally:
        httpx_client.post = original_post
        report["source_sha256"] = {str(path.relative_to(ROOT)): sha256(path) for path in [Path(__file__), CORPUS, POLICY,
            ROOT / "sidecar/services/search_service.py", ROOT / "sidecar/services/ingest_service.py",
            ROOT / "sidecar/domain/llm_normalizer.py", ROOT / "sidecar/domain/ingestion.py", ROOT / "sidecar/infrastructure/embeddings.py"]}
        write_json(evidence / "preparation.json", report)
    # This collector succeeds only after collection; acceptance is a separate reviewed gate.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
