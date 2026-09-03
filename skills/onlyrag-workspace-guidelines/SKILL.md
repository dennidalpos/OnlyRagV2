---
name: onlyrag-workspace-guidelines
description: Official architecture guidelines, LanceDB embedded vector database standards, FastAPI sidecar lifecycle, Monaco DiffEditor, context window budgeting, Skill Hub & Multi-Marketplace (Skills.sh, Anthropic agentskills.io, LobeHub), and Ollama local API integrations for OnlyRag V2.
---

# OnlyRag V2 — Official Architecture & Operational Guidelines

## 1. System Architecture Principles

- **Desktop Framework**: Electron (v43+) + React 19 + TypeScript + Vite 8 + Tailwind CSS v4.
- **IPC Safety Contract**: Context-isolated preload bridge exposing strict typed interface `window.electronAPI` (`IElectronAPI` in `@/types`) in `electron/preload.ts`.
- **Python Sidecar**: FastAPI process supervised by Electron Main Process with `httpx` connection pooling. Handles document ingestion, PyMuPDF (fitz) text and layout parsing, PyMuPDF PDF compilation export (`/export`), Vision OCR, and LanceDB embedded vector operations.
- **Local AI Core**: Ollama local REST API (`http://localhost:11434`) for text/code generation, embeddings (`nomic-embed-text`, 768d / `bge-m3`, 1024d), and Vision OCR (`llama3.2-vision`). Zero cloud dependencies or external data leaks.
- **Single Source of Truth**: All architectural and operational specifications reside in `/docs/` (`docs/README.md`, `docs/architecture.md`, `docs/modules.md`, `docs/api.md`, `docs/setup-and-env.md`).

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
- **Domain (`electron/core/domain/`)**: Pure domain models, scoring heuristics, and parsing rules (`skillMatcher.ts`, `toolParser.ts`, `complexityEvaluator.ts`, `contextWindowCalculator.ts`). Zero dependencies on Electron, UI, or external ORMs.
- **Infrastructure (`electron/core/infrastructure/`)**: Persistence implementations, disk I/O, subprocess execution, HTTP adapters (`fileSystemRepository.ts`, `skillRepository.ts`, `webClient.ts`, `terminalProcess.ts`).

## 4. Local AI Coding Agent Studio

- **Autonomous Tool Loop**: Orchestrated by `agentOrchestratorAppService.ts`:
  - **Inspection**: `read_file` (with line slicing), `extract_code_symbols` (AST/Regex parser), `list_dir`, `list_files_recursive` (`tree` scanner), `grep_search`.
  - **Modification**: `write_file`, `create_directory` (`mkdir`), `copy_file` (`cp`), `move_file` (`mv`/rename), `replace_file_content`, `multi_replace_file_content` (CRLF/LF line-ending preservation & fuzzy chunk matching), `delete_file`.
  - **Research**: `web_search` (DuckDuckGo queries), `fetch_web_content` (HTML-to-Markdown scraper), `download_file` (sandboxed HTTP/HTTPS download).
  - **Execution**: `run_command` (esecuzione PowerShell non-interattiva con timeout adattivo), `run_tests` (pass/fail strutturato del test runner), `inspect_os_env` (inventario toolchain), `ensure_tool` (installazione winget da allow-list chiusa: node, npm, pnpm, git, python, ollama), `ask` (chiarimento), `finish`.
  - **Planning**: `update_plan` consente l'aggiornamento dei milestone convalidati dall'evidenza su filesystem. La promozione automatica a `verified` avviene solo al superamento di un comando di verifica reale (build, typecheck, test runner) — mai tramite comandi vuoti o semplice creazione di file segnaposto.
- **Policy Modes**:
  - **Plan Mode**: Generates structured technical implementation plans without applying filesystem changes.
  - **Ask Mode**: Read-only research runs autonomously; file edits and shell commands require explicit user approval.
  - **Agent Mode**: Fully autonomous multi-turn loop with automated error recovery.
- **Deterministic Workhorse Model Architecture**:
  - **Workhorse Model (Primary)**: The agent operates deterministically on the user's primary development model (`codingModel`, e.g. `qwen2.5-coder:7b`, `qwen3:8b`, `deepseek-r1:8b`), keeping it loaded in VRAM and retaining KV-cache continuity across turns (zero VRAM thrashing).
  - **Unified Coding Prompt Architecture**: Single unified, high-performance system prompt containing core execution directives, anti-stub rules, and tool formatting rules without artificial complexity tier fragmentation.
  - **Exact Tag Resolution**: Resolves target model names to exact local Ollama tags (`findMatchingInstalledModel`).
  - **Single Hardware Ladder**: `hardwareProfileTiers.ts` is the only place host tiers (`legacy`/`entry`/`midrange`/`highend`/`extreme`), the safe-VRAM formula, the usable-RAM budget, the CPU throughput ceiling and minimum-hardware detection are defined. The model matrix, the complexity router, the agent runtime options and the Ollama OS parameters all consume it — never re-derive a VRAM threshold locally.
  - **Catalog-Derived Cascades**: Fallback chains come from `hardwareModelCatalog.buildFallbackChain` (curated pick first, then within-budget largest-first, then over-budget smallest-first). Never hardcode model tag arrays in the router.
  - **Recommendation Invariant**: A model may be listed in `recommendedForProfiles` for a profile only if `assessModelHardwareCompatibility` does not return `exceeds_vram` there — the wizard pre-selects these entries. Enforced by `hardwareRecommendationEngine.test.ts`.
- **Context Window Budgeting**: 4-tier token budget allocation (P1: System Prompt & Rules, P2: Active files, P3: Action history [max 8 steps], P4: Workspace map & RAG docs).
- **RAG Chat Context Budgeting**: `chatContextBudget.ts` sizes retrieval chars, `top_k`, per-document previews, replayed history and the `num_ctx` ceiling from the detected host, with a dedicated floor for minimum hardware. `useChatEngine` must pass `num_ctx`/`num_thread`/`keep_alive` to `generateOllamaStream` — omitting them falls back to the transport default of 16384.
- **Fault-Tolerant Tool Parser**: Pre-strips `<think>` CoT reasoning tags and sanitizes unescaped newlines, trailing commas, and single quotes in JSON tool calls (`toolParser.ts`).
- **Auto-Healing Diagnostics Loop**: Captures terminal stdout/stderr on test/build failures and feeds stack traces back to Ollama for self-correction.
- **Resilient SLM Log Diagnostics**: Dual-engine architecture with FastAPI Python sidecar scanner and native Node.js Electron fallback (`sidecarAppService.ts`) for zero-downtime anomaly detection (CUDA OOM, truncated JSON, tool loop, timeouts) and actionable remediation steps.
- **Compact UI Timeline & Action Cards**: Agent activity is rendered via `@tanstack/react-virtual` in compact action cards with verb/target/status badges, avoiding verbose chat bubbles and optimizing screen space.
- **Definition of Done Gate**: `TransactionalExecutionGuard.validateTaskCompletion` intercepts `finish` when milestones are unverified or code changed without a verification run. Each distinct reason intercepts at most once, so the gate can advise but never deadlock a session.
- **Small-Model Runtime Tuning**: `num_ctx` is frozen per session (grow-only) to preserve Ollama KV-cache reuse, `num_predict` is capped per complexity tier, and stop sequences cut generation when the model starts hallucinating the next turn history block. `num_thread` is pinned on every hardware profile; the first-turn model is pre-loaded so the cold load overlaps prompt assembly.
- **Session History**: `sessionHistoryRepository.ts` is the single store for the coding session history (`<workspace>/.onlyrag/sessions/session_history.json`, home fallback for standalone runs), exposed through the `sessions:*` CRUD channels. Each session owns its `ExecutedPrompt` records (ISO 8601 timestamps, mode, outcome, steps, files touched, +/- lines); `.onlyrag/sessions/.agent_state_*.json` stays limited to the runtime state needed to resume the loop.
- **Diff Surfaces**: `diffEngine.ts` powers the coloured line-by-line Git diff panel and the before/after approval modal, with +/- counts per file and aggregate session change metrics.
- **Serial Execution**: agent tasks always run one at a time (`taskQueueAppService`), because the tool executor owns a single workspace journal and shared persistent shells.

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
- **Auto-Install Policy (`autoInstallHubSkills`)**:
  - `auto`: installs the top hub match above the score threshold without asking.
  - `prompt`: the install is submitted to the user (`agent:skill-install-request` / `agent:skill-install-response`, bridged by `skillInstallApprovalService`) and awaited during prompt assembly; an unanswered request (120s) resolves as denied, and a missing confirmation channel skips the install instead of falling back to `auto`.
  - `disabled`: hub discovery and the skill router are both off.
- **Contextual Skill Router (`skillMatcher.ts`)**:
  - Evaluates user prompts against installed active skills using weighted scoring: Trigger Match (3.0), Tag Match (1.5), Keyword in Description (1.0), Category Match (0.5).
  - Dynamically injects top 3 matched skills into the turn prompt within an 8k characters budget (`[DOMAIN EXPERT SKILL GUIDELINES]`).

## 6. FastAPI & Python Sidecar Standards

- **Async Non-Blocking Execution**: Use `async def` for I/O bound endpoints. Wrap blocking CPU calculations or synchronous disk I/O in `asyncio.to_thread(...)` to prevent stalling the FastAPI event loop.
- **Typed Pydantic Schemas**: Define explicit request and response models with Pydantic v2 (`BaseModel`).
- **Resource Cleanup**: Ensure all file handles (`pymupdf.Document`, file descriptors) are wrapped in `try/finally: doc.close()`.

## 7. React 19 & Frontend Development Standards

- **React 19 Idioms**: Pass `ref` directly as a prop (no `forwardRef` boilerplate required in modern React 19 components).
- **Strict Typing**: TypeScript strict mode enabled throughout `src/` — avoid `any` or loose untyped objects.
- **State Management**: Encapsulate domain logic in custom hooks (`useIngestion`, `useCodingAgent`, `useTranslation`, `useSettings`).
