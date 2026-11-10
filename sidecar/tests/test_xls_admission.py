"""Native Windows allocation failures and real XLS/index refusal boundaries."""
import ctypes
from ctypes import wintypes
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import pytest

from sidecar.domain.ingestion import extract_document_markdown
from sidecar.infrastructure import db, xls_process
from sidecar.infrastructure.source_provenance import SOURCE_ROOT
from _stream import done_payload, read_events
from _xls_fixtures import write_numeric_xls, write_string_xls, write_shared_strings_xls


def interpreter():
    return str(Path(sys.base_prefix) / Path(sys.executable).name)


def request(path, *, full=True, rows=150, sheets=10):
    return json.dumps({"path": str(path.resolve()), "rows": rows, "sheets": sheets, "full": full}).encode() + b"\n"


def assert_exited(pid, wait_ms=0):
    api = ctypes.WinDLL("kernel32", use_last_error=True)
    api.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    api.OpenProcess.restype = wintypes.HANDLE
    api.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    api.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = api.OpenProcess(0x00100000, False, pid)
    if handle:
        try:
            assert api.WaitForSingleObject(handle, wait_ms) == 0
        finally:
            api.CloseHandle(handle)


def test_native_commit_limit_refuses_allocation_and_reaps_worker():
    code = """import sys,json
sys.stdin.buffer.readline()
try:
    value = bytearray(256 * 1024 * 1024)
    print(json.dumps({'refused': False}))
except MemoryError:
    print(json.dumps({'refused': True}))
"""
    result = xls_process._run_bounded([interpreter(), "-I", "-c", code], b"go\n", memory_bytes=64 * 1024 * 1024)
    assert json.loads(result.output) == {"refused": True}
    assert 0 < result.peak_commit_bytes <= 64 * 1024 * 1024
    assert_exited(result.pid)
    print("NATIVE_XLS_ALLOCATION", result)


def test_timeout_terminates_owned_worker(tmp_path):
    marker = tmp_path / "pid.txt"
    code = "import sys,time,os,pathlib;pathlib.Path(sys.stdin.readline().strip()).write_text(str(os.getpid()));time.sleep(60)"
    with pytest.raises(ValueError, match="time budget"):
        xls_process._run_bounded([interpreter(), "-I", "-c", code], str(marker).encode() + b"\n", timeout=1)
    assert_exited(int(marker.read_text()))


def test_failed_admission_never_releases_parser_request(monkeypatch, tmp_path):
    marker = tmp_path / "should-not-exist"
    code = "import sys,pathlib;pathlib.Path(sys.stdin.readline().strip()).write_text('parsed')"

    def refuse(_job, _process):
        raise OSError("controlled job assignment refusal")

    monkeypatch.setattr(xls_process._WindowsJob, "admit", refuse)
    with pytest.raises(ValueError, match="containment could not be established"):
        xls_process._run_bounded([interpreter(), "-I", "-c", code], str(marker).encode() + b"\n")
    assert not marker.exists()


def test_owner_crash_closes_job_and_terminates_worker(tmp_path):
    marker = tmp_path / "owned-worker-pid"
    root = str(Path(__file__).resolve().parents[2])
    child = "import sys,os,pathlib,time;pathlib.Path(sys.stdin.readline().strip()).write_text(str(os.getpid()));time.sleep(60)"
    owner = f"""import sys,threading,time,os
from pathlib import Path
sys.path.insert(0,{root!r})
from sidecar.infrastructure.xls_process import _run_bounded
marker = Path({str(marker)!r})
threading.Thread(target=lambda: _run_bounded([{interpreter()!r},'-I','-c',{child!r}], str(marker).encode()+b'\\n'),daemon=True).start()
deadline = time.monotonic()+5
while not marker.exists() and time.monotonic()<deadline:
    time.sleep(0.01)
if not marker.exists():
    raise RuntimeError('Worker never started')
os._exit(0)
"""
    subprocess.run([interpreter(), "-I", "-B", "-c", owner], check=True, timeout=10, capture_output=True)
    assert_exited(int(marker.read_text()), wait_ms=5000)


def test_busy_parser_refuses_without_opening_source(monkeypatch):
    monkeypatch.setattr(xls_process, "XLS_QUEUE_SECONDS", 0)
    assert xls_process._SLOT.acquire(blocking=False)
    try:
        with pytest.raises(ValueError, match="busy"):
            xls_process.extract_xls_contained(b"", "/absent.xls", 150, 10, True)
    finally:
        xls_process._SLOT.release()


@pytest.fixture(scope="module")
def dense_xls(tmp_path_factory):
    source = tmp_path_factory.mktemp("dense-xls") / "dense.xls"
    write_numeric_xls(source, rows=65_536, columns=256)
    return source


def test_dense_full_format_is_refused_inside_native_budget(dense_xls):
    result = xls_process._run_bounded(xls_process._worker_command(), request(dense_xls))
    assert json.loads(result.output)["ok"] is False
    assert b"memory budget" in result.output
    assert result.peak_commit_bytes <= xls_process.XLS_MEMORY_BYTES
    assert_exited(result.pid)
    print("DENSE_XLS", dense_xls.stat().st_size, result.peak_commit_bytes, result.elapsed_seconds)


@pytest.mark.parametrize("full", [False, True])
def test_sparse_final_format_coordinate_keeps_source_and_cells(tmp_path, full):
    source = tmp_path / "sparse.xls"
    write_numeric_xls(source, rows=65_536, columns=256, sparse=True)
    original = source.read_bytes()
    result = xls_process._run_bounded(xls_process._worker_command(), request(source, full=full))
    response = json.loads(result.output)
    assert result.peak_commit_bytes < xls_process.XLS_MEMORY_BYTES
    if full:
        assert response["ok"] is True
        markdown = response["pages"][0][1]
        assert "65536" in markdown and "Col 256" in markdown and "Estratto RAG" in markdown
    else:
        # The normal first-150-row selection has always refused this empty range.
        assert response["ok"] is False
        assert "no readable cells" in response["error"]
    assert source.read_bytes() == original
    print("SPARSE_XLS", full, result.peak_commit_bytes, result.elapsed_seconds)


def test_string_heavy_many_sheets_stay_within_budget_and_selection(tmp_path):
    source = tmp_path / "strings.xls"
    write_string_xls(source, rows=2000, chars=4000, sheets=12)
    result = xls_process._run_bounded(xls_process._worker_command(), request(source, sheets=2))
    response = json.loads(result.output)
    assert response["ok"] is True
    assert result.peak_commit_bytes <= xls_process.XLS_MEMORY_BYTES
    markdown = response["pages"][0][1]
    assert "Text0" in markdown and "Text1" in markdown and "Text2" not in markdown
    assert "2 fogli su 12" in markdown
    assert "Celle abbreviate" in markdown
    print("STRING_XLS", source.stat().st_size, result.peak_commit_bytes, result.elapsed_seconds)


def test_global_shared_strings_are_inside_the_same_native_budget(tmp_path):
    source = tmp_path / "shared-strings.xls"
    write_shared_strings_xls(source)
    result = xls_process._run_bounded(xls_process._worker_command(), request(source))
    response = json.loads(result.output)
    assert response["ok"] is False
    assert "memory budget" in response["error"]
    assert result.peak_commit_bytes <= xls_process.XLS_MEMORY_BYTES
    assert_exited(result.pid)
    print("SHARED_STRING_XLS", source.stat().st_size, result.peak_commit_bytes, result.elapsed_seconds)


@pytest.mark.parametrize("full", [False, True])
def test_resource_refusal_preserves_existing_index_and_sources(sidecar_http_client, tmp_path, dense_xls, full):
    source = tmp_path / "keep.md"
    source.write_text("# Existing\nKeep these original words and their source.", encoding="utf-8")
    existing = done_payload(sidecar_http_client.post("/ingest-path-stream", json={"file_path": str(source)}))
    before = {name: db.lance_db.open_table(name).to_arrow().to_pylist() for name in db.get_existing_tables()}
    def archive_hashes():
        result = {}
        for path in SOURCE_ROOT.rglob("*"):
            if path.is_file():
                with path.open("rb") as stream:
                    result[str(path.relative_to(SOURCE_ROOT))] = hashlib.file_digest(stream, "sha256").hexdigest()
        return result

    archives = archive_hashes()
    with dense_xls.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    events = read_events(sidecar_http_client.post("/ingest-path-stream", json={"file_path": str(dense_xls), "allow_full_excel_format": full}))
    assert events[-1]["type"] == "error"
    assert ("memory budget" if full else "8 MiB") in events[-1]["error"]
    assert not any(event["type"] == "done" or event.get("step_code") == "embedding" for event in events)
    assert {name: db.lance_db.open_table(name).to_arrow().to_pylist() for name in db.get_existing_tables()} == before
    after_archives = archive_hashes()
    assert {key: after_archives[key] for key in archives} == archives
    # The established policy retains the failed task's original, without extraction.
    added = set(after_archives) - set(archives)
    assert len(added) == 1
    retained = added.pop()
    assert Path(retained).name == "original.xls"
    assert after_archives[retained] == digest
    with dense_xls.open("rb") as stream:
        assert hashlib.file_digest(stream, "sha256").hexdigest() == digest
    assert sidecar_http_client.get(f"/documents/{existing['id']}").status_code == 200
    assert source.read_text(encoding="utf-8").startswith("# Existing")
    if full:
        content = (Path(__file__).parent / "fixtures" / "ragged.xls").read_bytes()
        markdown, _ = extract_document_markdown("after-refusal.xls", content)
        assert "Sheet1" in markdown


def test_worker_entrypoint_does_not_import_sidecar_runtime():
    source = Path(__file__).parent / "fixtures" / "ragged.xls"
    command = xls_process._worker_command()
    entrypoint = Path(__file__).parents[1] / "main.py"
    bootstrap = (command[-1].split("runpy.run_path(", 1)[0]
                 + f"sys.argv=[{str(entrypoint)!r},'--xls-worker'];runpy.run_path({str(entrypoint)!r},run_name='__main__')")
    guard = """import builtins
original_import = builtins.__import__
def guarded_import(name, *args, **kwargs):
    if name in {'sidecar.config', 'sidecar.infrastructure.db', 'fastapi'}:
        raise RuntimeError('XLS worker attempted to import the Sidecar runtime')
    return original_import(name, *args, **kwargs)
builtins.__import__ = guarded_import
"""
    bootstrap = guard + bootstrap
    result = xls_process._run_bounded([*command[:-1], bootstrap], request(source))
    assert json.loads(result.output)["ok"] is True
