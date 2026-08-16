#!/usr/bin/env bash
# Strict Fail-Fast Mode:
# -e: exit immediately if any command exits with a non-zero status
# -u: treat unset variables as an error when substituting
# -o pipefail: the return value of a pipeline is the status of the last command to exit with a non-zero status
set -euo pipefail

trap 'echo "[ERROR] CI execution failed at line $LINENO" >&2; exit 1' ERR

echo "====================================================="
echo " OnlyRag V2 - CI/CD Script Verification Runner"
echo "====================================================="

echo "[1/3] Running TypeScript Typecheck..."
npm run typecheck

echo "[2/3] Running Vitest Unit Tests..."
npm run test:fast

echo "[3/3] Running Python Sidecar Syntax Check..."
if [ -d "sidecar" ]; then
    find sidecar -name "*.py" -exec python -m py_compile {} +
    echo "[PASS] Python sidecar syntax clean."
else
    echo "[SKIP] sidecar directory not found, skipping syntax check."
fi

echo "====================================================="
echo " ALL CI CHECKS PASSED SUCCESSFULLY!"
echo "====================================================="
exit 0
