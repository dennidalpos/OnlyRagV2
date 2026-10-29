"""Regression coverage for the non-destructive append path.

The previous recovery branch answered a failed `add` by dropping the table and re-creating it
from the incoming record alone, so a single schema change wiped every document the user had
already indexed. These tests pin the replacement behaviour: on mismatch the stored rows survive
and the caller gets an error.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from sidecar.infrastructure.db import (  # noqa: E402
    SchemaMismatchError,
    append_records,
    get_existing_tables,
    lance_db,
)

TABLE = "append_regression"


def _row(row_id: str, title: str = "first schema"):
    return [{"id": row_id, "title": title, "vector": [0.1, 0.2, 0.3]}]


def _mismatched_row(row_id: str):
    """Same table, structurally different record: extra column and a shorter vector."""
    return [{"id": row_id, "unexpected_column": 7, "vector": [0.1]}]


def test_creates_the_table_on_first_use():
    assert TABLE not in get_existing_tables()
    append_records(TABLE, _row("a"))
    assert TABLE in get_existing_tables()
    assert lance_db.open_table(TABLE).count_rows() == 1


def test_appends_to_an_existing_table_without_replacing_it():
    append_records(TABLE, _row("a"))
    append_records(TABLE, _row("b"))
    append_records(TABLE, _row("c"))
    assert lance_db.open_table(TABLE).count_rows() == 3


def test_schema_mismatch_raises_instead_of_dropping_the_table():
    append_records(TABLE, _row("a"))
    append_records(TABLE, _row("b"))

    with pytest.raises(SchemaMismatchError) as excinfo:
        append_records(TABLE, _mismatched_row("c"))

    assert excinfo.value.table_name == TABLE
    assert TABLE in str(excinfo.value)


def test_rows_already_stored_survive_a_rejected_append():
    append_records(TABLE, _row("a"))
    append_records(TABLE, _row("b"))

    with pytest.raises(SchemaMismatchError):
        append_records(TABLE, _mismatched_row("c"))

    # The corpus is the thing that must not be lost: both original rows are still readable.
    assert TABLE in get_existing_tables()
    rows = lance_db.open_table(TABLE).search().limit(10).to_list()
    assert sorted(r["id"] for r in rows) == ["a", "b"]
    assert all(r["title"] == "first schema" for r in rows)


def test_delete_where_replaces_only_the_targeted_row():
    append_records(TABLE, _row("a"))
    append_records(TABLE, _row("b"))

    append_records(TABLE, _row("b", title="second write"), delete_where='id = "b"')

    rows = lance_db.open_table(TABLE).search().limit(10).to_list()
    assert sorted(r["id"] for r in rows) == ["a", "b"]
    titles = {r["id"]: r["title"] for r in rows}
    assert titles["a"] == "first schema"
    assert titles["b"] == "second write"


def test_maintenance_reports_real_outcome_per_table():
    """Maintenance must not claim success for work it did not do.

    The previous implementation called deprecated APIs that raise without the optional `pylance`
    package, yet still reported every table as successful.
    """
    from sidecar.infrastructure.db import run_db_maintenance

    append_records(TABLE, _row("a"))
    append_records(TABLE, _row("b"))

    result = run_db_maintenance()

    assert result["success"] is True
    entry = next(r for r in result["tables"] if r["table"] == TABLE)
    assert entry["status"] == "success"
    assert entry["optimized"] is True
    # Optimizing must never cost rows.
    assert lance_db.open_table(TABLE).count_rows() == 2


def test_maintenance_flags_failure_instead_of_swallowing_it(monkeypatch):
    import sidecar.infrastructure.db as db_module

    append_records(TABLE, _row("a"))

    def exploding_open_table(name):
        raise RuntimeError("optimize unavailable")

    monkeypatch.setattr(db_module.lance_db, "open_table", exploding_open_table)

    result = db_module.run_db_maintenance()

    assert result["success"] is False
    entry = next(r for r in result["tables"] if r["table"] == TABLE)
    assert entry["status"] == "error"
    assert entry["optimized"] is False
    assert "optimize unavailable" in entry["error"]
