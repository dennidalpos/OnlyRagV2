import io
import sys
from pathlib import Path

import pandas as pd
import pytest
from openpyxl import Workbook

from sidecar.domain.ingestion import extract_document_markdown
from _stream import done_payload, read_events


FIXTURES = Path(__file__).parent / "fixtures"


def workbook_bytes(rows, extra_sheets=()):
    book = Workbook()
    for row in rows:
        book.active.append(row)
    for name, sheet_rows in extra_sheets:
        sheet = book.create_sheet(name)
        for row in sheet_rows:
            sheet.append(row)
    output = io.BytesIO()
    book.save(output)
    book.close()
    return output.getvalue()


@pytest.fixture(params=["xlsx", "xls"])
def excel_source(request, tmp_path):
    path = tmp_path / f"cells.{request.param}"
    if request.param == "xlsx":
        content = workbook_bytes([
            ["Code", "Amount", "Note"],
            ["00123", 42.5, "NA"],
            ["AB123", 0, "ultimo valore"],
        ], [("Second", [["Final cell 9988"]])])
        expected = ["00123", "42.5", "NA", "AB123", "ultimo valore", "Final cell 9988"]
    else:
        content = (FIXTURES / "ragged.xls").read_bytes()
        expected = ["| a", "| d", "| f", "| g", "| k", "| j", "| l"]
    path.write_bytes(content)
    return path, expected


@pytest.mark.parametrize("from_disk", [False, True])
def test_excel_retains_cells(excel_source, from_disk):
    path, expected = excel_source
    original = path.read_bytes()
    markdown, pages = extract_document_markdown(
        path.name, original if not from_disk else b"", str(path) if from_disk else None,
    )
    assert pages == 1
    for value in expected:
        assert value in markdown
    assert path.read_bytes() == original


@pytest.mark.parametrize("rows", [[], [["   ", "\t"]]])
def test_excel_rejects_empty_cells(rows):
    with pytest.raises(ValueError, match="no readable cells"):
        extract_document_markdown("empty.xlsx", workbook_bytes(rows))


def test_excel_preserves_a_single_source_cell():
    markdown, _ = extract_document_markdown("single.xlsx", workbook_bytes([["AB123"]]))
    assert "AB123" in markdown


def test_excel_rejects_an_empty_selected_row_range():
    with pytest.raises(ValueError, match="no readable cells"):
        extract_document_markdown(
            "limited.xlsx", workbook_bytes([["   "], ["AB123"]]), max_excel_rows=1,
        )


def test_excel_reports_sheet_and_row_limits():
    content = workbook_bytes([["first"], ["second"], ["third"]], [("Other", [["hidden"]])])
    markdown, _ = extract_document_markdown(
        "limited.xlsx", content, max_excel_rows=2, max_sheets=1,
    )
    assert "first" in markdown and "second" in markdown
    assert "third" not in markdown and "hidden" not in markdown
    assert "su 3 totali" in markdown and "fogli su 2 totali" in markdown


@pytest.mark.parametrize("extension,engine", [("xlsx", "openpyxl"), ("xls", "xlrd")])
def test_excel_missing_engine_is_an_error(monkeypatch, extension, engine):
    content = workbook_bytes([["AB123"]]) if extension == "xlsx" else (FIXTURES / "ragged.xls").read_bytes()
    monkeypatch.setitem(sys.modules, engine, None)
    with pytest.raises(ImportError, match=engine):
        extract_document_markdown(f"missing.{extension}", content)


def test_excel_stream_retains_cells(sidecar_http_client, excel_source):
    path, expected = excel_source
    original = path.read_bytes()
    payload = done_payload(sidecar_http_client.post("/ingest-path-stream", json={"file_path": str(path)}))
    assert payload["num_chunks"] > 0
    for value in expected:
        assert value in payload["extracted_markdown"]
    assert path.read_bytes() == original
    assert sidecar_http_client.delete(f"/documents/{payload['id']}").status_code == 200
    assert path.read_bytes() == original


@pytest.mark.parametrize("name,content", [
    ("corrupt.xlsx", b"not an Excel workbook"),
    ("corrupt.xls", b"not an Excel workbook"),
    ("empty.xlsx", workbook_bytes([])),
    ("empty.xls", b""),
])
def test_excel_stream_failure_cannot_index(sidecar_http_client, tmp_path, name, content):
    path = tmp_path / name
    path.write_bytes(content)
    before = sidecar_http_client.get("/health").json()
    events = read_events(sidecar_http_client.post("/ingest-path-stream", json={"file_path": str(path)}))
    assert events[-1]["type"] == "error"
    assert events[-1]["error"]
    assert not any(event["type"] == "done" for event in events)
    assert not any(event.get("step_code") == "embedding" for event in events)
    after = sidecar_http_client.get("/health").json()
    assert after["documents_count"] == before["documents_count"]
    assert after["chunks_count"] == before["chunks_count"]
    assert path.read_bytes() == content


def parquet_bytes(data):
    output = io.BytesIO()
    pd.DataFrame(data).to_parquet(output, engine="pyarrow", index=False)
    return output.getvalue()


@pytest.mark.parametrize("from_disk", [False, True])
def test_parquet_retains_values(tmp_path, from_disk):
    content = parquet_bytes({"code": ["00123", "AB123"], "amount": [42.5, 0], "note": ["NA", "ultimo valore"]})
    path = tmp_path / "cells.parquet"
    path.write_bytes(content)
    markdown, pages = extract_document_markdown(
        path.name, content if not from_disk else b"", str(path) if from_disk else None,
    )
    assert pages == 1
    for value in ("code", "amount", "note", "00123", "AB123", "42.5", "NA", "ultimo valore"):
        assert value in markdown
    assert path.read_bytes() == content


def test_parquet_reports_row_limit():
    content = parquet_bytes({"code": ["first", "second", "third"]})
    markdown, _ = extract_document_markdown("limited.parquet", content, max_tabular_rows=2)
    assert "first" in markdown and "second" in markdown
    assert "third" not in markdown and "su 3 totali" in markdown


def test_parquet_rejects_an_empty_selected_row_range():
    with pytest.raises(ValueError, match="no readable values"):
        extract_document_markdown(
            "limited.parquet", parquet_bytes({"code": [None, "AB123"]}), max_tabular_rows=1,
        )


@pytest.mark.parametrize("data", [{"code": []}, {"code": [None]}, {"code": ["   "]}])
def test_parquet_rejects_empty_values(data):
    with pytest.raises(ValueError, match="no readable values"):
        extract_document_markdown("empty.parquet", parquet_bytes(data))


def test_parquet_missing_engine_is_an_error(monkeypatch):
    content = parquet_bytes({"code": ["AB123"]})
    monkeypatch.setitem(sys.modules, "pyarrow", None)
    with pytest.raises(ImportError, match="pyarrow"):
        extract_document_markdown("missing.parquet", content)


def test_parquet_stream_retains_values(sidecar_http_client, tmp_path):
    content = parquet_bytes({"code": ["00123", "AB123"], "amount": [42.5, 0], "note": ["NA", "ultimo valore"]})
    path = tmp_path / "cells.parquet"
    path.write_bytes(content)
    payload = done_payload(sidecar_http_client.post("/ingest-path-stream", json={"file_path": str(path)}))
    assert payload["num_chunks"] > 0
    for value in ("00123", "AB123", "42.5", "NA", "ultimo valore"):
        assert value in payload["extracted_markdown"]
    assert path.read_bytes() == content
    assert sidecar_http_client.delete(f"/documents/{payload['id']}").status_code == 200
    assert path.read_bytes() == content


@pytest.mark.parametrize("content", [b"not Parquet", b"", parquet_bytes({"code": []})])
def test_parquet_stream_failure_cannot_index(sidecar_http_client, tmp_path, content):
    path = tmp_path / "invalid.parquet"
    path.write_bytes(content)
    before = sidecar_http_client.get("/health").json()
    events = read_events(sidecar_http_client.post("/ingest-path-stream", json={"file_path": str(path)}))
    assert events[-1]["type"] == "error" and events[-1]["error"]
    assert not any(event["type"] == "done" for event in events)
    assert not any(event.get("step_code") == "embedding" for event in events)
    after = sidecar_http_client.get("/health").json()
    assert after["documents_count"] == before["documents_count"]
    assert after["chunks_count"] == before["chunks_count"]
    assert path.read_bytes() == content
