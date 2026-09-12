import pytest

from sidecar.services.task_cancellation import TaskCancelled, cancel_task, raise_if_cancelled, register_task, unregister_task


def test_cancellation_requested_before_registration_is_preserved():
    task_id = "test-cancel-before-register"
    cancel_task(task_id)
    register_task(task_id)
    with pytest.raises(TaskCancelled):
        raise_if_cancelled(task_id)
    unregister_task(task_id)
