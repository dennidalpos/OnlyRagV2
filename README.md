# OnlyRag V2

Local Windows desktop workspace for document ingestion, RAG chat, translation and coding-agent workflows. The LLM runtime is Ollama; document storage is local LanceDB; ingestion/OCR runs in a local Python Sidecar.

## Features

- PDF, DOCX, text, images and tabular ingestion with Markdown preview.
- Hybrid local retrieval, citations and semantic prompt history.
- Markdown and in-place PDF/DOCX translation with streaming progress.
- React coding studio with plan approval, versioned edits, PowerShell tools, Git and verification gates.
- Hardware-aware model selection and local skill hub.
- Renderer/Main process isolation through Electron Preload and typed IPC.

## Documentation

The technical documentation is split by scope in [`docs/README.md`](./docs/README.md):

- architecture and process boundaries;
- Electron Main and React Renderer;
- coding agent and IPC/REST contracts;
- RAG, OCR and translation;
- setup, tests, release and dependencies;
- decisions, verification and known limits.

Contracts are defined by code: [`electron/preload.ts`](./electron/preload.ts), [`shared/types/index.ts`](./shared/types/index.ts), [`sidecar/main.py`](./sidecar/main.py), [`sidecar/schemas.py`](./sidecar/schemas.py) and [`sidecar/contracts/openapi-2.3.0.json`](./sidecar/contracts/openapi-2.3.0.json).

## Quick start

Requirements: Windows 10/11 64-bit, Node `>=24.19.0 <25`, npm `>=11 <12`, Python `3.12.10` and Ollama.

```powershell
git clone https://github.com/dennidalpos/OnlyRagV2.git
cd OnlyRagV2
npm run setup:dev
npm run dev
```

## Useful commands

| Purpose | Command |
| --- | --- |
| Development | `npm run dev` |
| Build | `npm run build` |
| Fast tests | `npm run test:fast` |
| Sidecar tests | `npm run test:sidecar` |
| Type check | `npm run typecheck` |
| Static quality | `npm run quality:static` |
| Documentation | `npm run docs:check` |
| Windows installer | `npm run package:win` |

The complete command catalog is in [`docs/operations.md`](./docs/operations.md).

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

MIT. See [`LICENSE`](./LICENSE).
