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
- Preview cleanup with `pwsh -NoProfile -File scripts/clean_workspace.ps1 -Mode Repo -DisposablePaths <reviewed-absolute-path> -WhatIf`. `Repo`, `TestResidues` and `Full` require reviewed literal paths; `Full` excludes profiles. For protected data and command effects, read [operations.md](../../docs/operations.md).
- Inspect store maintenance with `.venv\Scripts\python.exe scripts/rebuild_embeddings.py --help`. For an authorized operation, pass `preview`, `prepare`, `activate` or `rollback` and `--root <existing-absolute-userData-root>`. `--model` is required only for `prepare`; `--rebuild-id` only for `activate`/`rollback`. `prepare` calls the selected encoder; it is not an offline fixture and is subject to the model-use limits in AGENTS.md. Keep backups and readback evidence.
