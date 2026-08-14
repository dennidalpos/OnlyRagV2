---
name: onlyrag-workspace-guidelines
description: Official architecture guidelines, LanceDB embedded vector DB patterns, FastAPI sidecar lifecycle, Monaco DiffEditor, context window budgeting, Skill Hub & Multi-Marketplace (Skills.sh, Anthropic agentskills.io, LobeHub), and Ollama local API integration for OnlyRag V2.
---

# OnlyRag V2 — Official Architecture & Skill Guidelines

## 1. System Architecture Principles

- **Desktop Framework**: Electron (v43+) + React 19 + TypeScript + Vite 6 + Tailwind CSS v4.
- **Python Sidecar**: FastAPI process launched by Electron Main Process with `httpx` client support and connection pooling. Manages document ingestion, PyMuPDF layout parsing, PyMuPDF PDF compilation export (`/export`), Vision OCR, and LanceDB embedded vector database.
- **Local AI Core**: Ollama REST API (`http://localhost:11434`) for local LLM generation, embeddings (`nomic-embed-text`), and Vision models (`llama3.2-vision`). Zero cloud dependencies or external API calls allowed.
- **IPC Safety Contract**: Strict end-to-end typed contract interface (`IElectronAPI` in `@/types`) in `electron/preload.ts`.

## 2. LanceDB Embedded Vector Database & Chunking Standards

- **Connection & Storage Location**: Initialize single persistent database instance using writable AppData path passed via `ONLYRAG_DATA_DIR` (`%LOCALAPPDATA%/OnlyRagV2/data/lancedb_store`) to prevent Windows OS permission errors (`Accesso negato`) when installed in read-only `C:\Program Files\`.
- **Tables**:
  - `documents`: Stores document metadata (`id`, `filename`, `file_size`, `num_pages`, `num_chunks`, `extracted_markdown`, `status`, `ingested_at`, `file_type`).
  - `chunks`: Stores vector records (`vector`, `chunk_id`, `doc_id`, `doc_name`, `text`, `chunk_index`).
- **Semantic Chunking**: Header-aware Markdown chunking (`[filename | section_header]`) preserving section context.
- **Hybrid Search**: RAG search combines vector similarity embeddings (`nomic-embed-text`) with keyword FTS term boosting for high recall.
- **Sidecar Process Lifecycle**: Asynchronous non-blocking process spawn in `electron/main.ts` with `waitForSidecarHealth` polling retry loop (15s max) and automatic fallback to virtualenv python.

## 3. Security, Path Traversal & Secret Protection Boundaries

- **CORS Restriction**: Explicitly bind CORS in FastAPI sidecar to `["http://localhost:5173", "http://127.0.0.1:5173", "app://-", "vscode-webview://"]`.
- **Directory Traversal Prevention**: Validate all file paths via `validatePathSafety(filePath, workspaceRoot)` to enforce containment inside the workspace root folder.
- **Secret & Credential Isolation**: Block access to `.env`, SSH keys (`id_rsa`, `id_ed25519`), cloud credentials, and private keys (`.pem`, `.key`, `.p12`).
- **PowerShell Execution Safety**: `node-pty` interactive pseudo-terminal session execution with automatic `child_process.spawn` fallback, process tree termination (`taskkill /t /f`), and explicit policy modes (**Plan**, **Ask**, **Agent**). Destructive git reset/clean/force-push commands are strictly blocked.

## 4. Local AI Coding Agent Engine & Context Budgeting

- **Complete Tool Suite**: Multi-step agent loop managed by `agentOrchestratorAppService.ts` supporting full coding capabilities:
  - File Inspection: `read_file` (with optional `startLine`/`endLine` slicing), `list_dir`, `grep_search`.
  - File Modification: `replace_file_content`, `multi_replace_file_content` (CRLF/LF tolerant non-contiguous edits), `write_file`, `delete_file`.
  - Web Research & Downloads: `web_search` (DuckDuckGo search queries), `fetch_web_content` (HTML to clean Markdown doc scraper), `download_file` (sandboxed HTTP/HTTPS asset download).
  - Shell & System: `run_command` (PowerShell command execution for dependency installation `npm i`/`pip install`, testing, and builds), `inspect_os_env`, `finish`.
- **Operational Policy Modes**:
  - **Plan Mode**: Generates structured technical implementation plans analyzing required tools, missing dependencies, files to touch, and verification steps.
  - **Ask Mode**: Read-only research tools run autonomously; modifying actions trigger an explicit user approval modal.
  - **Agent Mode**: Fully autonomous multi-turn loop with auto-healing and diagnostic feedback.
- **Priority Token Budgeting**: Prompt assembly uses a 4-tier priority cascade (P1: System Prompt & Guidelines, P2: Active files, P3: Action history [max 8 steps], P4: Workspace map & RAG docs).
- **Fault-Tolerant Tool Parser**: Sanitizes unescaped newlines, trailing commas, and single quotes in JSON tool calls produced by quantized LLMs (`toolParser.ts`).
- **Auto-Healing Diagnostics Loop**: Captures terminal stdout/stderr on test/build failures and feeds stack traces back to Ollama to auto-correct code.

## 5. Skill Hub, Multi-Marketplace & Automated Skill Router

- **Standard Interoperability**:
  - **Skills.sh**: Open Agent Directory (`skills.sh` ecosystem with `grill-me`, `tdd`, `code-review`, `diagnosing-bugs`, etc.).
  - **Anthropic Agent Skills**: Open standard (`agentskills.io` in `github.com/anthropics/skills` with `skills/<name>/SKILL.md`).
  - **LobeHub Marketplace**: Plugin & tool registry (`lobehub.com/skills` / `chat-plugins.lobehub.com`).
  - **Custom Hubs**: Remote JSON catalogs (`hub.json`) or GitHub raw repositories.
- **Adaptive Hub Adapters**:
  - `CuratedHubAdapter`: Built-in offline-ready core skills.
  - `SkillsShAdapter`: Direct catalog index for Skills.sh community engineering skills.
  - `AnthropicSkillsAdapter`: Pulls from Anthropic's official open skills catalog.
  - `LobeHubAdapter`: Pulls from LobeHub plugin/skill registry with OpenAPI normalization.
  - `JsonCatalogAdapter` & `GitHubRawAdapter`: Generic remote manifest and raw markdown parsers.
- **Provenance & Modification Tracking**:
  - Stores `origin_hub`, `origin_hub_id`, `origin_checksum`, and `is_modified` in `SKILL.md` YAML frontmatter.
  - Distinct status badges in UI: 🟢 `Hub Originale`, 🟠 `Modificata (non più originale)`, 🔵 `Locale Personalizzata`.
  - 1-click "Ripristina Originale" to reset modified skills to pristine hub versions.
- **Automated Contextual Skill Router (`skillMatcher.ts`)**:
  - Evaluates user prompts against all installed active skills.
  - Computes weighted relevance score: Trigger Match (3.0), Tag Match (1.5), Keyword in Description (1.0), Category Match (0.5).
  - Dynamically injects top 3 matched skills into the turn prompt within an 8k characters budget (`[DOMAIN EXPERT SKILL GUIDELINES]`).
- **Management UI**: `SkillHubModal.tsx` in Coding workspace coordinates `SkillHubSourceSelector`, `InstalledSkillsList`, `MarketplaceSkillsList`, `SkillEditorModal`, `CustomHubGuideModal`, and `AddCustomHubModal`.
