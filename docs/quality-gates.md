# Quality gates

This page is the authoritative source for local and CI quality checks.

## Current gates

| Area | Command or configuration | Enforcement |
| --- | --- | --- |
| Type-check | `npm run typecheck` | TypeScript strict mode, no emit, unused locals rejected |
| Diff whitespace | `npm run format:check` | `git diff --check HEAD` for the current working tree |
| Documentation | `npm run docs:check` | Local Markdown links and documented `npm run` commands |
| Fast tests | `npm run test:fast` | Vitest serial run used by the local composite gate |
| Coverage | `npm run test:coverage` | V8 thresholds: statements 45%, branches 40%, functions 35%, lines 45% |
| Bundle smoke | `npm run test:smoke` | Vite bundle plus Electron main-process startup marker |
| Sidecar syntax/health | `npm run test:sidecar` | Python sidecar health checks and syntax validation |

`npm run lint` is the repository's fast composite quality script. It runs the diff check,
documentation validation, JSON validation, type-check, Python compilation, fast tests and
the Electron smoke test. There is currently no ESLint, Prettier or equivalent source linter
configured. Therefore `format:check` does not prove that committed files follow a complete
formatting policy; it only rejects whitespace errors in the current Git diff.

## Reproducible policy

- Pull requests and pushes run `npm ci`, `npm run lint`, `npm run test:coverage` and
  `npm run test:sidecar` on the pinned Node and Python versions in `.github/workflows/ci.yml`.
- The fast gate is fail-fast and serial to keep Electron, filesystem and sidecar fixtures
  deterministic.
- Coverage thresholds are aggregate guardrails, not per-file targets. Raise them only with
  corresponding tests and a measured baseline.
- A real source linter/formatter should be added as a separate, dependency-reviewed change;
  until then, do not describe the current composite gate as ESLint or Prettier enforcement.

## Recommended follow-up

Select one formatter/linter, pin it in `devDependencies`, add its configuration and lockfile
entry, then add an explicit CI step. The change should include a baseline decision for legacy
files and a deliberate failed-case check so the new gate is demonstrably active.
