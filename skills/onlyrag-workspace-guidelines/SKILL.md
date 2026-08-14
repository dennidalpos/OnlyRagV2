---
name: onlyrag-workspace-guidelines
description: Official architecture guidelines, LanceDB embedded vector database standards, FastAPI sidecar lifecycle, Monaco DiffEditor, context window budgeting, Skill Hub & Multi-Marketplace (Skills.sh, Anthropic agentskills.io, LobeHub), and Ollama local API integrations for OnlyRag V2.
---

# OnlyRag V2 — Official Architecture & Operational Guidelines

## 1. System Architecture Principles

- **Desktop Framework**: Electron (v43+) + React 19 + TypeScript + Vite 7 + Tailwind CSS v4.
- **IPC Safety Contract**: Context-isolated preload bridge exposing strict typed interface `window.electronAPI` (`IElectronAPI` in `@/types`) in `electron/preload.ts`.
- **Python Sidecar**: FastAPI process supervised by Electron Main Process with `httpx` connection pooling. Handles document ingestion, PyMuPDF (fitz) text and layout parsing, PyMuPDF PDF compilation export (`/export`), Vision OCR, and LanceDB embedded vector operations.
- **Local AI Core**: Ollama local REST API (`http://localhost:11434`) for text/code generation, embeddings (`nomic-embed-text`, 768d / `bge-m3`, 1024d), and Vision OCR (`llama3.2-vision`). Zero cloud dependencies or external data leaks.

## 2. LanceDB Embedded Vector Database Standards

- **Storage Location**: Initialize single persistent database instance using the writable AppData path passed via `ONLYRAG_DATA_DIR` (`%LOCALAPPDATA%/OnlyRagV2/data/lancedb_store`) to prevent Windows OS permission errors (`Accesso negato`) when installed in read-only directories (`C:\Program Files\`).
- **Table Schemas**:
  - `documents`: Metadata records (`id`, `filename`, `file_size`, `num_pages`, `num_chunks`, `extracted_markdown`, `status`, `ingested_at`, `file_type`).
  - `chunks`: Vector records (`vector`, `chunk_id`, `doc_id`, `doc_name`, `text`, `chunk_index`).
- **Semantic Chunking**: Header-aware Markdown chunking (`[filename | section_header]`) preserving section context and table structures.
- **Hybrid Retrieval**: Dense vector similarity search combined with keyword Full-Text Search (FTS) term boosting for high recall and precision.
- **Supervised Lifecycle**: Asynchronous non-blocking process spawn in `electron/main.ts` with `waitForSidecarHealth` polling retry loop (15s timeout) and automatic fallback to virtualenv python.

## 3. Layered Architecture Directives

Follow the strict **Presentation $\rightarrow$ Application $\rightarrow$ Domain $\rightarrow$ Infrastructure** pattern:
- **Presentation (`electron/core/presentation/`, `src/components/`)**: UI rendering, user input validation, IPC channel dispatchers. No business logic or direct DB access.
- **Application (`electron/core/application/`, `src/hooks/`)**: Use cases and workflow orchestration (`agentOrchestratorAppService.ts`, `skillAppService.ts`, `ingestionService.ts`). Coordinates domain models and infrastructure repositories.
- **Domain (`electron/core/domain/`)**: Pure domain models, scoring heuristics, and parsing rules (`skillMatcher.ts`, `toolParser.ts`, `complexityEvaluator.ts`, `tokenBudgeter.ts`). Zero dependencies on Electron, UI, or external ORMs.
- **Infrastructure (`electron/core/infrastructure/`)**: Persistence implementations, disk I/O, subprocess execution, HTTP adapters (`fileSystemRepository.ts`, `skillRepository.ts`, `webClient.ts`, `terminalProcess.ts`).

## 4. Local AI Coding Agent Studio

- **Autonomous Tool Loop**: Orchestrated by `agentOrchestratorAppService.ts`:
  - **Inspection**: `read_file` (with optional `startLine`/`endLine` slicing), `list_dir`, `grep_search`.
  - **Modification**: `replace_file_content`, `multi_replace_file_content` (CRLF/LF line-ending preservation & fuzzy chunk matching), `write_file`, `delete_file`.
  - **Research**: `web_search` (DuckDuckGo queries), `fetch_web_content` (HTML-to-Markdown scraper), `download_file` (sandboxed HTTP/HTTPS download).
  - **Execution**: `run_command` (PowerShell command execution for dependency installation, testing, and builds), `inspect_os_env`, `finish`.
- **Policy Modes**:
  - **Plan Mode**: Generates structured technical implementation plans without applying filesystem changes.
  - **Ask Mode**: Read-only research runs autonomously; file edits and shell commands require explicit user approval.
  - **Agent Mode**: Fully autonomous multi-turn loop with automated error recovery.
- **Complexity Router Tiers**:
  - **Fast Tier (🟢)**: Quick lookups, conceptual Q&A (<20 words, 0 attached files).
  - **Standard Tier (🔵)**: Feature development, small refactoring, single-file patches.
  - **Deep Reasoning Tier (🟣)**: Complex multi-file architecture, stack trace debugging, optimization.
  - **Escalated Tier (⚡)**: Dynamic auto-healing escalation upon test or tool execution failure.
  - **Exact Tag Resolution**: Resolves target model names to exact local Ollama tags (`findMatchingInstalledModel`).
- **Context Window Budgeting**: 4-tier token budget allocation (P1: System Prompt & Rules, P2: Active files, P3: Action history [max 8 steps], P4: Workspace map & RAG docs).
- **Fault-Tolerant Tool Parser**: Pre-strips `<think>` CoT reasoning tags and sanitizes unescaped newlines, trailing commas, and single quotes in JSON tool calls (`toolParser.ts`).
- **Auto-Healing Diagnostics Loop**: Captures terminal stdout/stderr on test/build failures and feeds stack traces back to Ollama for self-correction.

## 5. Skill Hub, Multi-Marketplace & Provenance

- **Standard Interoperability**:
  - **Skills.sh**: Open Agent Directory ecosystem (`grill-me`, `tdd`, `code-review`, `diagnosing-bugs`).
  - **Anthropic Agent Skills**: Open standard (`agentskills.io` in `github.com/anthropics/skills` with `skills/<name>/SKILL.md`).
  - **LobeHub Marketplace**: Plugin & skill registry (`lobehub.com/skills` / `chat-plugins.lobehub.com`).
  - **Custom Hubs**: Remote JSON catalogs (`hub.json`) or GitHub raw repositories.
- **Provenance Tracking**:
  - Stores `origin_hub`, `origin_hub_id`, `origin_checksum`, and `is_modified` in `SKILL.md` YAML frontmatter.
  - Visual status badges: 🟢 `Hub Originale`, 🟠 `Modificata`, 🔵 `Locale Personalizzata`.
  - 1-click restore to reset modified skills to original versions.
- **Contextual Skill Router (`skillMatcher.ts`)**:
  - Evaluates user prompts against installed active skills using weighted scoring: Trigger Match (3.0), Tag Match (1.5), Keyword in Description (1.0), Category Match (0.5).
  - Dynamically injects top 3 matched skills into the turn prompt within an 8k characters budget (`[DOMAIN EXPERT SKILL GUIDELINES]`).
