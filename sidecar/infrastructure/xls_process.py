"""One XLS parser at a time, with Windows commit limits before parser admission."""
import ctypes
from ctypes import wintypes
from dataclasses import dataclass
import json
import os
from pathlib import Path
import subprocess
import sys
import sysconfig
import tempfile
import threading
import time

XLS_MEMORY_BYTES = 512 * 1024 * 1024
XLS_TIMEOUT_SECONDS = 60
XLS_QUEUE_SECONDS = 5
_COMMIT_HEADROOM_BYTES = 16 * 1024 * 1024
_SLOT = threading.BoundedSemaphore(1)


class _BasicLimits(ctypes.Structure):
    _fields_ = [("user_time", ctypes.c_longlong), ("job_time", ctypes.c_longlong),
                ("flags", wintypes.DWORD), ("min_working_set", ctypes.c_size_t),
                ("max_working_set", ctypes.c_size_t), ("active_processes", wintypes.DWORD),
                ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD)]


class _IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_ulonglong) for name in ("reads", "writes", "others", "read_bytes", "write_bytes", "other_bytes")]


class _ExtendedLimits(ctypes.Structure):
    _fields_ = [("basic", _BasicLimits), ("io", _IoCounters),
                ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
                ("peak_process_memory", ctypes.c_size_t), ("peak_job_memory", ctypes.c_size_t)]


class _WindowsJob:
    def __init__(self, memory_bytes):
        if sys.platform != "win32":
            raise ValueError("XLS parsing requires Windows resource containment; export as CSV or XLSX.")
        self.api = ctypes.WinDLL("kernel32", use_last_error=True)
        self.api.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.api.CreateJobObjectW.restype = wintypes.HANDLE
        self.api.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        self.api.SetInformationJobObject.restype = wintypes.BOOL
        self.api.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p]
        self.api.QueryInformationJobObject.restype = wintypes.BOOL
        self.api.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.api.AssignProcessToJobObject.restype = wintypes.BOOL
        self.api.CloseHandle.argtypes = [wintypes.HANDLE]
        self.api.CloseHandle.restype = wintypes.BOOL
        self.api.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        self.api.WaitForSingleObject.restype = wintypes.DWORD
        self.handle = self.api.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = _ExtendedLimits()
        # JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_MEMORY | KILL_ON_JOB_CLOSE | ACTIVE_PROCESS.
        limits.basic.flags = 0x100 | 0x200 | 0x2000 | 0x8
        limits.basic.active_processes = 1
        # Windows can report slightly higher peak accounting than its configured
        # allocation threshold. Reserve 16 MiB inside the declared worker budget.
        if memory_bytes <= _COMMIT_HEADROOM_BYTES:
            self.close()
            raise ValueError("XLS worker budget is below its accounting reserve.")
        limits.process_memory = limits.job_memory = memory_bytes - _COMMIT_HEADROOM_BYTES
        if not self.api.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            error = ctypes.WinError(ctypes.get_last_error())
            self.close()
            raise error

    def admit(self, process):
        # Popen owns this real process handle; never reopen a PID that could be reused.
        if not self.api.AssignProcessToJobObject(self.handle, wintypes.HANDLE(int(process._handle))):
            raise ctypes.WinError(ctypes.get_last_error())

    def peak(self):
        limits = _ExtendedLimits()
        if not self.api.QueryInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits), None):
            raise ctypes.WinError(ctypes.get_last_error())
        return limits.peak_job_memory

    def close(self):
        if self.handle:
            self.api.CloseHandle(self.handle)
            self.handle = None


@dataclass(frozen=True)
class _WorkerResult:
    output: bytes
    peak_commit_bytes: int
    elapsed_seconds: float
    pid: int


def _run_bounded(command, request, *, memory_bytes=XLS_MEMORY_BYTES, timeout=XLS_TIMEOUT_SECONDS):
    started = time.monotonic()
    job = _WindowsJob(memory_bytes)
    process = None
    isolated_data = None
    try:
        isolated_data = tempfile.TemporaryDirectory(prefix="onlyrag-xls-worker-")
        environment = {key: value for key, value in os.environ.items()
                       if key not in {"ONLYRAG_SIDECAR_TOKEN", "ONLYRAG_DATA_DIR", "OLLAMA_BASE_URL"}}
        # A table parser needs no BLAS thread pool (and its per-thread stacks).
        environment.update(OPENBLAS_NUM_THREADS="1", OMP_NUM_THREADS="1", MKL_NUM_THREADS="1", NUMEXPR_NUM_THREADS="1")
        # Even a future accidental runtime import must never find the user's store.
        environment["ONLYRAG_DATA_DIR"] = str(Path(isolated_data.name) / "unused-store")
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   env=environment, creationflags=subprocess.CREATE_NO_WINDOW, cwd=Path(__file__).resolve().parents[2])
        # The worker waits on stdin with stdlib only. No workbook or parser can be
        # loaded until AssignProcessToJobObject has succeeded and this request is sent.
        job.admit(process)
        output, _ = process.communicate(request, timeout=timeout)
        peak = job.peak()
        if process.returncode != 0:
            raise ValueError("XLS parser stopped within its memory/process budget; export as CSV or XLSX.")
        return _WorkerResult(output, peak, time.monotonic() - started, process.pid)
    except subprocess.TimeoutExpired as error:
        raise ValueError(f"XLS parser exceeded its {timeout}-second time budget; export as CSV or XLSX.") from error
    except OSError as error:
        raise ValueError("XLS resource containment could not be established; parsing refused.") from error
    finally:
        job.close()  # Closing the last handle terminates the owned job on every exit.
        if process is not None:
            if process.poll() is None:
                process.kill()
            # TerminateProcess can report an exit code before the process object
            # is signalled. Popen.wait may skip waiting once returncode is set.
            if job.api.WaitForSingleObject(wintypes.HANDLE(int(process._handle)), 5000) != 0:
                raise ValueError("XLS worker did not terminate after resource containment closed.")
            process.wait(timeout=5)
            for stream in (process.stdin, process.stdout):
                if stream is not None:
                    stream.close()
        if isolated_data is not None:
            isolated_data.cleanup()


def extract_xls_contained(content, file_path, rows, sheets, full):
    if not _SLOT.acquire(timeout=XLS_QUEUE_SECONDS):
        raise ValueError("XLS parser is busy; retry after the current workbook completes.")
    try:
        with tempfile.TemporaryDirectory(prefix="onlyrag-xls-") as scratch:
            source = Path(file_path).resolve() if file_path and Path(file_path).exists() else Path(scratch) / "source.xls"
            if source.parent == Path(scratch):
                source.write_bytes(content)
            request = json.dumps({"path": str(source), "rows": rows, "sheets": sheets, "full": full}).encode("utf-8") + b"\n"
            if len(request) > 16 * 1024:
                raise ValueError("XLS worker request exceeds its limit.")
            command = _worker_command()
            result = _run_bounded(command, request, memory_bytes=XLS_MEMORY_BYTES, timeout=XLS_TIMEOUT_SECONDS)
            if len(result.output) > 32 * 1024 * 1024:
                raise ValueError("XLS extraction exceeds the worker output limit.")
            try:
                response = json.loads(result.output)
                if response.get("ok") is not True:
                    if response.get("dependency"):
                        raise ImportError(response.get("error", "XLS parser dependency unavailable."))
                    raise ValueError(response.get("error", "XLS parser refused the workbook."))
                pages = response["pages"]
                if (not isinstance(pages, list) or len(pages) != 1 or len(pages[0]) != 2
                        or pages[0][0] != 1 or not isinstance(pages[0][1], str)):
                    raise TypeError("Invalid pages")
                return [(1, pages[0][1])]
            except (json.JSONDecodeError, KeyError, TypeError, AttributeError) as error:
                raise ValueError("XLS parser returned an invalid response; no content was indexed.") from error
    finally:
        _SLOT.release()


def _worker_command():
    if getattr(sys, "frozen", False):
        return [sys.executable, "--xls-worker"]
    # Windows venv python.exe is a launcher that can spawn its interpreter before
    # job admission. Start the real interpreter and explicitly use this venv's
    # trusted libraries so no descendant can escape the pre-parser handshake.
    interpreter = Path(sys.base_prefix) / Path(sys.executable).name
    worker = Path(__file__).resolve().parents[1] / "xls_worker.py"
    bootstrap = (f"import sys,runpy;sys.path.insert(0,{sysconfig.get_path('purelib')!r});"
                 f"runpy.run_path({str(worker)!r},run_name='__main__')")
    return [str(interpreter), "-I", "-B", "-c", bootstrap]
