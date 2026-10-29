---
name: onlyrag-release-operations
description: Build an OnlyRag Windows CPU local candidate or inspect repository cleanup and explicit embedding-store maintenance commands.
triggers: ["package:win", "cpu release", "build_package.ps1", "clean_workspace.ps1", "rebuild_embeddings.py", "release artifact"]
tags: ["release", "maintenance"]
---

# Release and maintenance

- Use [AGENTS.md](../../AGENTS.md#comandi-e-verifica) for the pre-commit gate and [verification commands](../code-quality-and-linting/SKILL.md) for targeted checks.
- `npm run package:win` creates a fresh `release/cpu-*` candidate with Sidecar, licenses, notices and source archive. It installs release Python dependencies into `build/release-cpu/venv` and runs build/smoke steps; it is not a read-only validation command.
- `pwsh -NoProfile -File scripts/build_package.ps1 -RequireSignature` requires a valid installer signature. `-SkipSidecar` is rejected. Use [distribution.md](../../docs/distribution.md) for packaging details; historical qualification records do not create a current publication or model-campaign requirement.
- Preview cleanup with `pwsh -NoProfile -File scripts/clean_workspace.ps1 -Mode Repo -DisposablePaths "<reviewed-absolute-path>" -WhatIf`. `Repo`, `TestResidues` and `Full` require an explicit selection; the npm aliases do not supply one. `Full` excludes profiles. Read `scripts/cleanup_policy.ps1` for eligible roots; the preflight can refuse even with `-WhatIf`.
- For log preflight use `pwsh -NoProfile -File scripts/clean_workspace.ps1 -Mode Logs -DisposablePaths "<absolute-log-file>" -ApplicationClosed -WhatIf`. `ApplicationClosed` is the operator's assertion, not process detection. `StopAppProcesses` is rejected. For mode effects and preserved data, use [operations.md](../../docs/operations.md#cleanup-safety-policy--2026-10-10).
- Inspect store maintenance with `.venv\Scripts\python.exe scripts/rebuild_embeddings.py --help`. With the app closed, an authorized operation takes `preview`, `prepare`, `activate` or `rollback` and `--root "<existing-absolute-userData-root>"`. `--model` is accepted only for `prepare`; `--rebuild-id` only for `activate`/`rollback`. `prepare` calls the selected encoder and retains a candidate/backup; activation changes the versioned pointer after readback. Use [retrieval.md](../../docs/retrieval.md) and AGENTS.md for maintenance and model-use constraints.
