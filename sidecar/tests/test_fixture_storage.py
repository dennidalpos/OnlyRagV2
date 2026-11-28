"""Exercise retained storage with real files and a fresh Python process."""
import json
from pathlib import Path
import subprocess
import sys

import pytest

from scripts.test.fixture_runtime import REPOSITORY, create_fixture_directory, retain_fixture


def test_retention_keeps_bytes_and_rejects_changed_ownership():
    root = create_fixture_directory("python-ownership-")
    evidence = root / "evidence.bin"
    evidence.write_bytes(b"\x00\xff\r\nretained")
    retain_fixture(root)
    manifest = root.parent / "manifests" / f"{root.name}.json"
    original = manifest.read_bytes()
    changed = json.loads(original)
    assert changed["status"] == "retained"
    changed["directory"] = str(REPOSITORY)
    manifest.write_text(json.dumps(changed), encoding="utf-8")
    with pytest.raises(ValueError, match="Invalid fixture ownership"):
        retain_fixture(root)
    assert evidence.read_bytes() == b"\x00\xff\r\nretained"
    manifest.write_bytes(original)
    retain_fixture(root)


def test_subprocess_keeps_its_owned_fixture_after_exit():
    result = subprocess.run([sys.executable, "-c", "from scripts.test.fixture_runtime import create_fixture_directory, retain_fixture; p=create_fixture_directory('python-child-'); (p/'receipt').write_text('child evidence'); retain_fixture(p); print(p)"],
                            cwd=REPOSITORY, capture_output=True, text=True, check=True, timeout=15)
    root = Path(result.stdout.strip())
    assert root.is_relative_to(REPOSITORY / "test-results" / "fixtures")
    assert (root / "receipt").read_text() == "child evidence"
    retain_fixture(root)
