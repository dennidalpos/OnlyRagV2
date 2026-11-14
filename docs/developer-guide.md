# Development, contracts and operations

This guide helps Windows contributors prepare a development checkout, run checks, and diagnose storage or service failures. For the app's 26 operational flows, use the [user guide](user-guide.md). The [index](README.md) maps technical detail and dated evidence.

## Toolchain and startup

[package.json](../package.json) requires Node `>=24.19.0 <25` and npm `>=11 <12`; [`.nvmrc`](../.nvmrc) pins `24.19.0`. Python must be 3.13.x ([`.python-version`](../.python-version) pins `3.13.15`). Run the commands from the checkout root in PowerShell. Ollama is required for generation and embeddings, but not deterministic source checks; its default endpoint is `http://127.0.0.1:11434`.

~~~powershell
node --version
npm --version
py -3.13 --version
npm run setup:dev
# Continue only when setup exits successfully.
npm run dev
~~~

Setup uses npm ci, prepares Electron and installs Python development requirements in .venv. It can recreate an incompatible environment, so review existing work first. Runtime auto-preparation installs runtime requirements and does not guarantee pytest is present. Main-process changes require restarting development; Renderer hot reload alone is insufficient.

The setup script accepts Python through `py -3.13`, or `python` when the launcher is absent. It checks Node, but does not enforce the npm range separately: check both versions above. If Node 26 is first in PATH, select a supported Node 24 installation for this shell before running setup; do not change the repository pins to match the host.

Build outputs and repository-managed caches stay in the checkout's ignored folders. Setup can also populate npm/pip's usual download caches outside the checkout; fixture storage does not redirect those caches. Test runners use synthetic profiles and retained fixtures under `test-results/fixtures/`; see [test storage](test-storage.md). Ordinary `npm run dev` uses the normal application profile and can start local services. Do not use a personal profile for destructive test scenarios or stop an unknown process occupying Sidecar's port.

## Architecture and contracts

Renderer React uses window.electronAPI through context-isolated Electron Preload. Main validates sender/frame, argument counts and schemas, coordinates application/domain services and delegates infrastructure operations. The Python FastAPI Sidecar owns extraction/index services over local REST/NDJSON. Ollama supplies configured generation/embedding.

shared/ipc/ipcContract.ts is authoritative for IPC channels, payloads/results and events. electron/preload.ts derives its API and secureIpcMain validates dispatch. Static registration checks are not field-level behavioral proof.

`sidecar/main.py` and `sidecar/schemas.py` define REST. The generated OpenAPI snapshot is `sidecar/contracts/openapi-2.5.0.json`, not a hand-edit target. The Sidecar normally binds `127.0.0.1:8000`; configured `X-OnlyRag-Token` protects requests except health/preflight. CORS is separate from token authentication. Use typed transport/cancellation handling rather than inferring success from stream closure.

Settings bootstrap/persistence, document/chat drafts, request ledgers, agent history and revision-bound recovery have different stores and acknowledgement boundaries. Failed reads must preserve originals; a journal or export does not by itself acknowledge a canonical save. Main policy consumers (external launch, web fetch/search/download) read settings with `loadSettingsOrThrow` and fail closed when the file is unreadable or unsupported; only a missing file means first launch.

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

Writes to existing files require the read revision/hash. Checkpoints cover run-attributed files, directories and verified internal links, including empty subdirectories. They exclude `.onlyrag` metadata and arbitrary external effects. Snapshot refusal precedes mutation when an original is unreadable, a link is external or unverifiable, an entry type is unsupported, or a directory exceeds 2,000 files or 10,000 entries. Restore rechecks paths and link targets; a changed target can make restoration fail.

New workspace metadata initializes layout 2 directly. Previous or unversioned layouts, versionless session envelopes, old session records and v1 checkpoints are refused without conversion or deletion of originals/backups. Opening Standalone refuses previous standalone history instead of transferring it. Interrupted execution requires its run identity; an approved pending seed belongs to its plan revision. Old log messages are not reconstructed into executed prompts, and missing answer provenance is not treated as explicit consent.

Ollama model pulls succeed only on a terminal `success` status after a clean HTTP 200 stream; empty, malformed, interrupted or error streams fail, and layer progress never completes a model. One pull owns the lock at a time (same model included), released only by its own token, so a cancelled pull cannot release its successor.

The native project verifier resolves actual manifests/configuration for Python, Go, Cargo, Maven, Gradle and Composer as well as Node. Every recognized stack needs evidence. Missing tools, empty/skipped suites, timeouts, canceled checks and failed assertions must remain distinct. Offline package-manager flags prevent some implicit acquisition but do not sandbox arbitrary script networking.

Ordinary profiles validate filesystem, commands, network/installations and approvals. Full Access takes a different broader path and must not be attributed the limited profile's exclusions. Skill installation, activation, editing and uninstall have separate ownership/hash/transaction boundaries; external content is untrusted input.

The skill editor uses one multiline field per trigger or tag. When an uninstall is interrupted, the next listing checks the staged skill against its receipt in the application profile. An intact copy can be restored to a free original path with its previous activation. If the original path is occupied or the staged copy is incomplete, the repository keeps the remaining files and receipt and logs the recovery path.

## Current checks

The 14 November 2026 review exercised setup in a fresh detached checkout, then applied the current uncommitted source changes for build/startup verification. Node 24.22.1, npm 11.20.0 and Python 3.13.17 satisfy the supported ranges; the repository pins remain unchanged. Electron opened with a synthetic profile and its native Sidecar reached health readiness. A separate `npm run dev` probe used the E2E profile switch, which skips automatic Sidecar startup. No generation, model download or installer test was part of these startup checks. Setup reported npm advisories; see [dependency limits](libraries.md#manutenzione-e-limiti-correnti).

~~~powershell
npm run docs:check
npm run format:check
npm run typecheck
npm run quality:static
~~~

Documentation-only changes need the relevant documentation/whitespace checks. docs:check validates local paths/anchors, npm command names and supported Mermaid flowchart structure; it does not render diagrams, check remote URLs or qualify runtime behavior.

Additional checks are `npm test`, targeted Vitest, `npm run quality:python` for required offline Python critical cases, and the full pytest/Sidecar wrapper when code warrants them. `test:fast` changes reporting, not test scope. Python critical quality rejects missing/skipped cases; exit 0 alone is insufficient.

Electron recovery/UX tests use owned deterministic profiles/services. Active runners retain success and failure fixtures under `test-results/fixtures/`; their former evidence-location environment overrides no longer relocate output. See [test storage and retention](./test-storage.md) for ownership, subprocess isolation and explicit cleanup. Retired model campaigns and historical inference budgets stay retired.

## Generated files and local candidates

`npm run generate:openapi` rewrites the snapshot from Python application/schemas. `npm run assets:check` verifies app assets; `npm run assets:generate` writes them. The 26 original user-flow SVGs do not have a maintained generator in this repository. Preserve them with their original text and never claim they were regenerated without a verified method.

package:win builds a local Windows CPU candidate and can provision release dependencies. The active phase does not promise public installer delivery, CI execution, general model qualification or a new licensing decision. Keep historical distribution proposals, inventories, licenses/notices and frozen corpora unchanged. Package versions/provenance come from the manifest/lockfiles and generated dependency baseline; they do not identify external services.

## Recovery, cleanup and qualification limits

Agent-task recovery records are bound to the original run/context; terminal receipts block replay and unknown outcomes require inspection/reconciliation. Do not edit history files to force resume. Canonical, journaled, in-memory and exported states are different.

Cleanup commands are destructive and require an explicit reviewed scope, closed application and accepted disposable paths. Do not classify old scratch, checkpoints, .onlyrag, profiles, logs, backups or evidence as removable by name. Retain fixtures and reports; no cleanup is part of this documentation revision.

Artifact recovery groups current-format records by previous workspace path and checks the group's file hashes again after confirmation. Each record is written atomically. An interrupted batch can be reviewed again for the remaining records. Rejected regular records can be exported byte for byte to a new file. The Electron artifact draft scenario covers the confirmation and export through IPC with synthetic data.

Remaining native-runner prerequisites, component attribution and publication review have separate work and evidence. Settings read refusal, code drafts across workspace switches, stale file-list invalidation, skill editing and checkpoint directory coverage are implemented behavior, not an undifferentiated list of open defects. Installed-app, power-loss, SMB, native model quality and real provider qualification remain outside static or synthetic checks.

For help, record the revision, tool versions, exact command and sanitized error. Consult [operations](operations.md) and [agent diagnostics](agent-diagnostics.md), then use the repository's [issue tracker](https://github.com/dennidalpos/OnlyRagV2/issues). Logs can contain document text, prompts and local paths; inspect them before sharing.
