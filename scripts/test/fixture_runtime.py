"""Retained synthetic test storage. No automatic removal or relocation of existing data."""
import json
import os
from pathlib import Path
import re
import socket
import tempfile
import uuid

REPOSITORY = Path(__file__).resolve().parents[2]
HOST = re.sub(r"[^a-zA-Z0-9_-]", "_", socket.gethostname())
RUN = f"{os.getpid()}-{uuid.uuid4().hex[:12]}"
PARENT = REPOSITORY / "test-results" / "fixtures" / HOST / RUN
os.environ["GIT_CEILING_DIRECTORIES"] = os.pathsep.join(dict.fromkeys([
    *filter(None, os.environ.get("GIT_CEILING_DIRECTORIES", "").split(os.pathsep)),
    str(REPOSITORY / "test-results" / "fixtures"),
]))


def plain_ancestors(directory):
    for current in (directory, *directory.parents):
        if current.is_symlink() or (current.exists() and current.resolve() != current):
            raise ValueError(f"Fixture path must have plain ancestors: {current}")


def create_fixture_directory(prefix):
    if not prefix or prefix in (".", "..") or re.search(r'[\x00-\x1f/\\<>:"|?*]', prefix):
        raise ValueError("Invalid fixture prefix")
    plain_ancestors(PARENT)
    registry = PARENT / "manifests"
    registry.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix=prefix, dir=PARENT))
    manifest = dict(schemaVersion=1, repository=str(REPOSITORY), host=HOST, run=RUN,
                    processId=os.getpid(), directory=str(directory),
                    retention="until-explicit-cleanup", status="created")
    (registry / f"{directory.name}.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return directory


def retain_fixture(directory):
    directory = Path(directory).absolute()
    root = REPOSITORY / "test-results" / "fixtures"
    relative = directory.relative_to(root)
    if len(relative.parts) != 3 or ".." in relative.parts:
        raise ValueError(f"Not an owned fixture: {directory}")
    plain_ancestors(directory)
    manifest_path = directory.parent / "manifests" / f"{directory.name}.json"
    plain_ancestors(manifest_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if (manifest.get("schemaVersion") != 1 or manifest.get("directory") != str(directory)
            or manifest.get("repository") != str(REPOSITORY)
            or manifest.get("retention") != "until-explicit-cleanup"):
        raise ValueError(f"Invalid fixture ownership: {directory}")
    manifest["status"] = "retained" if directory.exists() else "removed-by-scenario"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
