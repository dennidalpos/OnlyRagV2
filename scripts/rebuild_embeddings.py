"""Explicit store maintenance; no default user store or automatic migration."""
import argparse
import json
import os
from pathlib import Path
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("preview", "prepare", "activate", "rollback"))
    parser.add_argument("--root", type=Path, required=True, help="Existing absolute application userData root")
    parser.add_argument("--model", help="Explicit installed native embedding model; required for prepare")
    parser.add_argument("--rebuild-id", help="Verified prepare ID; required for activate/rollback")
    args = parser.parse_args()
    if (args.operation == "prepare") != bool(args.model):
        parser.error("--model is required only for prepare")
    if (args.operation in ("activate", "rollback")) != bool(args.rebuild_id):
        parser.error("--rebuild-id is required only for activate/rollback")
    if not args.root.is_absolute() or not args.root.is_dir():
        parser.error("--root must be an existing absolute directory")
    os.environ["ONLYRAG_DATA_DIR"] = str(args.root)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    try:
        from sidecar.services import store_rebuild_service as service
        operation = getattr(service, args.operation)
        extra = [args.model] if args.operation == "prepare" else [args.rebuild_id] if args.rebuild_id else []
        result = operation(args.root, *extra)
        print(json.dumps(result, indent=2, ensure_ascii=True))
        return 0
    except Exception as error:
        print(f"Store maintenance refused: {type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
