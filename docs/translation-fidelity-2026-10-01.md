# Scanned document translation fidelity: 2026-10-01

The reported layout translation mixed three failures: NumPy OCR coordinates reached PyMuPDF as a non-native font size, OCR enhancement damaged an italic instruction line, and reconstruction erased a handwritten signature while the model changed delivery terminology. Translation must preserve every source clause; retrieval and summarization are not used by the layout translator. The Markdown translator also sends all selected document chunks, rather than a retrieval shortlist.

## Changes and deterministic guarantees

- Layout OCR keeps the original contrast and returns individual regions with native float coordinates and confidence. Detected uncertain colored marks remain graphics. Printed regions below 0.8 confidence, unreadable replacement characters, and image pages with no recognized text stop the export for review. Blank native pages can still be skipped.
- Recognized separate form values remain visible in the original scan and get an invisible searchable text layer. Contacts, dates, numeric identifiers, recognized postal addresses and company/product names are masked and must each survive exactly once. Postal address masking leaves adjoining delivery instructions available for translation.
- Required-field asterisks stay visible to the model and are counted after translation. Masking them caused the model to treat short labels as identifiers; isolated abbreviations can also be mistranslated without context. Short Latin labels no longer bypass translation based on unreliable statistical language detection.
- Batch segments use the standard XML parser. Duplicate IDs, missing segments, invalid content and failed entity validation use the existing individual fallback; an unsuccessful fallback produces an error. Empty output or refusals cannot silently reuse untranslated source text. Actual document notes are retained.
- All text placements are checked before redaction, and reinsertion is checked for overflow and complete extracted text. Only original OCR line regions are erased. Vector artwork stays intact; colored autograph ink intersecting a printed label is restored separately. An export that cannot fit its content fails rather than omitting a block.
- The layout instructions and default Markdown preset require complete sentence and clause translation, unchanged literal values, and preservation of alternatives, conditions, obligations and delivery evidence. They prohibit synthesis and invented readings of signatures. Saved custom prompts and settings were not modified.
- Existing exports and the original source are preserved; a repeated export gets a unique filename. IPC/API schemas, dependencies, application retry counts, timeouts and other safeguards are unchanged.

## Actual local document comparison

The original one-page raster PDF and the previously translated PDF were inspected visually and through OCR/text extraction. The final production-path run used local `qwen3.5:9b`, `think=false`, and `num_ctx=32768`, with an isolated temporary Sidecar data directory. No response was mocked or manually substituted. The final run made six Ollama calls and completed extraction, translation, reconstruction and saving.

Evidence is outside the repository, under `%USERPROFILE%/OnlyRag-Live/translation-fidelity-20261001-95fd936f`: `ollama-calls.json`, `manifest.json`, `extracted-text.txt`, and the full-page Poppler render `translated.png`. The output is under `%USERPROFILE%/Downloads/OnlyRag-translation-20261001-95fd936f`. Personal document text and model wire data are not committed to the repository.

The compared output contains both original email contacts, all postal delivery alternatives, the complete device-return instructions, source form values and the blue signature. The postal-code and province labels are translated. SHA-256 readback confirmed that the source and previous translation were unchanged. Source digest: `c06f2b100f8a786520aceaf6214737d1fea83020c6bd6b70c675d951c78cf3f5`; previous-output digest: `1d6ab197689aaf922d48a63201cf1ecd8cbaf63ad87ba0b587e54d9086329152`.

Earlier failed/imperfect runs are retained in the sibling evidence directories ending `f66b8780`, `806e5afe`, `cedd2986`, `333a74ca`, `0efd45ef`, and `b826061a`. The configured `llama3.2:3b` was observed changing names and replacing registered delivery with air mail; it is not qualified by these deterministic tests. Saved translation-model settings were left unchanged.

## Verification and remaining limits

Before the fidelity edits, the full Sidecar baseline passed 155 tests. After the changes:

- `.venv\Scripts\python.exe -X utf8 -m pytest -q`: **176 passed in 18.33s**.
- Targeted Vitest execution of `promptPresets.test.ts`, `useTranslationHooks.test.tsx`, and `TranslationView.test.tsx`: **3 files / 19 tests passed**.
- `npm run test:fast`: **288 files / 2335 tests passed in 138.98s**.
- `npm run typecheck`, `npm run build`, `npm run quality:static`, `npm run audit:deadcode`, and `npm run audit:cycles`: exit 0. The cycle audit reported no circular dependencies.
- `npm run docs:check`: **26 Markdown files checked**; `npm run format:check`: exit 0.

These tests verify transport/data/rendering invariants, not universal semantic equivalence. The final model output says “registered mail a.r.”: it preserves the source receipt abbreviation instead of expanding it into English. A separate real `think=true` probe on that paragraph exceeded both existing 120-second attempts and returned no translation; thinking mode is not verified for this scenario. No application timeout was increased.

OCR can miss undetected regions or assign high confidence to incorrect text. The colored-ink heuristic does not certify every handwriting style or distinguish every colored printed label. A scanned blank image page may conservatively require review. Identical source/target form labels containing an asterisk may also require review. Postal/name masking is limited to recognized patterns. Further documents, languages, custom prompts and models still need comparison against their originals; a successful export is not proof of complete semantic fidelity.

The running preexisting desktop session was not restarted. The PDF comparison used the changed production Python path directly; it is not a new desktop UI end-to-end qualification.

## Session handoff

The user requested saving, committing and pushing this work on the principal branch before changing sessions. The branch is `master`. `PROJECT_STATUS.json` retains the previous coding-agent backlog and adds `TRANSLATION-FIDELITY-LIVE-01` for the remaining translation qualification; completed structural fixes are not listed as unfinished.

Resume from the verified output and wire evidence in the directory ending `95fd936f`. Diagnostic OCR trials, the original/earlier-output renders and the temporary runner snapshots were archived into its `diagnostics` directory; the owned repository scratch directory was removed. The runner snapshots were captured from `.cache/translation-fidelity`, so their repository-relative import setup needs adjustment if replayed from the archive. Keep the failed and imperfect runs as evidence.

The accepted requirement is complete sentence and clause translation with no synthesis, omitted alternatives or invented readings of signatures. The user selected installed `qwen3.5:9b` for the local verification, explicitly with saved app settings unchanged. Do not silently switch the configured translation model, overwrite either input PDF, or claim universal semantic qualification. A new desktop invocation is needed to verify the changed Sidecar through the UI; do not terminate preexisting user processes.

The remaining postal abbreviation issue needs a new evidence-informed strategy: stronger instructions alone did not expand `a.r.` and the thinking probe timed out twice. Preserve the application's existing two attempts and 120-second timeout. Further document comparisons and desktop UI qualification remain open. The earlier coding-agent diagnosis and its attempt limits are separate and remain recorded in the existing tracker entries.
