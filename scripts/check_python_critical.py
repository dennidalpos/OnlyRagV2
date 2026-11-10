"""Offline behavioral gate for Sidecar admission, retrieval and durable document writes."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
CHECKS = (
    "sidecar/tests/test_document_limits.py::test_native_ingestion_boundaries_include_headings_and_preserve_existing_data",
    "sidecar/tests/test_document_limits.py::test_oversized_original_archive_is_refused_before_chunking_even_with_small_result",
    "sidecar/tests/test_tabular_ingestion.py::test_malformed_csv_never_indexes_partial_content",
    "sidecar/tests/test_embedding_model_consistency.py::test_search_rejects_query_fallback_instead_of_hiding_unavailable_evidence",
    "sidecar/tests/test_lexical_retrieval.py::test_fts_failure_is_not_silently_replaced_by_dense_search",
    "sidecar/tests/test_document_concurrency.py::test_stale_client_revision_is_rejected_before_encoding",
    "sidecar/tests/test_document_recovery.py::test_second_write_failure_rolls_back_both_tables",
    "sidecar/tests/test_document_recovery.py::test_failed_recovery_preserves_journal_and_blocks_access",
)


def validate_report(report: Path) -> int:
    """A successful pytest exit alone also permits all-skipped or filtered runs."""
    cases = ET.parse(report).getroot().findall(".//testcase")
    expected = {node.split("::")[1] for node in CHECKS}
    observed = {case.attrib.get("name", "").split("[")[0] for case in cases}
    if observed != expected or any(case.find(tag) is not None for case in cases for tag in ("failure", "error", "skipped")):
        raise ValueError("Critical Python checks must all run and pass; missing, skipped or unsuccessful cases are refused.")
    return len(cases)


def main() -> int:
    environment = os.environ.copy()
    # This gate always targets source fixtures, never a configured frozen/live server.
    for key in ("PYTEST_ADDOPTS", "PYTEST_PLUGINS", "PYTHONPATH", "ONLYRAG_TABULAR_TEST_URL",
                "ONLYRAG_TABULAR_TEST_TOKEN", "ONLYRAG_SIDECAR_TOKEN"):
        environment.pop(key, None)
    environment.update(PYTEST_DISABLE_PLUGIN_AUTOLOAD="1", PYTHONDONTWRITEBYTECODE="1",
                       OLLAMA_BASE_URL="http://127.0.0.1:1")
    try:
        with tempfile.TemporaryDirectory(prefix="onlyrag-python-critical-") as temporary:
            report = Path(temporary) / "pytest.xml"
            command = [sys.executable, "-m", "pytest", "-c", str(ROOT / "pytest.ini"),
                       "-o", "addopts=", "-p", "no:cacheprovider", "--strict-config", "--strict-markers",
                       "--runxfail", "-q", f"--junitxml={report}",
                       *(str(ROOT / node) for node in CHECKS)]
            result = subprocess.run(command, cwd=temporary, env=environment, timeout=180, check=False)
            if result.returncode:
                return result.returncode
            count = validate_report(report)
            print(f"Python critical gate: {count} cases passed across {len(CHECKS)} required checks.", flush=True)
            return 0
    except (OSError, ValueError, ET.ParseError, subprocess.TimeoutExpired) as error:
        print(f"Python critical gate failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
