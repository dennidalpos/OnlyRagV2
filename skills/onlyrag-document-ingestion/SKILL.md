---
name: onlyrag-document-ingestion
description: Change OnlyRag document ingestion, PDF OCR, optional LLM normalization, tabular extraction, retained originals, or reindexing.
triggers: ["document ingestion", "ingest-path-stream", "vision ocr", "normalization review", "tabular ingestion", "reindex document"]
tags: ["ingestion", "ocr"]
---

# Document ingestion

- Trace Renderer `src/hooks/useIngestion.ts` through `electron/core/infrastructure/http/sidecarHttpClient.ts` to `POST /ingest-path-stream` in `sidecar/main.py` and `sidecar/services/ingest_service.py`.
- Use `IngestPathRequest` in `sidecar/schemas.py` as the REST field/limit reference. REST permits an omitted `task_id`, but the application's streaming IPC/client contract requires `taskId`/`task_id`; allocate it before sending and retain cancellation ownership.
- Require `normalization_model` when `normalize_with_llm` is true. On review rejection or inadequate context, return the original extraction and leave it unindexed.
- Check the actual hook payload before adding a normalization UI path: `useIngestion.ts` currently sends `normalizeWithLlm: false`; the REST capability alone does not expose that choice in ordinary ingestion.
- Read native OCR facts from `sidecar/infrastructure/ocr.py` and `src/lib/ocrProvider.ts`. Confirm CUDA/CPU from the initialized ONNX sessions, not GPU presence or available providers. `unknown` before initialization or for mixed/unreadable sessions must remain pending in the UI, including when the Sidecar is online.
- Retain a verifiable original under `data/source-documents/<doc_id>` before extraction. Preserve the coordinated document/chunk commit and `data/document-recovery.json` recovery gate.
- Bound CSV, TSV, Parquet, XLSX and XLS extracts; report omitted data. Treat `allow_full_excel_format` as a single-ingestion option, not permission for an unbounded indexed extract.
- Keep cancellation bound to `task_id` through `POST /tasks/cancel`; close PDF and spreadsheet resources on failure.
- Select regressions for the affected boundary: normalization/tabular/recovery tests under `sidecar/tests/`, `sidecar/tests/test_ocr_engine.py` for provider initialization, and `src/hooks/useIngestionOcrProvider.test.tsx` or `src/hooks/useIngestion.test.ts` for the UI. Use [ingestion.md](../../docs/ingestion.md) for current limits and [verification commands](../code-quality-and-linting/SKILL.md) for invocation details.
