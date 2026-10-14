---
name: fastapi-pydantic-v2
description: Change OnlyRag Sidecar REST routes or Pydantic request and response schemas, including streaming ingestion, translation, search, and cancellation.
triggers: ["sidecar api", "fastapi", "pydantic", "api-rest", "sidecar/main.py", "sidecar/schemas.py"]
tags: ["rest contract", "sidecar"]
---

# Sidecar REST contracts

- Edit routes in `sidecar/main.py` and strict request/response models in `sidecar/schemas.py`; update Main's client in `electron/core/infrastructure/http/sidecarHttpClient.ts` when the wire contract changes.
- Preserve the launch-token middleware for non-health requests and the configured CORS origin boundary. Validate inputs before filesystem or database work.
- Use `asyncio.to_thread` for blocking handlers. Keep synchronous streaming generators off the event loop and preserve their NDJSON `progress`, `done`, `error` and `cancelled` outcomes.
- Return expected client failures as `HTTPException`; do not expose traces or local paths from unhandled errors. Close opened documents on every outcome.
- After a contract change, run `npm run generate:openapi`, targeted pytest, and `npm run docs:check`.
