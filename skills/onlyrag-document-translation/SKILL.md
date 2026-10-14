---
name: onlyrag-document-translation
description: Change OnlyRag Markdown or PDF/DOCX translation, protected markers, reinsertion, streaming progress, or cancellation.
triggers: ["document translation", "translate-inplace-stream", "pdf translation", "docx translation", "translation markers", "useTranslation.ts"]
tags: ["translation", "translator"]
---

# Document translation

- Trace `src/hooks/useTranslation.ts` through `sidecarHttpClient.ts` to `POST /documents/{doc_id}/translate-inplace-stream` and `sidecar/domain/translator.py`. Keep Markdown translation and PDF/DOCX output handling distinct.
- Keep `TranslateInplaceRequest` in `sidecar/schemas.py` aligned with the stream: required `source_lang`, `target_lang`, `model`; optional `target_dir`, `num_ctx`, `think`, `task_id`.
- Preserve the source PDF/DOCX. Emit a new output file only after all translated segments and protected markers validate; a partial, cancelled or rejected result must not be exportable.
- Validate literal values, identifiers, contacts and required-field/footnote markers before reinsertion. For PDF, check glyph coverage and geometry before redaction and verify saved Unicode text.
- Keep NDJSON `progress`, `done`, `error` and `cancelled` outcomes and bind cancellation to `POST /tasks/cancel`. Check unmount ownership when changing the hook.
- Run targeted tests in `sidecar/tests/test_translator.py`, `src/hooks/useTranslation.test.ts` and `src/hooks/useTranslationOwnership.test.tsx` as applicable. Use `docs/translation.md` for acceptance limits.
