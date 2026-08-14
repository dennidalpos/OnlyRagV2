---
name: code-quality-and-linting
description: Automated code quality, strict serial execution workflows, type checking, Vitest/Pytest test suites, and PowerShell/Bash linting standards for OnlyRag V2.
---

# Code Quality & Serial Execution Guidelines

## 1. Strict Serial Execution Rule
- ALL builds, tests, type checks, and linting processes MUST execute strictly one by one (serially).
- Concurrent or parallel execution is strictly forbidden to prevent state conflicts, test flakiness, and context waste.

## 2. Type Checking & Verification
- Execute `npm run typecheck` (`tsc --noEmit`) before proposing or committing code changes.
- Ensure strict TypeScript configuration (`tsconfig.json`) without any unused variables or unhandled `any` types.

## 3. Fast Test Automation & Verification
- **Vitest Unit Test Suite**: Run `npm run test:fast` (dot reporter output, <1s execution time) or `npm run test:unit`.
- **Python Sidecar Pytest Suite**: Run `npm run test:sidecar` or `.venv\Scripts\pytest.exe sidecar/tests/test_sidecar.py -v`.

## 4. PowerShell Utility & Test Scripts
- All build and quality scripts MUST reside in `scripts/`.
  - `scripts/lint_format.ps1`: Validates TypeScript type safety and Python sidecar syntax (supports `-Fast` and `-Full` modes).
  - `scripts/test_sidecar_health.ps1`: Tests sidecar FastAPI endpoints, export compilation, and LanceDB vector DB search (supports `-Fast` and `-Full` modes).
  - `scripts/build_package.ps1`: Compiles Vite/Electron assets, PyInstaller sidecar, and generates NSIS installer.
  - `scripts/clean_workspace.ps1`: Cleans build artifacts (`Repo`), local AppData LanceDB/logs (`UserData`), or full factory reset (`Full`).
  - `scripts/ci_runner.sh`: Cross-platform Bash script with `set -euo pipefail` Fail-Fast enforcement.
- Scripts must handle UTF-8 encoding explicitly and set `$ErrorActionPreference = "Stop"`.
- Provide concise `PASS/FAIL` output for agent execution.
