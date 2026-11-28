# OnlyRag V2

Windows desktop workspace for document ingestion, retrieval-augmented chat, translation and coding tasks.

## Purpose

Import documents, ask questions across them with source references, translate them, or work on a code folder with an agent, all on your own PC. React runs inside Electron; a Python Sidecar extracts text and stores text and vectors in local LanceDB; Ollama supplies generation and embeddings. The interface is in Italian and English. The current phase targets a working local Windows app: public installer delivery and automatic CI are out of scope ([policy](./docs/local-development-policy-2026-10-20.md)).

## Requirements

| Requirement | Supported configuration |
| --- | --- |
| OS | Windows x64, desktop interface for 1080p |
| Node.js / npm | `>=24.19.0 <25` (pin `24.19.0`) / `>=11 <12` |
| Python | 3.13.x through `py -3.13` or `python` (pin `3.13.15`) |
| Ollama | A running server (default `http://127.0.0.1:11434`) with models for the roles you configure |

## First setup

```powershell
git clone https://github.com/dennidalpos/OnlyRagV2.git
cd OnlyRagV2
npm run setup:dev
npm run dev
```

`setup:dev` installs npm dependencies, prepares Electron and creates `.venv` with the Python requirements. It needs network access and can recreate an incompatible `.venv`: review existing environments first. Check `node --version`, `npm --version` and `py -3.13 --version` before running it.

On first launch: check the Ollama endpoint in **Settings / Impostazioni**, assign installed models to the chat, translation, coding and embedding roles, import a small document in **Ingestione Doc**, then ask a question in **RAG & Chat** and inspect the sources.

## Usage

- **Import and review**: PDF, DOCX, images, text and tables, with the original next to editable Markdown ([ingestion](./docs/ingestion.md)).
- **Search and ask**: dense and BM25 retrieval with ranked chunks and citations ([retrieval](./docs/retrieval.md)).
- **Translate**: streamed text or a separate translated PDF/DOCX ([translation](./docs/translation.md)).
- **Work on code**: Ask, Guided or Auto modes with diffs and verification ([coding agent](./docs/coding-agent.md)).

Results need review. Removing a document from the index keeps its archived original. A remote Ollama endpoint sends model requests to that server: this is not an offline guarantee.

## Build and test

```powershell
npm run docs:check
npm run format:check
npm run typecheck
npm run quality:static
npm run test
npm run quality:python
```

See [operations](./docs/operations.md#comandi) for the full commands.

## Documentation and security

[Documentation index](./docs/README.md) · [User guide](./docs/user-guide.md) · [Developer guide](./docs/developer-guide.md) · [Architecture](./docs/architecture.md) · [Issues](https://github.com/dennidalpos/OnlyRagV2/issues) · [Security policy](./SECURITY.md) · [License](./LICENSE) (MIT; bundled components and models have separate terms in [DISTRIBUTION-LICENSE.md](./DISTRIBUTION-LICENSE.md)).
