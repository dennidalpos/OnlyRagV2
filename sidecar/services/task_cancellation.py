import threading
import time
from collections import OrderedDict
from typing import Dict


class TaskCancelled(Exception):
    pass


_lock = threading.Lock()
_tasks: Dict[str, threading.Event] = {}
_pending_cancellations: OrderedDict[str, float] = OrderedDict()
PENDING_CANCEL_TTL_SECONDS = 300
MAX_PENDING_CANCELLATIONS = 1024


def _now() -> float:
    return time.monotonic()


def _prune_pending(now: float) -> None:
    while _pending_cancellations:
        first_id, expires_at = next(iter(_pending_cancellations.items()))
        if expires_at > now:
            break
        del _pending_cancellations[first_id]


def register_task(task_id: str) -> None:
    with _lock:
        _prune_pending(_now())
        event = _tasks.setdefault(task_id, threading.Event())
        if _pending_cancellations.pop(task_id, None) is not None:
            event.set()


def cancel_task(task_id: str) -> bool:
    with _lock:
        event = _tasks.get(task_id)
        if event is not None:
            event.set()
            return True
        now = _now()
        _prune_pending(now)
        _pending_cancellations[task_id] = now + PENDING_CANCEL_TTL_SECONDS
        _pending_cancellations.move_to_end(task_id)
        if len(_pending_cancellations) > MAX_PENDING_CANCELLATIONS:
            _pending_cancellations.popitem(last=False)
        return True


def raise_if_cancelled(task_id: str | None) -> None:
    if not task_id:
        return
    with _lock:
        event = _tasks.get(task_id)
        cancelled = event is not None and event.is_set()
    if cancelled:
        raise TaskCancelled(f"Task {task_id} cancelled")


def unregister_task(task_id: str | None) -> None:
    if not task_id:
        return
    with _lock:
        _tasks.pop(task_id, None)
        _pending_cancellations.pop(task_id, None)
