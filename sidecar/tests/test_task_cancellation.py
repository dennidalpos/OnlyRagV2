import pytest

from sidecar.services import task_cancellation
from sidecar.services.task_cancellation import TaskCancelled, cancel_task, raise_if_cancelled, register_task, unregister_task


def test_cancellation_requested_before_registration_is_preserved():
    task_id = "test-cancel-before-register"
    cancel_task(task_id)
    register_task(task_id)
    with pytest.raises(TaskCancelled):
        raise_if_cancelled(task_id)
    unregister_task(task_id)


def test_unknown_id_expires_before_registration(monkeypatch):
    clock = [task_cancellation._now()]
    monkeypatch.setattr(task_cancellation, "_now", lambda: clock[0])
    task_id = "test-unknown-cancel-expiry"
    assert cancel_task(task_id)
    clock[0] += task_cancellation.PENDING_CANCEL_TTL_SECONDS + 1
    register_task(task_id)
    raise_if_cancelled(task_id)
    unregister_task(task_id)


def test_repeated_cancellation_stays_effective_until_registration():
    task_id = "test-repeated-cancel"
    assert cancel_task(task_id)
    assert cancel_task(task_id)
    register_task(task_id)
    assert cancel_task(task_id)
    with pytest.raises(TaskCancelled):
        raise_if_cancelled(task_id)
    unregister_task(task_id)


def test_pending_cancellations_have_a_fixed_capacity(monkeypatch):
    monkeypatch.setattr(task_cancellation, "MAX_PENDING_CANCELLATIONS", 2)
    task_ids = ["test-capacity-1", "test-capacity-2", "test-capacity-3"]
    for task_id in task_ids:
        assert cancel_task(task_id)
    register_task(task_ids[0])
    raise_if_cancelled(task_ids[0])
    unregister_task(task_ids[0])
    for task_id in task_ids[1:]:
        register_task(task_id)
        with pytest.raises(TaskCancelled):
            raise_if_cancelled(task_id)
        unregister_task(task_id)
