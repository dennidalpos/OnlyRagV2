# Development, contracts and operations

The [user guide](user-guide.md) covers all 26 operational flows. This English guide covers the maintained technical subjects; the [index](README.md) maps retained Italian detail and historical originals. No historical receipt is requalified simply by translating it.

## Toolchain and startup

package.json pins Node >=24.19.0 <25 and npm >=11 <12; .nvmrc specifies24.19.0. Python must be3.13.x (.python-version pins3.13.15). Use the supported Windows toolchain. Ollama is required for model work, not deterministic source checks; its default local endpoint is127.0.0.1:11434.

~~~powershell
npm run setup:dev
npm run dev
~~~

Setup uses npm ci, prepares Electron and installs Python development requirements in .venv. It can recreate an incompatible environment, so review existing work first. Runtime auto-preparation installs runtime requirements and does not guarantee pytest is present. Main-process changes require restarting development; Renderer hot reload alone is insufficient.

Use a synthetic isolated application profile and managed SecondBrain runtime for builds/tests. Verify tool-specific output paths; an environment variable alone is not evidence every artifact is redirected. Do not stop an unknown process occupying Sidecar's port.

## Architecture and contracts

Renderer React uses window.electronAPI through context-isolated Electron Preload. Main validates sender/frame, argument counts and schemas, coordinates application/domain services and delegates infrastructure operations. The Python FastAPI Sidecar owns extraction/index services over local REST/NDJSON. Ollama supplies configured generation/embedding.

shared/ipc/ipcContract.ts is authoritative for IPC channels, payloads/results and events. electron/preload.ts derives its API and secureIpcMain validates dispatch. Static registration checks are not field-level behavioral proof.

sidecar/main.py and schemas.py define REST. The generated OpenAPI snapshot is sidecar/contracts/openapi-2.5.0.json, not a hand-edit target. The Sidecar normally binds127.0.0.1:8000; configured X-OnlyRag-Token protects requests except health/preflight. CORS is separate from token authentication. Use typed transport/cancellation handling rather than inferring success from stream closure.

Settings bootstrap/persistence, document/chat drafts, request ledgers, agent history and revision-bound recovery have different stores and acknowledgement boundaries. Failed reads must preserve originals; a journal or export does not by itself acknowledge a canonical save. Existing P1 settings-policy and destructive-snapshot tasks remain open.

## Document ingestion and storage

Main validates the local source before Sidecar extraction/OCR/indexing. Supported extraction includes PDF, DOCX, text, supported images and bounded tabular formats; explicit unsupported/coverage notices are part of the contract.

The imported original archive has provenance/hash checks. Later preview or layout translation consumes verified archived bytes; an external file is not a silent replacement for a missing/corrupt archived original. Removing an index entry does not imply purge of retained archives.

Native RapidOCR/ONNX and explicit Vision/Ollama are separate modes. Provider diagnostics must come from the initialized engine, not a GPU-presence guess. Ordinary ingestion currently disables LLM normalization. Conditional review drafts are exportable, not automatically indexed.

Document edits compare original revisions and update vectors only through the guarded operation. Preserve drafts on stale bases, save/recovery failures or late reload races. Copy/export are separate from canonical storage acknowledgement.

## Retrieval and embedding maintenance

Embedding provenance belongs to stored documents/chunks and the configured encoder. Dense retrieval and BM25 rank candidates; query scope, extraction coverage, source/archive revision and the actual context included in a response remain explicit. Scores are not correctness probabilities. Read paths must not silently upgrade/migrate unknown data.

Changing embedding models does not make an existing index compatible. scripts/rebuild_embeddings.py has preview, prepare, activate and rollback with an absolute existing root. Prepare calls the selected encoder and retains originals/backup/candidate; despite the historical title it is not a no-inference operation. Activate/rollback require rebuild-id and verified readback. Close the app and review leases/backup before authorized maintenance. No personal rebuild was run for this documentation change.

## Translation contracts

Markdown translation prepares/validates prompts before dispatch, keeps fenced blocks intact and rejects over-budget indivisible blocks. Explicit model/context settings and confirmed stream completion are required before export; partial/limited/stopped output is not completion.

PDF/DOCX translation uses the source archive and revision checks before dispatch and exclusive publication. Missing/corrupt archives, concurrent edits/deletions, marker count/content mismatch and late destination collision cause refusal rather than overwrite. Destination hard-link support is required. Staging and saved output are read back.

DOCX covers supported body/table/hyperlink/header/footer structures and rejects unsupported text containers before inference; images are preserved without OCR. PDF checks glyphs/fonts/layout bounds and saved Unicode. Frozen-corpus and glossary results remain bounded historical evidence, not general semantic or Word-rendering qualification. Cancellation waits for the native final result; transport loss is an error, not proof of canceled work.

## Agent policy and verification

The model proposes actions/plans; Main arbitrates order and tool gates. DiagnosticAdvice remains a suggestion, not authority. Invalid schema, repeated failures, tool-free actions and mutation-free steps consume distinct progress budgets; read PROGRESS_BUDGET from source instead of maintaining duplicate numeric policy.

Identical failed verification without changed inputs is blocked; a justified retry after a change is distinct. Forced closure cannot become verified based on model prose. Stop/rejection does not automatically roll back files.

Writes to existing files require the read revision/hash. Checkpoints cover run-attributed files, not .onlyrag metadata or arbitrary external effects. Snapshot completeness and fail-closed settings policy remain separately tracked defects.

The native project verifier resolves actual manifests/configuration for Python, Go, Cargo, Maven, Gradle and Composer as well as Node. Every recognized stack needs evidence. Missing tools, empty/skipped suites, timeouts, canceled checks and failed assertions must remain distinct. Offline package-manager flags prevent some implicit acquisition but do not sandbox arbitrary script networking.

Ordinary profiles validate filesystem, commands, network/installations and approvals. Full Access takes a different broader path and must not be attributed the limited profile's exclusions. Skill installation, activation, editing and uninstall have separate ownership/hash/transaction boundaries; external content is untrusted input.

## Current checks

~~~powershell
npm run docs:check
npm run format:check
npm run typecheck
npm run quality:static
~~~

Documentation-only changes need the relevant documentation/whitespace checks. docs:check validates local paths/anchors, npm command names and supported Mermaid flowchart structure; it does not render diagrams, check remote URLs or qualify runtime behavior.

Additional checks are npm test, targeted Vitest, quality:python for required offline Python critical cases, and the full pytest/Sidecar wrapper when code warrants them. test:fast changes reporting, not test scope. Python critical quality rejects missing/skipped cases; exit0 alone is insufficient.

Electron recovery/UX tests use owned deterministic profiles/services and have explicit evidence-output controls. ONLYRAG_RECOVERY_EVIDENCE and ONLYRAG_LIVE_ROOT are used by the corresponding runners; verify each runner's accepted options and retention. Do not run live model campaigns or spend historical inference budgets for this documentation task.

## Generated files and local candidates

npm run generate:openapi rewrites the snapshot from Python application/schemas. assets:check verifies app assets; assets:generate writes them. The26 original user-flow SVGs do not have a maintained generator in this repository. Preserve them with their original text and never claim they were regenerated without a verified method.

package:win builds a local Windows CPU candidate and can provision release dependencies. The active phase does not promise public installer delivery, CI execution, general model qualification or a new licensing decision. Keep historical distribution proposals, inventories, licenses/notices and frozen corpora unchanged. Package versions/provenance come from the manifest/lockfiles and generated dependency baseline; they do not identify external services.

## Recovery, cleanup and qualification limits

Agent-task recovery records are bound to the original run/context; terminal receipts block replay and unknown outcomes require inspection/reconciliation. Do not edit history files to force resume. Canonical, journaled, in-memory and exported states are different.

Cleanup commands are destructive and require an explicit reviewed scope, closed application and accepted disposable paths. Do not classify old scratch, checkpoints, .onlyrag, profiles, logs, backups or evidence as removable by name. Retain fixtures and reports; no cleanup is part of this documentation revision.

Current unresolved topics include settings fail-closed behavior, destructive checkpoint completeness, editor drafts on workspace switch, pending file-list invalidation, store/skill lifecycle integrity and separate publication review. Their tracker entries and evidence are reviewed in the runtime audit report; this guide does not close them. Installed-app, power-loss, SMB, native model quality and real provider qualification remain outside static or synthetic checks.
