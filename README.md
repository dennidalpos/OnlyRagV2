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

The concise technical guides are organized by scope in [`docs/README.md`](./docs/README.md). Code is authoritative for IPC ([`shared/ipc/ipcContract.ts`](./shared/ipc/ipcContract.ts)), REST ([`sidecar/main.py`](./sidecar/main.py)) and shared types ([`shared/types/index.ts`](./shared/types/index.ts)).

## Quick start

Requirements: Windows 10/11 64-bit, Node `>=24.19.0 <25`, npm `>=11 <12`, Python `3.12.10` and Ollama.

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

MIT. See [`LICENSE`](./LICENSE).
