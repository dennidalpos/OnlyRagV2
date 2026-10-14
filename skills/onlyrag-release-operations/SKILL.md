---
name: onlyrag-release-operations
description: Build an OnlyRag Windows CPU release candidate or inspect repository cleanup and offline embedding-store maintenance commands.
triggers: ["package:win", "cpu release", "build_package.ps1", "clean_workspace.ps1", "rebuild_embeddings.py", "release artifact"]
tags: ["release", "maintenance"]
---

# Release and maintenance

- Run `npm run test && npm run build` before any commit or push. `npm run package:win` creates a fresh `release/cpu-*` candidate with Sidecar, licenses, notices and source archive; it does not install or publish.
- `scripts/build_package.ps1 -RequireSignature` requires a valid installer signature. Do not use `-SkipSidecar`: the script rejects it. Check `docs/distribution.md` before claiming a release is qualified.
- Preview cleanup with `scripts/clean_workspace.ps1 -Mode Repo -DisposablePaths <reviewed-absolute-path> -WhatIf`. `Repo`, `TestResidues` and `Full` require reviewed literal paths; `Full` excludes profiles. Do not infer disposal from a directory name or run deletion without authorization for retained data.
- Invoke `scripts/rebuild_embeddings.py` with `.venv\Scripts\python.exe` only for an explicitly authorized store. Select one operation (`preview`, `prepare`, `activate`, `rollback`) and pass `--root` with the existing absolute userData root. `prepare` also needs `--model`; `activate` and `rollback` need `--rebuild-id`. Keep backups and readback evidence.
- Consult `docs/operations.md` for command effects and protected paths; keep release and cleanup output outside personal stores.
