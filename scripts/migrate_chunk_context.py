"""Refuse the retired in-place chunk-context migration without opening storage."""

import sys


def main() -> int:
    print(
        "Retired: chunk-context migration cannot preserve versioned encoder provenance. "
        "No storage was opened or changed. Preserve the existing index and originals. "
        "RAG-EMBEDDING-REBUILD-01 remains deferred pending explicit approval; "
        "no replacement migration is available.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
