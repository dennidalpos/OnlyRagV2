"""Evaluate the installed Nomic encoder on frozen synthetic IT/EN passages."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import sys
import uuid


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root))
    corpus_path = root / "sidecar/tests/fixtures/embedding-preparation-it-en.json"
    corpus_bytes = corpus_path.read_bytes()
    corpus = json.loads(corpus_bytes)
    live_root = Path(os.environ.get("ONLYRAG_LIVE_ROOT", Path.home() / "OnlyRag-Live"))
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    evidence = live_root.resolve() / f"embedding-preparation-{stamp}-{uuid.uuid4().hex[:8]}"
    evidence.mkdir(parents=True)
    (evidence / "corpus.json").write_bytes(corpus_bytes)
    os.environ["ONLYRAG_DATA_DIR"] = str(evidence / "isolated-store")
    os.environ["OLLAMA_BASE_URL"] = "http://127.0.0.1:11434"

    from sidecar.config import httpx_client, OLLAMA_BASE_URL
    from sidecar.infrastructure.db import lance_db, recover_database
    from sidecar.infrastructure.embeddings import generate_embedding_batch
    from sidecar.schemas import SearchRequest
    from sidecar.services.ingest_service import process_and_index_document_generator
    from sidecar.services.search_service import perform_vector_search

    report = {
        "model": "nomic-embed-text:latest",
        "corpus_sha256": hashlib.sha256(corpus_bytes).hexdigest(),
        "python": platform.python_version(),
        "wire": [],
        "cases": [],
        "limits": "Synthetic retrieval only; no answer generation, multilingual certification or personal-data migration.",
    }
    original_post = httpx_client.post

    def capture(url, **kwargs):
        if str(url).endswith("/api/embed"):
            report["wire"].append(kwargs["json"])
        return original_post(url, **kwargs)

    httpx_client.post = capture
    try:
        recover_database()
        version = httpx_client.get(f"{OLLAMA_BASE_URL}/api/version")
        version.raise_for_status()
        report["ollama"] = version.json()
        show = original_post(f"{OLLAMA_BASE_URL}/api/show", json={"model": report["model"]})
        show.raise_for_status()
        report["model_details"] = show.json().get("details")
        ids = {}
        for document in corpus["documents"]:
            path = evidence / f"{document['id']}.md"
            path.write_text(document["text"], encoding="utf-8", newline="\n")
            events = [json.loads(event) for event in process_and_index_document_generator(str(path), embedding_model=report["model"])]
            if events[-1]["type"] != "done" or events[-1]["data"]["status"] != "indexed":
                raise RuntimeError(f"Native indexing failed for {document['id']}: {events[-1]}")
            ids[events[-1]["data"]["id"]] = document["id"]
        table = lance_db.open_table("chunks")
        rows = table.to_arrow().to_pylist()
        spaces = {row["embedding_space_id"] for row in rows}
        if len(spaces) != 1 or any(row["embedding_preparation"] != "nomic-search-v1" for row in rows):
            raise RuntimeError("Persisted preparation provenance is inconsistent.")
        report["space"] = {key: value for key, value in rows[0].items() if key.startswith("embedding_")}
        for query in corpus["queries"]:
            batch = generate_embedding_batch([query["text"]], report["model"], role="query")
            if batch.used_fallback or batch.space.metadata()["embedding_space_id"] not in spaces:
                raise RuntimeError("The query is outside the persisted native space.")
            dense = table.search(batch.vectors[0]).limit(len(rows)).to_list()
            dense_order = list(dict.fromkeys(ids[row["doc_id"]] for row in dense))
            fused = perform_vector_search(SearchRequest(query=query["text"], top_k=3))
            fused_order = list(dict.fromkeys(ids[result.doc_id] for result in fused))
            rank = dense_order.index(query["expected"]) + 1
            report["cases"].append({**query, "dense_rank": rank, "dense_order": dense_order, "pipeline_top3": fused_order})
        cases = report["cases"]
        report["metrics"] = {
            "count": len(cases),
            "dense_recall_at_1": sum(case["dense_rank"] == 1 for case in cases) / len(cases),
            "dense_recall_at_3": sum(case["dense_rank"] <= 3 for case in cases) / len(cases),
            "dense_mrr": sum(1 / case["dense_rank"] for case in cases) / len(cases),
            "pipeline_recall_at_3": sum(case["expected"] in case["pipeline_top3"] for case in cases) / len(cases),
        }
        document_requests = [request for request in report["wire"] if all(text.startswith("search_document: ") for text in request["input"])]
        query_requests = [request for request in report["wire"] if all(text.startswith("search_query: ") for text in request["input"])]
        if len(document_requests) != len(corpus["documents"]) or len(query_requests) != len(cases) * 2:
            raise RuntimeError("Captured role prefixes do not match the exercised indexing/search requests.")
        if any(request["truncate"] is not False for request in report["wire"]):
            raise RuntimeError("Silent embedding truncation was enabled.")
        report["passed"] = all(case["dense_rank"] <= 3 and case["expected"] in case["pipeline_top3"] for case in cases)
        print(json.dumps({"evidence": str(evidence), "metrics": report["metrics"], "passed": report["passed"]}))
        return 0 if report["passed"] else 1
    except Exception as error:
        report["error"] = str(error)
        raise
    finally:
        httpx_client.post = original_post
        report["source_sha256"] = {
            str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in [Path(__file__), root / "sidecar/infrastructure/embeddings.py", root / "sidecar/infrastructure/db.py", root / "sidecar/services/ingest_service.py", root / "sidecar/services/search_service.py"]
        }
        (evidence / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    raise SystemExit(main())
