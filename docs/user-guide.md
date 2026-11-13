# OnlyRag V2 user guide

This is the English operational guide. The retained [Italian visual guide](guida-utente.md) contains the original 26 numbered flows and existing accessible SVG diagrams. Interface labels may be Italian or English. The instructions below describe implemented paths and refusals, not a new model-quality or installed-build qualification.

## Choose a workflow and prepare services (flows 00–01)

Use Ingestion for importing/reviewing documents, RAG & Chat for questions, Translation for language conversion, Coding Agent for workspace work, and Settings for models/permissions/logs.

If settings cannot be read, use Retry; do not replace the original file to hide the failure. Verify Ollama for generation/embeddings and the LanceDB Sidecar for document operations. Sidecar startup can remain Checking while Python/runtime preparation finishes. Review the final result before assuming it is offline. Complete the hardware/model wizard or assign installed models to the required roles. Closing the wizard without saving leaves earlier assignments.

Local resources can be used offline after setup. Installing dependencies, downloading models and permitted network tools require connectivity. A configured remote Ollama receives the request data: selecting it changes the privacy boundary.

## Import, review, export and search (flows 02–07)

1. Choose native RapidOCR/ONNX or an explicit compatible Ollama Vision model. Native OCR status reports the confirmed initialized provider; a detected GPU alone does not mean the engine is using it.
2. Browse or drag local files. Multiple files are processed sequentially; canceling a file dialog starts nothing.
3. Watch extraction, OCR and indexing. Cancel requests interruption; wait for the terminal outcome. A canceled or failed job is not an indexed success.
4. Inspect the resulting document and its coverage notices. A fallback embedding warning requires model/provenance review and explicit reindexing. Tabular extracts can omit rows, columns or cells even when an extended Excel size option accepts the source.

The normal current import path disables LLM normalization. If a conditional normalization-review panel appears, inspect/expose the original extracted text and export it before closing. That draft is not indexed and the panel does not directly approve/save it; revise it and prepare another import.

The document editor compares original preview and extracted Markdown with pages, zoom, synchronization and page/all scope. Save Changes or Ctrl+S changes indexed text and its vectors, not the external original. Wait for acknowledgement. A save conflict retains the draft; Retry, Export or a deliberately confirmed discard/reload are separate choices. Failed reload or new typing during reload must not be treated as a successful discard.

Draft recovery can preserve acknowledged revisions after restart, but forced termination may lose later unacknowledged keystrokes. Keep the view open on a persistence/recovery error. Exporting a copy does not establish canonical save or by itself unblock a protected close.

Copy Markdown, Export Markdown and Export PDF use the editor's current content, including unsaved edits. A canceled dialog or failed export creates no confirmed copy. Open/review the output after success. Very large existing text can remain readable and fully exportable as Markdown while indexed save/conversion requires reducing it.

The vector inspector searches indexed passages with the chosen result count. The document-name list filter does not limit this independent search. Scores rank candidates; they are not correctness probabilities. No result does not prove absent information in unindexed content.

Deleting an indexed document requires its offered confirmation. It removes its document/vector entries, not the external original or every retained archive/copy. There is no general recycle-bin guarantee. Reimport if needed and remove stale chat selections. Preserve required exports before deletion.

## Ask questions and review sources (flows 08–10)

Select documents in LanceDB Context or attach them with @; refresh the list when required. With no selected documents, a chat request is not querying that corpus. Enter sends; Shift+Enter inserts a line. Prompt options and system-prompt customization affect the request.

Stop interrupts generation and leaves an incomplete response. If context is blocked/partial, a service unavailable or another feature holds the shared execution lock, resolve the cause and submit explicitly again.

Open the document-context details for a response to inspect previews/passages included, truncated or excluded and the actual text sent. This record concerns the current turn's document addition, not semantic corpus coverage, exact model token counts or all earlier conversation context. Older responses may lack the record. Narrow the selection/question when context is partial.

Distinguish model citations from retrieved-but-uncited candidates and unresolved references. Open Original Location compares a verified source position with the generated assertion. A verified position does not prove that the source supports the assertion or that the generated text is true. Copy citations/messages only after that review.

Reopen or rename stored conversations; New Chat starts another one and does not promise deletion of an earlier saved conversation. Conversation deletion may have no extra confirmation or recycle bin: copy what is needed first.

On history errors, Retry Save and keep the app open. A checkpoint precedes generation and periodic persistence follows streamed output. A recovered partial response is marked incomplete. Ordinary close waits for pending history saves; forced termination can lose post-checkpoint text.

## Translate text or layout (flows 11–13)

Choose Text/Markdown for extracted text and Layout-Preserved PDF/DOCX for a separate document copy. Select explicit source/target languages and a model. The two paths share one job lock; changing tabs does not cancel the active job.

For Markdown choose one page or the whole document, start, wait for completion, and review side-by-side/diff views with synchronized scroll, wrapping and zoom. Partial, refused or output-limited translations are not exportable. Changing source, languages or scope invalidates the earlier completed result. Markdown/PDF/DOCX exports from text rebuild content and are not the layout-preservation path.

For layout translation select a supported ingested PDF/DOCX and an explicit destination folder. Start and wait for the final outcome; Cancel requests interruption even before first progress, but connection loss is not proof of cancellation. The original remains unchanged.

Layout publication uses verified source-archive bytes and revision checks. Missing/corrupt/unreadable archives, stale revisions, unsupported structures, invalid markers and destination collisions are refused rather than silently replaced. Destinations must support hard links. Existing output is preserved on collision.

DOCX supports body, nested tables, hyperlinks and headers/footers; unsupported fields, textboxes, notes/comments and tracked revisions are refused. Images are retained without OCR in this path. PDF checks geometry/fonts/glyphs and saved Unicode text. Review resulting text/tables/layout yourself; historical small-corpus results do not qualify all documents, languages or Word rendering.

## Coding Agent workspaces and plans (flows 14–16)

The Coding Agent is experimental. Attach a workspace and verify Active Project, or use Standalone for its separate free-work folder. Canceling the picker does not select a project. Pin files or attach ingested documents deliberately.

Ask is read-only analysis without file changes or command execution. Guided reviews changing actions; Auto acts within the selected run profile. Mode and permissions are distinct.

Describe the objective, constraints and verification. Start Task executes according to the mode; Plan in Guided/Auto prepares decisions first. Answer structured questions, review scope/assumptions/files/checks/permissions, edit and save revisions, then Approve & Execute. A failed/incomplete preparation is not an approved running plan. New requests during a run can be queued; remove obsolete ones before execution.

Review each action-approval dialog's operation, reason and diff. Approve authorizes the displayed action; Reject need not stop the entire task. Stop is the separate interruption action.

After a crash, reopen the original conversation/workspace and explicitly Resume Task. An unknown action outcome blocks replay. Inspect Evidence before confirmed Abandon Execution; abandoning preserves request/evidence without retrying or undoing the action. Nothing automatically resumes at startup.

## Results, rollback and recovery (flows 17–19)

Inspect final evidence, modified files, Monaco diff and terminal output. Passed, Failed and Unavailable verification are different outcomes; an assistant's statement is not a command result.

Manual editor save checks disk revisions. Reload/Merge/Overwrite resolve a detected conflict only after review. Unsaved code-editor drafts and detected conflicts remain in memory when switching workspaces, entering standalone mode, closing a file tab or removing a project from the registry. Return to the folder and reopen the file to recover its draft. Save checks the retained disk revision before writing. These drafts do not survive closing the app; save them before exiting.

Stop retains edits already performed. Restore Previous State covers only the checkpoint's attributed files and can remove files created by the run. It is not a complete snapshot guarantee and does not reverse shell commands, installations or external changes, especially with Full Access. Inspect coverage and preserve needed files before restoring.

Project sessions and prompt history can be reopened/searched; review old requests before rerunning. Removing a project from the list does not delete its on-disk folder. Deleting session/history is separate from restoring workspace files.

On unreadable/unsavable history use Retry Storage and keep the view open. Export In-Memory Changes saves a separate copy only after successful dialog/result. Recovery banners can retry/export stored recovery records, restore an eligible session or retry a pending deletion. Incomplete preparation can disable retry/restore while still offering recovery export. A completed deletion may retain an export/restore record.

Exports do not acknowledge canonical persistence or automatically unblock protected close. If storage and recovery both fail, export/copy what is possible while keeping the view open.

## Skills and sources (flow 20)

Skill Hub can inspect/copy/edit installed instructions, restore an available original, delete after confirmation, import a SKILL.md URL, create a skill or install from a hub. Read external instructions before saving/installing. Removing a hub source does not necessarily remove its installed skills.

Agent discovery may propose an installation; Install/Reject are explicit choices. Installed does not mean active in every run: inspect Active Skills. Failed activation retains the earlier visible value; a successful skill write with failed activation is not a completed operation.

The current skill form lowercases comma-separated triggers/tags and trims outer body whitespace. Even an otherwise unchanged save can alter these values. Copy instructions and inspect the result; serializer tests do not prove lossless form editing.

## Settings, models and permissions (flows 21–24)

Preferences include interface language, wrapping, sounds, extended Excel ingestion size, translation output folder and system prompts. Removing an output-folder preference does not remove exports. Interface language and translation target language are separate. Wait for Settings Saved; Retry on errors before closing.

Choose same-PC Ollama or a known remote server and test connectivity. Opening the official download page or starting a process is not readiness. Remote mode sends prompts/documents to that endpoint.

The hardware/model wizard proposes assignments and estimates size. Missing/insufficient disk measurements can block downloads; estimates and fit badges do not certify quality, successful loading or task autonomy. Assign installed models to Coding, Chat/RAG, Translation, Vision/OCR and Embedding as needed. Native OCR displays a confirmed provider only after engine initialization, including fallback to CPU.

Update/download/unload/delete are distinct operations. Wait for an update before using that model; deleting weights requires its offered confirmation. Changing the embedding assignment does not rebuild an incompatible existing index automatically. Follow the separate backed-up maintenance procedure.

Permission defaults apply to future runs; saved current-plan permissions and active-run snapshots are separate. Limited profiles govern file changes, terminal commands, network/installations and other actions. Full Access in Guided/Auto bypasses contextual app gates and allows broader paths/commands; do not assume limited-profile command exclusions still apply. Ask remains read-only. Editing defaults does not retroactively constrain an already-running task.

## Diagnostics and logs (flow 25)

Use Console Log, Open Log Folder, Sidecar restart when unavailable, or Coding Agent diagnostics. Filter by text/level/module and copy a sanitized report. Clear Console empties its buffer; it does not fix the failure.

Debug logging applies to later runs and can include prompts, source code, responses and paths despite credential redaction. Inspect before sharing. Agent audit and ordinary application logs are separate. Clear Agent Log can act without a second confirmation; preserve needed evidence first and check the actual result.

About shows the built package baseline, not the runtime version of an external Ollama/Sidecar. Existing screenshots and diagrams are historical assets; this documentation revision does not claim new captures.

For startup, contracts, indexing and verification see the [developer guide](developer-guide.md). The [documentation index](README.md) maps each retained technical guide and historical evidence source.
