"""Real isolated LanceDB and owned subprocesses; declared vectors test mechanics only."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import shutil
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pyarrow as pa
import pytest

from sidecar.infrastructure.document_recovery import DocumentRecovery
from sidecar.infrastructure.embeddings import EmbeddingBatch, EmbeddingSpace, FALLBACK_SPACE
from sidecar.infrastructure.store_control import StoreControlError, StoreLease, active_store, atomic_json, safe_path
from sidecar.services import store_rebuild_service as service

SPACE = EmbeddingSpace("qwen3-embedding:0.6b", "a" * 64, 1024, embedding_preparation="qwen3-retrieval-v1")


def vector(text):
    values = [0.0] * SPACE.embedding_dimension
    values[int(hashlib.sha256(text.encode()).hexdigest()[:8], 16) % len(values)] = 1.0
    return values


@pytest.fixture
def store(tmp_path, monkeypatch):
    root = tmp_path / "profile"
    source = root / "data" / "lancedb_store"
    source.mkdir(parents=True)
    connection = service.connect(source)
    docs = [{"id": "one", "filename": "notes.md", "file_type": ".md", "ingested_at": "2026-10-10",
             "num_chunks": 2, "extracted_markdown": "# Alpha\n\nFirst retained clause.\n\n## Beta\n\nSecond clause.",
             "file_path": "untouched-source.md", "num_pages": 1, "file_size": 87,
             "status": "indexed_fallback", "used_fallback_embeddings": True},
            {"id": "empty", "filename": "empty.md", "file_type": ".md", "ingested_at": "2026-10-09",
             "num_chunks": 0, "extracted_markdown": "", "file_path": "empty.md", "num_pages": 0,
             "file_size": 0, "status": "indexed", "used_fallback_embeddings": False}]
    connection.create_table("documents", data=docs)
    connection.create_table("chunks", data=[{"chunk_id": "legacy_0", "doc_id": "one", "text": "legacy", "vector": [1.0, 0.0]}])
    connection.create_table("prompt_history", data=[{"id": "prompt", "session_id": "session", "text": "RAW  user\ntext", "vector": [0.1, 0.2]}])
    connection.create_table("unrelated", data=pa.table({"bytes": [b"\x00\xff"], "nested": [[{"x": 7}]], "nullable": [None]}))
    archives = root / "data" / "source-documents" / "one"
    archives.mkdir(parents=True)
    (archives / "original.md").write_bytes(b"Original preserved bytes.\n")
    (archives / "extraction.json").write_text('{"retained":"exact original archive"}', encoding="utf-8")
    monkeypatch.setattr(service, "resolve_embedding_space", lambda model, **kwargs: SPACE)
    def batch(texts, model, expected_space, **kwargs):
        assert expected_space == SPACE and kwargs["role"] == "document"
        return EmbeddingBatch([vector(text) for text in texts], SPACE)
    monkeypatch.setattr(service, "generate_embedding_batch", batch)
    yield root
    assert root.parent == tmp_path and root.name == "profile" and not root.is_junction() and not root.is_symlink()
    shutil.rmtree(root)


def prepared(store):
    return service.prepare(store, SPACE.embedding_model)["rebuild_id"]


def run_python(code, root, **kwargs):
    env = {**os.environ, "ONLYRAG_DATA_DIR": str(root)}
    return subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, timeout=20, **kwargs)


def test_full_prepare_activate_restart_rollback_keeps_all_artifacts(store):
    data = store / "data"
    before_files = service.file_inventory(data / "lancedb_store")
    before_tables = service.table_evidence(service.connect(data / "lancedb_store"))
    assert service.preview(store)["rebuilt_chunks"] == 2
    identifier = prepared(store)
    assert active_store(data)[0].store_id == "legacy"
    manifest, _, _ = service.load_manifest(data, identifier)
    assert manifest.source_tables == before_tables
    assert service.file_inventory(data / "lancedb_store") == before_files
    assert service.file_inventory(data / "rebuilds" / identifier / "backup") == before_files
    service.activate(store, identifier)
    assert active_store(data)[0] == manifest.target
    restart = run_python("from sidecar.infrastructure import db; db.recover_database(); print(db.LANCEDB_DIR); print(db.lance_db.open_table('documents').count_rows()); print(db.lance_db.open_table('chunks').schema.field('vector').type.list_size)", store)
    assert restart.returncode == 0, restart.stderr
    assert identifier in restart.stdout and "1024" in restart.stdout
    service.activate(store, identifier)
    service.rollback(store, identifier)
    service.rollback(store, identifier)
    assert active_store(data)[0] == manifest.source
    assert service.table_evidence(service.connect(data / "lancedb_store")) == before_tables
    assert (data / manifest.target.path).is_dir()
    assert service.file_inventory(data / "source-documents") == manifest.archive_files
    restart = run_python("from sidecar.infrastructure import db; print(db.LANCEDB_DIR); print(db.lance_db.open_table('chunks').schema.names)", store)
    assert restart.returncode == 0 and "lancedb_store" in restart.stdout and "embedding_space_id" not in restart.stdout


@pytest.mark.parametrize("location", ["source", "backup", "target", "archive", "retained"])
def test_activation_refuses_every_changed_artifact(store, location):
    identifier = prepared(store)
    data = store / "data"
    paths = {"source": data / "lancedb_store", "backup": data / "rebuilds" / identifier / "backup",
             "target": data / "rebuilds" / identifier / "store", "archive": data / "source-documents",
             "retained": data / "rebuilds" / identifier / "source-documents"}
    (paths[location] / "changed.txt").write_text("changed", encoding="utf-8")
    with pytest.raises(StoreControlError, match="changed"):
        service.activate(store, identifier)
    assert not (data / "active-store.json").exists()


def test_failed_encoder_retains_verified_backup_without_activation(store, monkeypatch):
    working_encoder = service.generate_embedding_batch
    def fail(*args, **kwargs):
        raise RuntimeError("declared encoder failure")
    monkeypatch.setattr(service, "generate_embedding_batch", fail)
    before = service.file_inventory(store / "data" / "lancedb_store")
    with pytest.raises(RuntimeError, match="encoder failure"):
        prepared(store)
    jobs = list((store / "data" / "rebuilds").iterdir())
    assert len(jobs) == 1 and (jobs[0] / "backup").is_dir()
    assert not (jobs[0] / "manifest.json").exists()
    assert not (store / "data" / "active-store.json").exists()
    assert service.file_inventory(store / "data" / "lancedb_store") == before
    monkeypatch.setattr(service, "generate_embedding_batch", working_encoder)
    assert prepared(store) != jobs[0].name


def test_fallback_or_changed_space_is_never_accepted(store, monkeypatch):
    monkeypatch.setattr(service, "generate_embedding_batch", lambda *args, **kwargs: EmbeddingBatch([[1.0] * 768], FALLBACK_SPACE))
    with pytest.raises(StoreControlError, match="fell back"):
        prepared(store)


def test_document_count_change_requires_separate_metadata_policy(store):
    connection = service.connect(store / "data" / "lancedb_store")
    connection.open_table("documents").update(where="id = 'one'", values={"num_chunks": 1})
    with pytest.raises(StoreControlError, match="metadata migration"):
        prepared(store)


def test_orphan_chunks_without_retained_markdown_refuse_rebuild(store):
    table = service.connect(store / "data" / "lancedb_store").open_table("chunks")
    table.update(values={"doc_id": "missing"})
    with pytest.raises(StoreControlError, match="orphan chunks"):
        prepared(store)


def test_paginated_native_table_listing_is_complete_for_backup_and_recovery(store, monkeypatch):
    from types import SimpleNamespace
    from sidecar.infrastructure.document_recovery import restore_document
    from sidecar.infrastructure.store_control import list_store_tables
    connection = service.connect(store / "data" / "lancedb_store")
    names = list_store_tables(connection)
    monkeypatch.setattr(connection, "list_tables", lambda page_token=None: SimpleNamespace(
        tables=names[1:] if page_token else names[:1], page_token=None if page_token else "next"))
    assert list_store_tables(connection) == names
    assert set(service.table_evidence(connection)) == set(names)
    restore_document(connection, DocumentRecovery(doc_id="one", versions={"documents": None, "chunks": None}))
    assert connection.open_table("documents").count_rows() == 1
    assert connection.open_table("chunks").count_rows() == 0


def test_repeated_table_page_token_refuses_incomplete_inventory():
    from types import SimpleNamespace
    from sidecar.infrastructure.store_control import list_store_tables
    connection = SimpleNamespace(list_tables=lambda **kwargs: SimpleNamespace(tables=["one"], page_token="repeat"))
    with pytest.raises(StoreControlError, match="repeated"):
        list_store_tables(connection)


@pytest.mark.parametrize("version", [True, 1.0, 2, None])
def test_version_is_required_and_never_coerced_for_both_manifests(version):
    from pydantic import ValidationError
    from sidecar.infrastructure.store_control import ActiveStore
    from sidecar.infrastructure.store_rebuild_manifest import RebuildManifest
    identifier = "a" * 32
    source = {"store_id": "legacy", "path": "lancedb_store"}
    target = {"store_id": identifier, "path": f"rebuilds/{identifier}/store"}
    pointer = dict(store=target, previous_store_id="legacy", rebuild_manifest=f"rebuilds/{identifier}/manifest.json",
                   rebuild_manifest_sha256="a" * 64, mode="rebuilt")
    rebuild = dict(source=source, target=target, previous_active=None, model=SPACE.embedding_model,
                   embedding_space=SPACE.metadata(), source_files={}, archive_files={}, target_files={},
                   source_tables={}, target_tables={}, chunker_sha256="a" * 64)
    for model, payload in ((ActiveStore, pointer), (RebuildManifest, rebuild)):
        if version is not None:
            payload["version"] = version
        with pytest.raises(ValidationError):
            model.model_validate(payload)


def test_recovery_precedes_backup_and_invalid_recovery_blocks_every_operation(store):
    data = store / "data"
    connection = service.connect(data / "lancedb_store")
    saved = {name: connection.open_table(name).version for name in ("documents", "chunks")}
    before = service.table_evidence(connection)
    atomic_json(data / "document-recovery.json", DocumentRecovery(doc_id="one", versions=saved))
    connection.open_table("documents").delete("id = 'one'")
    identifier = prepared(store)
    manifest, _, _ = service.load_manifest(data, identifier)
    assert manifest.source_tables == before and not (data / "document-recovery.json").exists()
    (data / "document-recovery.json").write_text("{bad", encoding="utf-8")
    for operation, extra in ((service.preview, []), (service.prepare, [SPACE.embedding_model]),
                             (service.activate, [identifier]), (service.rollback, [identifier])):
        with pytest.raises(StoreControlError, match="recovery failed"):
            operation(store, *extra)
        assert (data / "document-recovery.json").read_text(encoding="utf-8") == "{bad"


@pytest.mark.parametrize("raw", ["{bad", '{"version":2}', '{"version":1,"store":{"store_id":"legacy","path":"../escape"}}'])
def test_invalid_active_pointer_blocks_runtime_and_cli_without_legacy_fallback(store, raw):
    (store / "data" / "active-store.json").write_text(raw, encoding="utf-8")
    with pytest.raises(StoreControlError, match="Invalid active"):
        service.preview(store)
    runtime = run_python("import sidecar.infrastructure.db", store)
    assert runtime.returncode != 0 and "Invalid active-store.json" in runtime.stderr


def test_missing_target_and_manifest_tamper_refuse_fallback(store):
    identifier = prepared(store)
    service.activate(store, identifier)
    data = store / "data"
    target = data / "rebuilds" / identifier / "store"
    target.rename(target.with_name("retained-store"))
    with pytest.raises(StoreControlError, match="missing"):
        service.preview(store)
    target.with_name("retained-store").rename(target)
    manifest = target.parent / "manifest.json"
    manifest.write_bytes(manifest.read_bytes() + b" ")
    with pytest.raises(StoreControlError, match="hash mismatch"):
        service.preview(store)


def test_atomic_replace_failure_preserves_pointer_and_staging(store, monkeypatch):
    identifier = prepared(store)
    from sidecar.infrastructure import store_control
    def fail(*args):
        raise PermissionError("declared replace refusal")
    monkeypatch.setattr(store_control.os, "replace", fail)
    with pytest.raises(PermissionError, match="replace refusal"):
        service.activate(store, identifier)
    assert not (store / "data" / "active-store.json").exists()
    assert list((store / "data").glob("active-store.json.*.tmp"))
    assert active_store(store / "data")[0].store_id == "legacy"


def test_leases_exclude_cli_and_runtime_and_release_on_owned_process_kill(store):
    with StoreLease(store / "data"):
        with pytest.raises(StoreControlError, match="lease unavailable"):
            service.preview(store)
        runtime = run_python("import sidecar.infrastructure.db", store)
        assert runtime.returncode != 0 and "lease unavailable" in runtime.stderr
    env = {**os.environ, "ONLYRAG_DATA_DIR": str(store)}
    process = subprocess.Popen([sys.executable, "-u", "-c", "import sidecar.infrastructure.db; print('owned-ready', flush=True); input()"],
                               env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert process.stdout.readline().strip() == "owned-ready"
        with pytest.raises(StoreControlError, match="lease unavailable"):
            service.preview(store)
        process.kill()
        process.communicate(timeout=10)
        assert service.preview(store)["rebuilt_chunks"] == 2
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=10)


@pytest.mark.parametrize("relative", ["../outside", "C:/outside", "rebuilds/../lancedb_store", "rebuilds\\outside", "/absolute"])
def test_store_paths_refuse_traversal(store, relative):
    with pytest.raises(StoreControlError, match="Invalid relative"):
        safe_path(store / "data", relative)


def test_real_junction_refuses_linked_store_and_lease(store, tmp_path):
    if os.name != "nt":
        pytest.skip("Windows junction fixture")
    link = store / "data" / "linked"
    subprocess.run(["cmd.exe", "/c", "mklink", "/J", str(link), str(tmp_path)], capture_output=True, check=True)
    try:
        with pytest.raises(StoreControlError, match="Linked"):
            safe_path(store / "data", "linked/child")
    finally:
        link.rmdir()


def test_cli_requires_explicit_root_and_operation_arguments(store):
    script = Path(__file__).resolve().parents[2] / "scripts" / "rebuild_embeddings.py"
    for arguments in (["preview"], ["prepare", "--root", str(store)], ["activate", "--root", str(store)],
                      ["preview", "--root", "."], ["preview", "--root", str(store), "--model", SPACE.embedding_model]):
        result = subprocess.run([sys.executable, str(script), *arguments], capture_output=True, text=True, timeout=10)
        assert result.returncode == 2


def test_native_cli_roundtrip_with_declared_loopback_encoder(store):
    class Encoder(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps({"models": [{"name": SPACE.embedding_model, "digest": SPACE.embedding_model_digest}]}).encode())

        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if self.path == "/api/show":
                result = {"model_info": {"qwen.embedding_length": SPACE.embedding_dimension}}
            else:
                assert self.path == "/api/embed" and payload["truncate"] is False
                result = {"embeddings": [vector(text) for text in payload["input"]]}
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())

        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), Encoder)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    script = Path(__file__).resolve().parents[2] / "scripts" / "rebuild_embeddings.py"
    env = {**os.environ, "OLLAMA_BASE_URL": f"http://127.0.0.1:{server.server_port}"}
    def invoke(operation, *extra):
        result = subprocess.run([sys.executable, str(script), operation, "--root", str(store), *extra],
                                env=env, capture_output=True, text=True, timeout=30)
        assert result.returncode == 0, result.stderr
        return json.loads(result.stdout)
    try:
        assert invoke("preview")["rebuilt_chunks"] == 2
        identifier = invoke("prepare", "--model", SPACE.embedding_model)["rebuild_id"]
        assert invoke("activate", "--rebuild-id", identifier)["active"]["store_id"] == identifier
        assert invoke("rollback", "--rebuild-id", identifier)["active"]["store_id"] == "legacy"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.mark.parametrize("phase", ["backup", "prepare-before", "prepare-after", "activate-before", "activate-after", "rollback-before", "rollback-after"])
def test_owned_process_interruption_retains_truthful_activation_and_artifacts(store, phase):
    identifier = prepared(store) if phase.startswith(("activate", "rollback")) else ""
    if phase.startswith("rollback"):
        service.activate(store, identifier)
    code = '''
import os
from pathlib import Path
from sidecar.services import store_rebuild_service as service
from sidecar.infrastructure import store_control
from sidecar.infrastructure.embeddings import EmbeddingBatch, EmbeddingSpace
space = EmbeddingSpace("qwen3-embedding:0.6b", "a" * 64, 1024, embedding_preparation="qwen3-retrieval-v1")
service.resolve_embedding_space = lambda *a, **k: space
service.generate_embedding_batch = lambda texts, **k: EmbeddingBatch([[1.0] + [0.0] * 1023 for text in texts], space)
phase = os.environ["TEST_INTERRUPT_PHASE"]
def stop():
    print("owned-interrupt-ready", flush=True)
    input()
original_copy = service.shutil.copytree
def copy(source, target, *a, **k):
    result = original_copy(source, target, *a, **k)
    if phase == "backup" and Path(target).name == "backup":
        stop()
    return result
service.shutil.copytree = copy
original_replace = store_control.os.replace
def replace(source, target):
    wanted = "manifest.json" if phase.startswith("prepare") else "active-store.json"
    if Path(target).name == wanted and phase.endswith("before"):
        stop()
    result = original_replace(source, target)
    if Path(target).name == wanted and phase.endswith("after"):
        stop()
    return result
store_control.os.replace = replace
root = Path(os.environ["ONLYRAG_DATA_DIR"])
if phase.startswith(("prepare", "backup")):
    service.prepare(root, space.embedding_model)
elif phase.startswith("activate"):
    service.activate(root, os.environ["TEST_REBUILD_ID"])
else:
    service.rollback(root, os.environ["TEST_REBUILD_ID"])
'''
    env = {**os.environ, "ONLYRAG_DATA_DIR": str(store), "TEST_INTERRUPT_PHASE": phase, "TEST_REBUILD_ID": identifier}
    process = subprocess.Popen([sys.executable, "-u", "-c", code], env=env, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        # communicate(timeout) bounds failed startup without hanging the suite on readline.
        ready = threading.Event()
        output = []
        def read_ready():
            output.append(process.stdout.readline().strip())
            ready.set()
        reader = threading.Thread(target=read_ready, daemon=True)
        reader.start()
        assert ready.wait(20), "Owned interruption fixture did not reach its checkpoint."
        assert output == ["owned-interrupt-ready"]
        process.kill()
        process.communicate(timeout=10)
        reader.join(timeout=5)
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=10)
    assert service.preview(store)["rebuilt_chunks"] == 2
    active, pointer = active_store(store / "data")
    expected_target = phase in ("activate-after", "rollback-before")
    assert (active.store_id == identifier) == expected_target
    jobs = list((store / "data" / "rebuilds").iterdir())
    assert all((job / "backup").is_dir() for job in jobs)
    if phase in ("backup", "prepare-before"):
        assert not (jobs[0] / "manifest.json").exists()
        with pytest.raises(FileNotFoundError):
            service.activate(store, jobs[0].name)
    elif phase == "prepare-after":
        service.activate(store, jobs[0].name)
        service.rollback(store, jobs[0].name)
    elif phase.startswith("activate"):
        service.activate(store, identifier)
        service.rollback(store, identifier)
    else:
        service.rollback(store, identifier)
    assert active_store(store / "data")[0].store_id == "legacy"


def test_second_rebuild_uses_current_store_and_refuses_unrelated_rollback(store):
    first = prepared(store)
    service.activate(store, first)
    second = prepared(store)
    service.activate(store, second)
    with pytest.raises(StoreControlError, match="rollback owner"):
        service.rollback(store, first)
    service.rollback(store, second)
    assert active_store(store / "data")[0].store_id == first


def test_old_sidecar_identity_marker_refuses_live_process_without_a_lease(store):
    if os.name != "nt":
        pytest.skip("Windows CIM marker fixture")
    process = subprocess.Popen([sys.executable, "-u", "-c", "print('old-ready', flush=True); input()"],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    marker = store / "sidecar-ownership.json"
    try:
        assert process.stdout.readline().strip() == "old-ready"
        command = (f"$p = Get-CimInstance Win32_Process -Filter 'ProcessId = {process.pid}'; "
                   "[pscustomobject]@{ pid = [int]$p.ProcessId; executablePath = $p.ExecutablePath; "
                   "startedAt = $p.CreationDate.ToString('o') } | ConvertTo-Json -Compress")
        result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
                                capture_output=True, text=True, timeout=15, check=True)
        identity = json.loads(result.stdout)
        marker.write_text(json.dumps(identity), encoding="utf-8")
        with pytest.raises(StoreControlError, match="still running"):
            service.preview(store)
        # A reused PID with another recorded start identity must not be adopted.
        marker.write_text(json.dumps({**identity, "startedAt": "2000-01-01T00:00:00Z"}), encoding="utf-8")
        assert service.preview(store)["rebuilt_chunks"] == 2
        marker.write_text(json.dumps(identity), encoding="utf-8")
        process.kill()
        process.communicate(timeout=10)
        assert service.preview(store)["rebuilt_chunks"] == 2
        marker.write_text("{bad", encoding="utf-8")
        with pytest.raises(ValueError):
            service.preview(store)
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=10)
