# Local test storage and retention

Build outputs and repository-managed tool caches stay in the product's ignored directories: `dist/`, `dist-electron/`, `build/`, `release/`, `node_modules/`, and the cache directories listed in `.gitignore`. Build and packaging still consume these paths. Package-manager download caches are separate: setup can use npm/pip's normal external caches, and the fixture allocator does not relocate them. This policy does not move existing outputs or personal profiles.

Synthetic Node, Python, PowerShell and Electron fixtures use:

```text
test-results/fixtures/<host>/<process-and-random-run-id>/<fixture-prefix-and-random-id>/
test-results/fixtures/<host>/<process-and-random-run-id>/manifests/<fixture-name>.json
```

The repository itself supplies the repository boundary. Every allocation is unique and starts empty. Run IDs and Python case-directory names are shortened to leave room for native Windows database paths; `case.json` retains each full pytest node ID. Manifests live beside the fixture trees so they do not appear in a scenario's file inventory. They record the repository, host, process, run, absolute fixture path and `until-explicit-cleanup` retention. Completion records `retained`; `removed-by-scenario` means the scenario itself removed its root. Missing or inconsistent ownership and linked ancestors are refused.

Teardown closes owned processes, sockets and database resources and records retention. It does not remove the fixture. Success and failure artifacts both remain available. Deletes, replacements and recovery performed by the behavior under test still execute against synthetic data; retention is not a snapshot of every intermediate state.

Node runners allocate with `scripts/test/fixtureRuntime.mjs`. The standard Vitest setup isolates application `userData` before application imports. Ordinary and dedicated Vitest configurations also retain JSON reports by default. A command-line reporter override replaces the configured reporters; redirect console output to another ignored report file when needed. Synthetic Git commands inherit `GIT_CEILING_DIRECTORIES`, preventing discovery of the product repository while permitting repositories initialized inside a fixture.

Python uses `scripts/test/fixture_runtime.py`. The Sidecar pytest fixtures replace `tmp_path` and `tmp_path_factory` with retained storage and default JUnit output to the retained run directory unless an explicit output path is supplied. Each case receives a separate database outside its scenario directory, linked through `case.json`; teardown no longer drops every table. The critical Python gate retains completed JUnit output even on failure; its fixture directory also remains after a timeout, which may prevent pytest from finishing the report. The PowerShell helper in `scripts/test/fixture_runtime.ps1` uses the same Node allocator and propagates the Git boundary to child processes.

Active Electron and diagnostics runners print or record their retained fixture path. Their generated artifacts now use the product-local allocator; old `ONLYRAG_*_EVIDENCE` and `ONLYRAG_LIVE_ROOT` output overrides no longer relocate these active runners. Configured-model smoke budgets still use the explicitly supplied shared session directory; changing fixture storage does not reset or bypass a budget. Retired model campaigns and readers of historical evidence remain retired or read-only and are not migrated by this policy.

No age limit automatically deletes evidence. Review an exact scope and request cleanup explicitly. Existing cleanup guards still refuse personal state, backups, tracked files and reparse points, including protected state inside a synthetic tree. Retention does not authorize relaxing those guards or deleting older artifacts.

On Windows, deeply nested retained databases can exceed Git's default path limit. Inspect them with `git -c core.longpaths=true status --short --ignored` when needed. This setting applies to that command only. Existing evidence is not renamed or deleted to shorten its paths.
