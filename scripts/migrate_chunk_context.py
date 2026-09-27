"""Preview or apply the Sidecar chunk-context migration while the app is closed."""

import argparse
import os
from pathlib import Path
import socket
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

if not os.environ.get("ONLYRAG_DATA_DIR"):
    raise SystemExit("Set ONLYRAG_DATA_DIR to the app's userData directory before running this migration")

from sidecar.config import CHUNKS_TABLE_NAME, LANCEDB_DIR  # noqa: E402
from sidecar.infrastructure.db import get_existing_tables, lance_db  # noqa: E402
from sidecar.services.chunk_context_migration import migrate_chunk_context, plan_chunk_context_migration  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate Italian Sidecar chunk context labels to English and re-embed them")
    parser.add_argument("--apply", action="store_true", help="Back up LanceDB and update legacy chunks")
    args = parser.parse_args()

    if CHUNKS_TABLE_NAME not in get_existing_tables():
        print("No chunks table; 0 chunks need migration.")
        return 0

    table = lance_db.open_table(CHUNKS_TABLE_NAME)
    planned = plan_chunk_context_migration(table)
    print(f"Legacy chunks needing migration: {len(planned)}")
    if not args.apply or not planned:
        return 0

    with socket.socket() as probe:
        probe.settimeout(0.5)
        if probe.connect_ex(("127.0.0.1", 8000)) == 0:
            raise RuntimeError("Port 8000 is active; close OnlyRag and the Sidecar before applying the migration")

    count, backup = migrate_chunk_context(table, Path(LANCEDB_DIR))
    print(f"Migrated {count} chunks. Backup: {backup}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
