"""Generate the checked-in REST contract from the FastAPI application."""

from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sidecar.main import app  # noqa: E402


def main() -> None:
    output = ROOT / "sidecar" / "contracts" / "openapi-2.3.0.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(app.openapi(), indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"Generated {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
