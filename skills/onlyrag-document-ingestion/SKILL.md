---
name: onlyrag-document-ingestion
description: Change OnlyRag document ingestion, PDF OCR, optional LLM normalization, tabular extraction, retained originals, or reindexing.
triggers: ["document ingestion", "ingest-path-stream", "vision ocr", "normalization review", "tabular ingestion", "reindex document"]
tags: ["ingestion", "ocr"]
---

# Document ingestion

- Trace Renderer `src/hooks/useIngestion.ts` through Main's `sidecarHttpClient.ts` to `POST /ingest-path-stream` in `sidecar/main.py` and `sidecar/services/ingest_service.py`.
- Keep `IngestPathRequest` in `sidecar/schemas.py` aligned with the stream: `file_path`, optional `task_id`, Vision OCR fields, normalization fields, shared `num_ctx`, tabular limits, `allow_full_excel_format` and `embedding_model`.
- Require `normalization_model` when `normalize_with_llm` is true. On review rejection or inadequate context, return the original extraction and leave it unindexed.
- Retain a verifiable original under `data/source-documents/<doc_id>` before extraction. Preserve the coordinated document/chunk commit and `data/document-recovery.json` recovery gate.
- Bound CSV, TSV, Parquet, XLSX and XLS extracts; report omitted data. Treat `allow_full_excel_format` as a single-ingestion option, not permission for an unbounded indexed extract.
- Keep cancellation bound to `task_id` through `POST /tasks/cancel`; close PDF and spreadsheet resources on failure.
- Run targeted tests in `sidecar/tests/test_normalization_ingestion.py`, `test_tabular_ingestion.py`, `test_document_recovery.py` and `src/hooks/useIngestion.test.ts` as applicable.
