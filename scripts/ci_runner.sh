#!/usr/bin/env bash
# Strict Fail-Fast Mode:
# -e: exit immediately if any command exits with a non-zero status
# -u: treat unset variables as an error when substituting
# -o pipefail: the return value of a pipeline is the status of the last command to exit with a non-zero status
set -euo pipefail

trap 'echo "[ERROR] CI execution failed at line $LINENO" >&2; exit 1' ERR

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
if [ -x "$ROOT_DIR/.venv/bin/python" ]; then
    VENV_PYTHON="$ROOT_DIR/.venv/bin/python"
elif [ -x "$ROOT_DIR/.venv/Scripts/python.exe" ]; then
    VENV_PYTHON="$ROOT_DIR/.venv/Scripts/python.exe"
else
    VENV_PYTHON=""
fi
if [ -z "$VENV_PYTHON" ]; then
    echo "[ERROR] Python virtualenv not found: $VENV_PYTHON. Run npm run setup:dev first." >&2
    exit 1
fi

for required_command in node npm; do
    command -v "$required_command" >/dev/null 2>&1 || {
        echo "[ERROR] Required command not found: $required_command" >&2
        exit 1
    }
done

if [ ! -d "sidecar" ]; then
    echo "[ERROR] Required directory not found: sidecar" >&2
    exit 1
fi

echo "====================================================="
echo " OnlyRag V2 - CI/CD Script Verification Runner"
echo "====================================================="

echo "[1/3] Running TypeScript Typecheck..."
npm run typecheck

echo "[2/3] Running Vitest Unit Tests..."
npm run test:fast

echo "[3/3] Running Python Sidecar Syntax Check..."
find sidecar -name "*.py" -exec "$VENV_PYTHON" -m py_compile {} +
echo "[PASS] Python sidecar syntax clean."

echo "====================================================="
echo " ALL CI CHECKS PASSED SUCCESSFULLY!"
echo "====================================================="
exit 0
