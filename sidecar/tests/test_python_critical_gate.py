"""The fail-fast gate must not turn skipped/filtered/error reports into success."""
from xml.etree.ElementTree import Element, SubElement, ElementTree

import pytest

from scripts.check_python_critical import CHECKS, validate_report


def report(tmp_path, change=None):
    suite = Element("testsuite")
    for node in CHECKS:
        case = SubElement(suite, "testcase", name=node.split("::")[1])
        if change in ("skipped", "error", "failure"):
            SubElement(case, change)
            change = None
    if change == "missing":
        suite.remove(suite[0])
    if change == "empty":
        suite.clear()
    path = tmp_path / "report.xml"
    ElementTree(suite).write(path)
    return path


def test_complete_critical_report_is_accepted(tmp_path):
    assert validate_report(report(tmp_path)) == len(CHECKS)


@pytest.mark.parametrize("change", ["skipped", "error", "failure", "missing", "empty"])
def test_incomplete_or_unsuccessful_critical_reports_are_refused(tmp_path, change):
    with pytest.raises(ValueError, match="all run and pass"):
        validate_report(report(tmp_path, change))
