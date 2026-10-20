"""Evaluate one declared block-preserving splitter without changing production or frozen expectations."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def block_split(text, max_chars=800, overlap=100):
    """Keep complete lines (and whole code/table blocks); no overlap or query-dependent tuning."""
    if "```" in text or any(line.lstrip().startswith("|") for line in text.splitlines()):
        return [text]
    chunks, current = [], ""
    for line in text.splitlines(keepends=True):
        if current and len(current) + len(line) > max_chars:
            chunks.append(current.strip())
            current = ""
        if len(line) > max_chars:
            # A single oversized prose line retains the established splitter's admission budget.
            chunks.extend(ORIGINAL_SPLIT(line, max_chars=max_chars, overlap=overlap))
        else:
            current += line
    if current.strip():
        chunks.append(current.strip())
    return [chunk for chunk in chunks if chunk]


ORIGINAL_SPLIT = None


def main():
    global ORIGINAL_SPLIT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--campaign", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--variant", choices=("baseline", "blocks"), required=True)
    args = parser.parse_args()
    source = args.campaign.resolve()
    output = args.output.resolve()
    if output.exists() or output == source or source in output.parents:
        raise ValueError("A new output directory outside retained campaign data is required")
    output.mkdir(parents=True)
    os.environ["ONLYRAG_DATA_DIR"] = str(output / "store")
    os.environ["OLLAMA_BASE_URL"] = "http://127.0.0.1:11434"
    from sidecar.domain import ingestion
    from sidecar.infrastructure.db import lance_db, recover_database
    from sidecar.infrastructure.embeddings import generate_embedding_batch
    from sidecar.services.ingest_service import process_and_index_document_generator
    from sidecar.services.search_service import perform_vector_search
    from sidecar.schemas import SearchRequest
    ORIGINAL_SPLIT = ingestion._split_oversized_text
    corpus_bytes = (source / "corpus.json").read_bytes()
    corpus = json.loads(corpus_bytes)
    report = {"variant": args.variant, "corpusSha256": hashlib.sha256(corpus_bytes).hexdigest(),
              "policy": "Same 800-char prose bound; complete lines, atomic fenced/table blocks, no overlap. Oversized atomic blocks reject integration.",
              "sourceHashes": {}, "queries": [], "complete": False}
    identities = {}
    try:
        recover_database()
        with patch.object(ingestion, "_split_oversized_text", block_split if args.variant == "blocks" else ORIGINAL_SPLIT):
            for item in corpus["documents"]:
                original = source / f"{item['id']}.{item['format']}"
                digest = hashlib.sha256(original.read_bytes()).hexdigest()
                done = None
                for raw_event in process_and_index_document_generator(
                    str(original), embedding_model="nomic-embed-text:latest", normalize_with_llm=False
                ):
                    event = json.loads(raw_event)
                    if event.get("type") == "error":
                        raise RuntimeError(str(event))
                    if event.get("type") == "done":
                        done = event["data"]
                if not done or done["used_fallback_embeddings"]:
                    raise RuntimeError("Actual native encoder results are required")
                assert digest == hashlib.sha256(original.read_bytes()).hexdigest()
                identities[done["id"]] = item["id"]
                report["sourceHashes"][item["id"]] = digest
        table = lance_db.open_table("chunks")
        rows = table.to_arrow().to_pylist()
        report["chunks"] = len(rows)
        report["spaces"] = list({row["embedding_space_id"] for row in rows})
        report["maxBodyChars"] = max(len(row["text"].split("\n", 1)[-1]) for row in rows)
        for case in corpus["queries"]:
            batch = generate_embedding_batch([case["text"]], "nomic-embed-text:latest", role="query")
            assert not batch.used_fallback
            assert report['spaces'] == [batch.space.metadata()['embedding_space_id']]
            dense = table.search(batch.vectors[0]).limit(len(rows)).to_list()
            results = perform_vector_search(SearchRequest(query=case["text"], top_k=3))
            evidence = []
            for expected in case["evidence"]:
                def matches(row):
                    return identities[row["doc_id"]] == expected["document"] and all(part in row["text"] for part in expected["contains"])
                evidence.append({"expected": expected,
                    "denseRank": next((index + 1 for index, row in enumerate(dense) if matches(row)), None),
                    "pipelineRank": next((index + 1 for index, result in enumerate(results) if matches(result.model_dump())), None)})
            report["queries"].append({"id": case["id"], "evidence": evidence,
                "provenance": [result.provenance.model_dump() if result.provenance else None for result in results]})
        report["complete"] = True
    finally:
        (output / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("variant", "chunks", "maxBodyChars", "complete")}))


if __name__ == "__main__":
    main()
