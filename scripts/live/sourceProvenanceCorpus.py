"""Freeze actual local retrieval and retained-original locations for the citation campaign."""
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def main():
    evidence = Path(sys.argv[1]).resolve()
    os.environ["ONLYRAG_DATA_DIR"] = str(evidence / "isolated-store")
    os.environ["OLLAMA_BASE_URL"] = "http://127.0.0.1:11434"
    import pymupdf
    from sidecar.infrastructure.db import recover_database
    from sidecar.infrastructure.source_provenance import resolve_source_location
    from sidecar.schemas import SearchRequest
    from sidecar.services.ingest_service import process_and_index_document_generator
    from sidecar.services.search_service import get_stored_document, perform_vector_search

    recover_database()
    cases = json.loads((evidence / "cases.json").read_text(encoding="utf-8"))
    bundle = []
    for case in cases:
        pdf_path = evidence / f"{case['id']}.pdf"
        with pymupdf.open() as pdf:
            for text in case["pages"]:
                page = pdf.new_page()
                result = page.insert_textbox(pymupdf.Rect(72, 72, 520, 700), text, fontsize=12)
                if result < 0:
                    raise ValueError("Frozen source exceeds its PDF page.")
            pdf.save(pdf_path)
        events = [json.loads(event) for event in process_and_index_document_generator(str(pdf_path), embedding_model="nomic-embed-text")]
        (evidence / f"{case['id']}-ingestion.json").write_text(json.dumps(events, indent=2) + "\n", encoding="utf-8", newline="\n")
        if events[-1]["type"] != "done":
            raise ValueError(f"{case['id']}: ingestion failed")
        doc_id = events[-1]["data"]["id"]
        results = perform_vector_search(SearchRequest(query=case["query"], top_k=5, doc_ids=[doc_id]))
        if not results or any(result.provenance is None or result.provenance.location_kind != "original" for result in results):
            raise ValueError(f"{case['id']}: no verifiable retrieval locations")
        locations = {}
        for result in results:
            p = result.provenance
            location = resolve_source_location(doc_id, result.chunk_id, p.source_revision, p.extraction_revision,
                                               p.index_revision, p.span_start, p.span_end)
            locations[result.chunk_id] = location.model_dump()
        bundle.append({"case": case, "document": get_stored_document(doc_id),
                       "results": [result.model_dump() for result in results], "locations": locations})
    (evidence / "bundle.json").write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"Prepared {len(bundle)} actual retrieval cases and original locations.")


if __name__ == "__main__":
    main()
