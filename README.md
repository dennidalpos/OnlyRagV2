# OnlyRag V2

Development currently targets a working local Windows app. [Local policy and autonomous tests](./docs/local-development-policy-2026-10-20.md): no model qualification campaigns or automatic CI; optional smoke tests use only models manually configured in the app. Public installer delivery is outside this phase.

Local Windows desktop workspace for document ingestion, RAG chat, translation and coding-agent workflows. The LLM runtime is Ollama; document storage is local LanceDB; ingestion/OCR runs in a local Python Sidecar.

## Features

- PDF, DOCX, text, images and tabular ingestion with Markdown preview.
- Hybrid local retrieval, citations and semantic prompt history.
- Markdown and in-place PDF/DOCX translation with streaming progress.
- React coding studio with plan approval, versioned edits, PowerShell tools, Git and verification gates.
- Hardware diagnostics, explicit model assignments by role and local skill hub.
- Renderer/Main process isolation through Electron Preload and typed IPC.

## Documentation

The guides are organized by scope in [`docs/README.md`](./docs/README.md), with separate [current verification](./docs/verification-current.md) and [historical evidence](./docs/history.md). Compare approved requirements with IPC ([`shared/ipc/ipcContract.ts`](./shared/ipc/ipcContract.ts)), REST ([`sidecar/main.py`](./sidecar/main.py)) and tests; report unresolved differences rather than assuming that implementation establishes the intended behavior.

## Quick start

Requirements: Windows 10/11 64-bit, Node `>=24.19.0 <25`, npm `>=11 <12`, Python `3.13.15` and Ollama.

```powershell
git clone https://github.com/dennidalpos/OnlyRagV2.git
cd OnlyRagV2
npm run setup:dev
npm run dev
```

For development, verification, packaging and cleanup commands, use [`docs/operations.md`](./docs/operations.md).

## Repository map

```text
electron/   Main process, IPC, application services and infrastructure
shared/     Cross-process types and pure domain rules
src/        React Renderer
sidecar/    FastAPI, LanceDB, OCR, translation and REST contract
scripts/    Setup, validation, test and packaging automation
docs/       Technical documentation by scope
skills/     Local agent skills
```

## License

Project source uses MIT; see [`LICENSE`](./LICENSE). Bundled dependencies have additional terms. The approved combined CPU candidate uses the terms in [`DISTRIBUTION-LICENSE.md`](./DISTRIBUTION-LICENSE.md); the [CPU record](./docs/distribution-cpu-release.md) and [license review](./docs/distribution-licenses.md) preserve the dated decision and evidence. Public installer delivery is outside the current [local-development scope](./docs/local-development-policy-2026-10-20.md); source repository publication does not qualify an installer or its corresponding-source delivery.
