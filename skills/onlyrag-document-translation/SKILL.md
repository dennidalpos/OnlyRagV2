---
name: onlyrag-document-translation
description: Change OnlyRag Markdown or PDF/DOCX translation, protected markers, reinsertion, streaming progress, or cancellation.
triggers: ["document translation", "translate-inplace-stream", "pdf translation", "docx translation", "translation markers", "useTranslation.ts"]
tags: ["translation", "translator"]
---

# Document translation

- Trace `src/hooks/useTranslation.ts` through `electron/core/infrastructure/http/sidecarHttpClient.ts` to `POST /documents/{doc_id}/translate-inplace-stream` and `sidecar/domain/translator.py`. Keep Markdown translation and PDF/DOCX output handling distinct.
- Use `TranslateInplaceRequest` in `sidecar/schemas.py` as the wire-field reference. Its optional REST `task_id` does not relax the application's required streaming task identity.
- Preserve the source PDF/DOCX. Keep the staged output validation and exclusive final publication implemented by `sidecar/infrastructure/translation_output.py`; never replace it with an exists-then-save sequence or a partial-copy fallback. A rejected or cancelled translation must not expose a partial output.
- Validate literal values, identifiers, contacts and required-field/footnote markers before reinsertion. For PDF, check glyph coverage and geometry before redaction and verify saved Unicode text.
- For DOCX coverage, inspect supported XML stories and runs rather than assuming visible text is limited to body paragraphs. Preserve header/footer and nested-table coverage and explicit refusal of unsupported containers or mixed text/graphics runs; see `sidecar/tests/test_translation_docx_coverage.py`.
- Keep NDJSON `progress`, `done`, `error` and `cancelled` outcomes and bind cancellation to `POST /tasks/cancel`. Check unmount ownership when changing the hook.
- Select `sidecar/tests/test_translator.py` for translation behavior, `sidecar/tests/test_translation_output.py` for exclusive publication/failures, and the translation hook/ownership tests in `src/hooks/` for streaming lifetime. Use [translation.md](../../docs/translation.md) for acceptance limits and [verification commands](../code-quality-and-linting/SKILL.md) for invocation details.
