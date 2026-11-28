"""Private one-request parser. Wait for admission before importing any parser."""
import contextlib
import json
import os
from pathlib import Path
import sys

MAX_OUTPUT_BYTES = 32 * 1024 * 1024


def main():
    request = sys.stdin.buffer.readline(16 * 1024 + 1)
    try:
        if len(request) > 16 * 1024:
            raise ValueError("XLS worker request exceeds its limit.")
        values = json.loads(request)
        if (set(values) != {"path", "rows", "sheets", "full"}
                or not isinstance(values["path"], str) or not Path(values["path"]).is_absolute()
                or type(values["rows"]) is not int or not 1 <= values["rows"] <= 1_048_576
                or type(values["sheets"]) is not int or not 1 <= values["sheets"] <= 1_000
                or type(values["full"]) is not bool):
            raise ValueError("Invalid XLS worker request.")
        # -I omits the repository from sys.path in development. The packaged entry
        # point resolves the same namespace before calling this function.
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        with open(os.devnull, "w") as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
            from sidecar.domain.xls_reader import extract_xls_document
            pages = extract_xls_document(values["path"], values["rows"], values["sheets"], values["full"])
            encoded = json.dumps({"ok": True, "pages": pages}, ensure_ascii=False).encode("utf-8")
            if len(encoded) > MAX_OUTPUT_BYTES:
                raise ValueError("XLS extraction exceeds the 32 MiB worker output limit; export as CSV or XLSX.")
    except MemoryError:
        encoded = b'{"ok":false,"error":"XLS parser exceeded its 512 MiB memory budget; export as CSV or XLSX."}'
    except ImportError as error:
        encoded = json.dumps({"ok": False, "dependency": True, "error": str(error)[:500]}).encode("utf-8")
    except Exception as error:
        encoded = json.dumps({"ok": False, "error": f"XLS parser refused the workbook: {str(error)[:500]}"}).encode("utf-8")
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
