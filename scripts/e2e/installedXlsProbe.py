"""Owned installed-XLS fixtures, Win32 observation/faults and logical index readback. No models."""
import argparse
import ctypes
from ctypes import wintypes as w
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import struct
import sys
import time

ROOT = Path(__file__).resolve().parents[2]


def save(file, value):
    with file.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())


def fixtures(root):
    sys.path.insert(0, str(ROOT / 'sidecar/tests'))
    from _xls_fixtures import write_numeric_xls, write_string_xls, write_shared_strings_xls, record, _bof
    output = root / 'inputs'
    output.mkdir()
    (output / 'keep.md').write_text('# Existing fixture\nPreserve these acknowledged original words and index vectors.\n', encoding='utf-8')
    write_numeric_xls(output / 'small.xls')
    write_numeric_xls(output / 'dense.xls', rows=65_536, columns=256)
    write_numeric_xls(output / 'sparse.xls', rows=65_536, columns=256, sparse=True)
    write_string_xls(output / 'strings.xls', sheets=12)
    write_shared_strings_xls(output / 'shared.xls')
    # 10 * 150 * 128 retained cells, each 256 characters: real output exceeds 32 MiB.
    names = [f'Overflow{i}'.encode('ascii') for i in range(10)]
    prefix = _bof(5) + record(0x0042, struct.pack('<H', 1200)) + record(0x00E0, b'\0' * 20)
    header = _bof(0x0010) + record(0x0200, struct.pack('<IIHHH', 0, 150, 0, 128, 0))
    text = b'x' * 256
    sheet_size = len(header) + 150 * 128 * (13 + len(text)) + 4
    offset = len(prefix) + sum(12 + len(name) for name in names) + 4
    with (output / 'overflow.xls').open('xb') as stream:
        stream.write(prefix)
        for name in names:
            stream.write(record(0x0085, struct.pack('<IBBB', offset, 0, 0, len(name)) + b'\0' + name))
            offset += sheet_size
        stream.write(record(0x000A))
        for _ in names:
            stream.write(header)
            for row in range(150):
                for column in range(128):
                    stream.write(record(0x0204, struct.pack('<HHHHB', row, column, 0, len(text), 0) + text))
            stream.write(record(0x000A))
    hashes = []
    for file in output.iterdir():
        with file.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        hashes.append({'name': file.name, 'bytes': file.stat().st_size, 'sha256': digest})
    save(root / 'fixtures.json', hashes)


def snapshot(root, label):
    import lancedb
    store = root / 'profile/data/lancedb_store'
    assert store.is_dir()
    connection = lancedb.connect(str(store))
    tables = connection.list_tables().tables
    result = {name: sorted(connection.open_table(name).to_arrow().to_pylist(), key=lambda row: json.dumps(row, sort_keys=True)) for name in tables}
    save(root / f'index-{label}.json', result)


class ProcessEntry(ctypes.Structure):
    _fields_ = [('size', w.DWORD), ('usage', w.DWORD), ('pid', w.DWORD), ('heap', ctypes.c_size_t),
                ('module', w.DWORD), ('threads', w.DWORD), ('parent', w.DWORD), ('priority', w.LONG),
                ('flags', w.DWORD), ('exe', w.WCHAR * 260)]


class ThreadEntry(ctypes.Structure):
    _fields_ = [('size', w.DWORD), ('usage', w.DWORD), ('tid', w.DWORD), ('owner', w.DWORD),
                ('base', w.LONG), ('delta', w.LONG), ('flags', w.DWORD)]


class Memory(ctypes.Structure):
    _fields_ = [('size', w.DWORD), ('faults', w.DWORD)] + [(name, ctypes.c_size_t) for name in
                ('peak_ws', 'ws', 'peak_paged', 'paged', 'peak_nonpaged', 'nonpaged', 'commit', 'peak_commit')]


class Limits(ctypes.Structure):
    _fields_ = [('user_time', ctypes.c_longlong), ('job_time', ctypes.c_longlong), ('flags', w.DWORD),
                ('min_ws', ctypes.c_size_t), ('max_ws', ctypes.c_size_t), ('active', w.DWORD),
                ('affinity', ctypes.c_size_t), ('priority', w.DWORD), ('scheduling', w.DWORD)]


def observe(root, label, owner_pid, executable, action):
    api = ctypes.WinDLL('kernel32', use_last_error=True)
    psapi = ctypes.WinDLL('psapi', use_last_error=True)
    signatures = {
        'CreateToolhelp32Snapshot': ([w.DWORD, w.DWORD], w.HANDLE),
        'Process32FirstW': ([w.HANDLE, ctypes.POINTER(ProcessEntry)], w.BOOL),
        'Process32NextW': ([w.HANDLE, ctypes.POINTER(ProcessEntry)], w.BOOL),
        'Thread32First': ([w.HANDLE, ctypes.POINTER(ThreadEntry)], w.BOOL),
        'Thread32Next': ([w.HANDLE, ctypes.POINTER(ThreadEntry)], w.BOOL),
        'OpenProcess': ([w.DWORD, w.BOOL, w.DWORD], w.HANDLE),
        'OpenThread': ([w.DWORD, w.BOOL, w.DWORD], w.HANDLE),
        'GetProcessIdOfThread': ([w.HANDLE], w.DWORD),
        'SuspendThread': ([w.HANDLE], w.DWORD), 'ResumeThread': ([w.HANDLE], w.DWORD),
        'QueryFullProcessImageNameW': ([w.HANDLE, w.DWORD, w.LPWSTR, ctypes.POINTER(w.DWORD)], w.BOOL),
        'IsProcessInJob': ([w.HANDLE, w.HANDLE, ctypes.POINTER(w.BOOL)], w.BOOL),
        'TerminateProcess': ([w.HANDLE, w.UINT], w.BOOL),
        'WaitForSingleObject': ([w.HANDLE, w.DWORD], w.DWORD), 'CloseHandle': ([w.HANDLE], w.BOOL),
        'GetProcessTimes': ([w.HANDLE, ctypes.POINTER(w.FILETIME), ctypes.POINTER(w.FILETIME), ctypes.POINTER(w.FILETIME), ctypes.POINTER(w.FILETIME)], w.BOOL),
        'CreateJobObjectW': ([ctypes.c_void_p, w.LPCWSTR], w.HANDLE),
        'SetInformationJobObject': ([w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD], w.BOOL),
        'AssignProcessToJobObject': ([w.HANDLE, w.HANDLE], w.BOOL),
    }
    for name, (arguments, result) in signatures.items():
        getattr(api, name).argtypes, getattr(api, name).restype = arguments, result
    psapi.GetProcessMemoryInfo.argtypes = [w.HANDLE, ctypes.POINTER(Memory), w.DWORD]
    psapi.GetProcessMemoryInfo.restype = w.BOOL

    def require(value):
        if not value:
            raise ctypes.WinError(ctypes.get_last_error())
        return value

    def open_owned(pid):
        handle = require(api.OpenProcess(0x00100000 | 0x400 | 0x10 | 0x100 | 0x1, False, pid))
        image, size = ctypes.create_unicode_buffer(32768), w.DWORD(32768)
        try:
            require(api.QueryFullProcessImageNameW(handle, 0, image, ctypes.byref(size)))
            assert Path(image.value).resolve() == executable, 'Refuse a foreign process image'
            assert api.WaitForSingleObject(handle, 0) == 258, 'Owned process already exited'
            return handle
        except BaseException:
            api.CloseHandle(handle)
            raise

    def entries(flag, structure, first, following):
        handle = api.CreateToolhelp32Snapshot(flag, 0)
        assert handle not in (None, ctypes.c_void_p(-1).value)
        try:
            entry = structure()
            entry.size = ctypes.sizeof(entry)
            success = first(handle, ctypes.byref(entry))
            while success:
                yield structure.from_buffer_copy(entry)
                success = following(handle, ctypes.byref(entry))
        finally:
            api.CloseHandle(handle)

    owner = open_owned(owner_pid)
    marker = json.loads((root / 'profile/sidecar-ownership.json').read_text(encoding='utf-8'))
    assert marker['pid'] == owner_pid and Path(marker['executablePath']).resolve() == executable
    created, exited, kernel, user = w.FILETIME(), w.FILETIME(), w.FILETIME(), w.FILETIME()
    require(api.GetProcessTimes(owner, ctypes.byref(created), ctypes.byref(exited), ctypes.byref(kernel), ctypes.byref(user)))
    created_epoch = ((created.dwHighDateTime << 32) | created.dwLowDateTime) / 10_000_000 - 11_644_473_600
    assert abs(created_epoch - datetime.fromisoformat(marker['startedAt']).timestamp()) < 0.001, 'Refuse a reused owner PID'
    workers, suspended = {}, []
    test_job = None
    result = {'label': label, 'action': action, 'ownerPid': owner_pid, 'executable': str(executable), 'workers': []}
    started = time.monotonic()
    try:
        if action == 'admission-refusal':
            test_job = require(api.CreateJobObjectW(None, None))
            limits = Limits()
            limits.flags, limits.active = 0x8, 1  # One owner, no room to create the parser.
            require(api.SetInformationJobObject(test_job, 2, ctypes.byref(limits), ctypes.sizeof(limits)))
            require(api.AssignProcessToJobObject(test_job, owner))
            result['ownerActiveProcessLimit'] = 1
        save(root / f'{label}.ready.json', {'pid': os.getpid(), 'ownerPid': owner_pid, 'action': action})
        while not (root / f'{label}.stop').exists():
            assert time.monotonic() - started < 100, 'Observer deadline exceeded'
            for entry in entries(0x2, ProcessEntry, api.Process32FirstW, api.Process32NextW):
                if entry.parent != owner_pid or entry.exe.lower() != 'sidecar.exe' or entry.pid in workers:
                    continue
                try:
                    handle = open_owned(entry.pid)
                except (OSError, AssertionError):
                    continue
                # The held process handle pins identity; recheck its parent after opening it.
                if not any(item.pid == entry.pid and item.parent == owner_pid for item in entries(0x2, ProcessEntry, api.Process32FirstW, api.Process32NextW)):
                    api.CloseHandle(handle)
                    continue
                workers[entry.pid] = {'handle': handle, 'pid': entry.pid, 'parent': entry.parent, 'peakCommitBytes': 0, 'inJob': False}
            for worker in workers.values():
                if api.WaitForSingleObject(worker['handle'], 0) == 0:
                    worker['exited'] = True
                    continue
                memory = Memory()
                memory.size = ctypes.sizeof(memory)
                if psapi.GetProcessMemoryInfo(worker['handle'], ctypes.byref(memory), ctypes.sizeof(memory)):
                    worker['peakCommitBytes'] = max(worker['peakCommitBytes'], memory.peak_commit)
                in_job = w.BOOL()
                require(api.IsProcessInJob(worker['handle'], None, ctypes.byref(in_job)))
                worker['inJob'] = worker['inJob'] or bool(in_job.value)
                if action in ('timeout', 'owner-crash') and in_job.value and not suspended:
                    # Fault only verified threads of the held, owned parser process.
                    for thread in entries(0x4, ThreadEntry, api.Thread32First, api.Thread32Next):
                        if thread.owner != worker['pid']:
                            continue
                        thread_handle = api.OpenThread(0x2 | 0x40, False, thread.tid)
                        if not thread_handle:
                            continue
                        if api.GetProcessIdOfThread(thread_handle) != worker['pid']:
                            api.CloseHandle(thread_handle)
                            continue
                        previous = api.SuspendThread(thread_handle)
                        if previous == 0xFFFFFFFF:
                            api.CloseHandle(thread_handle)
                            continue
                        suspended.append(thread_handle)
                    assert suspended, 'No owned parser thread suspended'
                    result['suspendedThreads'] = len(suspended)
                    save(root / f'{label}.suspended.json', {'workerPid': worker['pid'], 'ownerPid': owner_pid, 'inJob': True, 'threads': len(suspended)})
                    if action == 'owner-crash':
                        require(api.TerminateProcess(owner, 71))
                        assert api.WaitForSingleObject(owner, 5000) == 0
                        assert api.WaitForSingleObject(worker['handle'], 5000) == 0, 'Parser survived owner job closure'
                        result['workerExitedWithinFiveSecondsOfOwner'] = True
            time.sleep(0.005)
        for worker in workers.values():
            worker['exited'] = api.WaitForSingleObject(worker['handle'], 5000) == 0
            assert worker['exited'], 'Owned parser remains alive'
            assert worker['peakCommitBytes'] <= 512 * 1024 * 1024
        if action in ('timeout', 'owner-crash'):
            assert suspended
        result['workers'] = [{key: value for key, value in worker.items() if key != 'handle'} for worker in workers.values()]
        result['elapsedSeconds'] = time.monotonic() - started
        result['passed'] = True
    except BaseException as error:
        result.update(passed=False, error=repr(error))
        raise
    finally:
        if test_job:
            limits = Limits()  # Remove our external creation cap; product jobs are untouched.
            api.SetInformationJobObject(test_job, 2, ctypes.byref(limits), ctypes.sizeof(limits))
            api.CloseHandle(test_job)
        for handle in suspended:
            api.ResumeThread(handle)
            api.CloseHandle(handle)
        for worker in workers.values():
            api.CloseHandle(worker['handle'])
        api.CloseHandle(owner)
        save(root / f'observe-{label}.json', result)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['fixtures', 'snapshot', 'observe'])
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--label', default='')
    parser.add_argument('--sidecar-pid', type=int)
    parser.add_argument('--exe', type=Path)
    parser.add_argument('--action', choices=['monitor', 'timeout', 'owner-crash', 'admission-refusal'], default='monitor')
    args = parser.parse_args()
    root = args.root.resolve()
    assert root.is_relative_to(Path.home() / 'OnlyRag-Live') and root.is_dir()
    assert not args.label or args.label.replace('-', '').isalnum()
    if args.mode == 'fixtures':
        fixtures(root)
    elif args.mode == 'snapshot':
        snapshot(root, args.label)
    else:
        assert args.sidecar_pid and args.exe
        observe(root, args.label, args.sidecar_pid, args.exe.resolve(), args.action)
