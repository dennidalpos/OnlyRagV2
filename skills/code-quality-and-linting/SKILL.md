---
name: code-quality-and-linting
description: Automated code quality, strict serial execution workflows, TypeScript strict checking, Vitest/Pytest test suites, and PowerShell automation standards for OnlyRag V2.
---

# Code Quality & Serial Execution Guidelines

## 1. Strict Serial Execution Standard
- **Zero Concurrency**: ALL builds, tests, type checks, and linting processes MUST execute strictly one by one in serial order.
- Concurrent or parallel execution is strictly forbidden to prevent database locking, race conditions, test flakiness, and token waste.

## 2. Type Checking & TypeScript Compilation
- Run `npm run typecheck` (`tsc --noEmit`) before proposing or committing code changes.
- Ensure strict TypeScript compliance (`tsconfig.json`) without unused variables, implicit `any`, or unhandled promise rejections.

## 3. Fast Automated Testing
- **Vitest Unit & Integration Suite**: Run `npm run test:fast` (dot reporter, fast output) or `npm run test` (full report).
- **Python Sidecar Test Suite**: Run `npm run test:sidecar` or execute `.venv\Scripts\pytest.exe sidecar/tests/test_sidecar.py -q`.
- **Honesty Principle**: NEVER claim checks or tests were run if they were skipped. All reported test results must reflect real terminal executions.

## 4. PowerShell Utility & Automation Scripts
- Scripts reside in `scripts/`, enforce `$ErrorActionPreference = "Stop"`, and output UTF-8 encoding:
  - `scripts/lint_format.ps1`: Validates TypeScript type safety, runs Vitest fast suite, and checks Python sidecar syntax (supports `-Fast`, `-Full`, and `-Format` parameters).
  - `scripts/test_sidecar_health.ps1`: Tests sidecar FastAPI health, markdown export, LanceDB vector search, and Pytest test suite (supports `-Fast` and `-Full` modes).
  - `scripts/clean_workspace.ps1`: Cleans build artifacts (`Repo`), local AppData LanceDB/logs (`UserData`), or full factory reset (`Full`).
  - `scripts/build_package.ps1`: Compiles Vite/Electron assets, PyInstaller sidecar executable, and generates the NSIS production installer.
  - `scripts/ci_runner.sh`: Cross-platform Bash script with `set -euo pipefail` Fail-Fast enforcement.
- Provide concise, structured `PASS/FAIL` output for agent execution.
