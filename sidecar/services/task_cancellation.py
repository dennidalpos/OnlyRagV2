import threading
from typing import Dict


class TaskCancelled(Exception):
    pass


_lock = threading.Lock()
_tasks: Dict[str, threading.Event] = {}


def register_task(task_id: str) -> None:
    with _lock:
        _tasks.setdefault(task_id, threading.Event())


def cancel_task(task_id: str) -> bool:
    with _lock:
        event = _tasks.setdefault(task_id, threading.Event())
        event.set()
        return True


def raise_if_cancelled(task_id: str | None) -> None:
    if not task_id:
        return
    with _lock:
        cancelled = _tasks.get(task_id, threading.Event()).is_set()
    if cancelled:
        raise TaskCancelled(f"Task {task_id} cancelled")


def unregister_task(task_id: str | None) -> None:
    if not task_id:
        return
    with _lock:
        _tasks.pop(task_id, None)
