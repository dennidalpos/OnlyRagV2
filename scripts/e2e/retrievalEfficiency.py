"""Measure native retrieval in a new retained fixture root; never call a model."""
import argparse
from collections import defaultdict
import ctypes
from ctypes import wintypes
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import statistics
import sys
import tempfile
import threading
import time
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def distribution(values):
    return {"samplesMs": values, "medianMs": statistics.median(values),
            "p95Ms": sorted(values)[math.ceil(len(values) * .95) - 1]}


def process_counters():
    class Memory(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("faults", wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in (
                "peakWorkingSet", "workingSet", "peakPaged", "paged", "peakNonpaged",
                "nonpaged", "commit", "peakCommit")]

    class IO(ctypes.Structure):
        _fields_ = [(name, ctypes.c_ulonglong) for name in (
            "readOperations", "writeOperations", "otherOperations", "readBytes", "writeBytes", "otherBytes")]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Memory), wintypes.DWORD]
    kernel.GetProcessIoCounters.argtypes = [wintypes.HANDLE, ctypes.POINTER(IO)]
    memory, io = Memory(), IO()
    if not psapi.GetProcessMemoryInfo(wintypes.HANDLE(-1), ctypes.byref(memory), ctypes.sizeof(memory)):
        raise ctypes.WinError(ctypes.get_last_error())
    if not kernel.GetProcessIoCounters(wintypes.HANDLE(-1), ctypes.byref(io)):
        raise ctypes.WinError(ctypes.get_last_error())
    return {"peakWorkingSetBytes": memory.peakWorkingSet, "peakCommitBytes": memory.peakCommit,
            "processReadTransferBytes": io.readBytes, "processReadOperations": io.readOperations}


class TimedLock:
    """Observe the existing RLock; count only its outermost hold per thread."""
    def __init__(self, lock):
        self.lock, self.local = lock, threading.local()
        self.holds, self.waits = [], []

    def __enter__(self):
        start = time.perf_counter()
        self.lock.acquire()
        depth = getattr(self.local, "depth", 0)
        if depth == 0:
            self.waits.append((time.perf_counter() - start) * 1000)
            self.local.start = time.perf_counter()
        self.local.depth = depth + 1
        return self

    def __exit__(self, *args):
        self.local.depth -= 1
        if self.local.depth == 0:
            self.holds.append((time.perf_counter() - self.local.start) * 1000)
        self.lock.release()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", required=True, choices=("baseline", "after"))
    parser.add_argument("--chunks", type=int, default=100_000, choices=(10_000, 100_000))
    parser.add_argument("--samples", type=int, default=20)
    args = parser.parse_args()
    if sys.platform != "win32" or not 5 <= args.samples <= 100:
        parser.error("Windows and 5..100 samples are required.")
    scratch = Path(tempfile.mkdtemp(prefix=f"onlyrag-retrieval-{args.label}-"))
    print(f"Retained fixture: {scratch}", flush=True)
    os.environ["ONLYRAG_DATA_DIR"] = str(scratch / "profile")
    os.environ["OLLAMA_BASE_URL"] = "http://127.0.0.1:9"
    os.environ.pop("ONLYRAG_SIDECAR_TOKEN", None)

    import pyarrow as pa
    from sidecar.infrastructure import db, source_provenance as source
    from sidecar.infrastructure.chunk_storage import chunk_schema
    from sidecar.infrastructure.embeddings import EmbeddingBatch, EmbeddingSpace
    from sidecar.schemas import SearchRequest
    from sidecar.services import search_service as search

    # A real transport call is an error, including fallback attempts.
    import httpx
    def forbidden(*args, **kwargs):
        raise AssertionError("The fixture must not access a model or any network service.")
    httpx.Client.send = forbidden
    httpx.AsyncClient.send = forbidden
    space = EmbeddingSpace("fixture", "a" * 64, 128)
    search.generate_embedding_batch = lambda *a, **k: EmbeddingBatch([[1.0] + [0.0] * 127], space)
    width = args.chunks // 100

    def row(i, tail=False):
        doc = "tail" if tail else f"doc_{i // width:03}"
        evidence = not tail and i < 5
        text = f"NEEDLE42 unique clause {i}: payment within twenty one days." if evidence else f"Ordinary unrelated clause {i}."
        return {"vector": ([0.0, 1.0] if evidence else [1.0, 0.0]) + [0.0] * 126,
                "chunk_id": f"c_{i:06}" if not tail else f"tail_{i:06}", "doc_id": doc,
                "doc_name": f"{doc}.md", "text": text, "section_header": "Terms",
                "chunk_index": i, "file_type": "md", "ingested_at": "2026-10-18", **space.metadata()}

    schema = chunk_schema(128)
    batches = (pa.RecordBatch.from_pylist([row(i) for i in range(start, min(start + 1000, args.chunks))], schema=schema)
               for start in range(0, args.chunks, 1000))
    table = db.lance_db.create_table("chunks", pa.RecordBatchReader.from_batches(schema, batches))
    documents = []
    for d in range(100):
        doc = f"doc_{d:03}"
        body = "\n\n".join(row(i)["text"] for i in range(d * width, (d + 1) * width))
        if d == 0:
            body += "\n" + "Archived padding without query terms.\n" * 60_000
        original = scratch / f"{doc}.md"
        original.write_text(body, encoding="utf-8", newline="\n")
        retained, revision = source.retain_original(doc, str(original), lambda: None)
        source.save_extraction(doc, retained, revision, original.name, [(1, body)], False)
        archive = source._archive(doc)
        documents.append({"id": doc, "extracted_markdown": archive.raw_markdown})
    db.lance_db.create_table("documents", documents)

    def records_hash():
        values = {}
        for name in ("documents", "chunks"):
            data = db.lance_db.open_table(name).to_arrow().combine_chunks()
            sink = pa.BufferOutputStream()
            with pa.ipc.new_stream(sink, data.schema) as writer:
                writer.write_table(data)
            values[name] = hashlib.sha256(sink.getvalue().to_pybytes()).hexdigest()
        return values

    def files_hash():
        return {str(p.relative_to(source.SOURCE_ROOT)): digest(p) for p in source.SOURCE_ROOT.rglob("*") if p.is_file()}

    before_rows, before_files = records_hash(), files_hash()
    report = {"label": args.label, "chunks": args.chunks, "dimension": 128, "documents": 100,
              "samples": args.samples, "root": str(scratch), "python": sys.version, "platform": platform.platform(),
              "versions": {name: importlib.metadata.version(name) for name in ("lancedb", "pyarrow", "pydantic")},
              "sourceHashes": {str(p.relative_to(ROOT)): digest(p) for p in (
                  Path(__file__), ROOT / "sidecar/services/search_service.py",
                  ROOT / "sidecar/infrastructure/source_provenance.py", ROOT / "sidecar/infrastructure/chunk_storage.py")},
              "fixtureRowsBefore": before_rows, "archiveFilesBefore": before_files, "scenarios": []}
    phases, calls = defaultdict(list), defaultdict(int)
    lock = TimedLock(db._database_lock)
    original_read = Path.read_text
    archive_bytes = []

    def read_text(path, *a, **k):
        if path.name == "extraction.json" and path.is_relative_to(source.SOURCE_ROOT):
            archive_bytes.append(path.stat().st_size)
        return original_read(path, *a, **k)

    def timed(name, function):
        def wrapped(*a, **k):
            start = time.perf_counter()
            try:
                return function(*a, **k)
            finally:
                phases[name].append((time.perf_counter() - start) * 1000)
                calls[name] += 1
        return wrapped

    def run(name, selected=False, samples=args.samples):
        phases.clear()
        calls.clear()
        archive_bytes.clear()
        lock.holds.clear()
        lock.waits.clear()
        counters = process_counters()
        elapsed, outputs = [], []
        for _ in range(samples):
            start = time.perf_counter()
            results = search.perform_vector_search(SearchRequest(query="NEEDLE42", top_k=5, doc_id="doc_000" if selected else None))
            elapsed.append((time.perf_counter() - start) * 1000)
            assert len(results) == 5 and {r.chunk_id for r in results} == {f"c_{i:06}" for i in range(5)}
            assert all(r.provenance.location_kind == "original" for r in results)
            outputs.append([r.model_dump() for r in results])
        assert all(value == outputs[0] for value in outputs)
        after = process_counters()
        result = {"name": name, "search": distribution(elapsed), "phases": {k: distribution(v) for k, v in phases.items()},
                  "calls": dict(calls), "archiveReadCalls": len(archive_bytes), "archiveReadBytes": sum(archive_bytes),
                  "lockHold": distribution(lock.holds), "lockWait": distribution(lock.waits),
                  "outputSha256": hashlib.sha256(json.dumps(outputs[0], sort_keys=True).encode()).hexdigest(),
                  "processCountersAfter": after, "processReadTransferBytesDelta": after["processReadTransferBytes"] - counters["processReadTransferBytes"]}
        report["scenarios"].append(result)
        (scratch / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps({"name": name, "medianMs": result["search"]["medianMs"], "p95Ms": result["search"]["p95Ms"],
                          "archiveReadCalls": len(archive_bytes), "archiveReadBytes": sum(archive_bytes)}), flush=True)
        return results

    from contextlib import ExitStack
    from lancedb.table import LanceTable
    with ExitStack() as stack:
        stack.enter_context(patch.object(db, "_database_lock", lock))
        stack.enter_context(patch.object(Path, "read_text", read_text))
        for owner, key, label in ((search, "_stored_embedding_spaces", "metadata"),
                                  (search, "_lexical_candidates", "lexical"), (source, "_archive", "archive"),
                                  (source, "_record", "documentRead"), (source, "text_revision", "textHash"),
                                  (LanceTable, "create_fts_index", "ftsBuild")):
            stack.enter_context(patch.object(owner, key, timed(label, getattr(owner, key))))
        # No FTS indexes exist until the production first-search path creates them.
        assert list(table.list_indices()) == []
        run("first_full", samples=1)
        report["indexBytes"] = sum(p.stat().st_size for p in Path(db.LANCEDB_DIR).rglob("*") if p.is_file() and "_indices" in p.parts)
        run("warm_full")
        results = run("warm_selected", selected=True)
        start = time.perf_counter()
        p = results[0].provenance
        location = source.resolve_source_location(results[0].doc_id, results[0].chunk_id, p.source_revision,
                                                 p.extraction_revision, p.index_revision, p.span_start, p.span_end)
        assert location.exact_quote == p.exact_quote
        report["navigationMs"] = (time.perf_counter() - start) * 1000
        assert records_hash() == before_rows and files_hash() == before_files
        report["readOnlySearchPreservedRowsAndFiles"] = True
        # Append a declared 10% tail, including a lexical-only exact identifier.
        tail = [row(i, tail=True) for i in range(args.chunks // 10)]
        tail[-1]["text"] = "TAILCODE789 newly appended evidence"
        tail[-1]["vector"] = [0.0, 1.0] + [0.0] * 126
        table.add(pa.Table.from_pylist(tail, schema=schema))
        tail_rows = records_hash()
        run("unindexed_tail_full")
        found = search.perform_vector_search(SearchRequest(query="TAILCODE789", top_k=1))
        assert found[0].chunk_id == tail[-1]["chunk_id"]
        report["tailIndexStats"] = {
            index.name: {key: getattr(table.index_stats(index.name), key)
                         for key in ("num_indexed_rows", "num_unindexed_rows")}
            for index in table.list_indices()}
        assert records_hash() == tail_rows and files_hash() == before_files
        report["tailEvidenceFoundAndRowsPreserved"] = True
    report["complete"] = True
    (scratch / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"PASS: {scratch / 'report.json'}", flush=True)


if __name__ == "__main__":
    main()
