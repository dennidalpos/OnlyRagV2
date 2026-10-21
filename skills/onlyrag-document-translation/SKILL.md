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
- Keep NDJSON `progress`, `done`, `error` and `cancelled` outcomes and bind cancellation to `POST /tasks/cancel`. Check unmount ownership when changing the hook.
- Run targeted tests in `sidecar/tests/test_translator.py`, `src/hooks/useTranslation.test.ts` and `src/hooks/useTranslationOwnership.test.tsx` as applicable. Use [translation.md](../../docs/translation.md) for acceptance limits and [verification commands](../code-quality-and-linting/SKILL.md) for invocation details.
