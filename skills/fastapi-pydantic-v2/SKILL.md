---
name: fastapi-pydantic-v2
description: Change OnlyRag Sidecar REST routes or Pydantic request and response schemas, including streaming ingestion, translation, search, and cancellation.
triggers: ["sidecar api", "fastapi", "pydantic", "api-rest", "sidecar/main.py", "sidecar/schemas.py"]
tags: ["rest contract", "sidecar"]
---

# Sidecar REST contracts

- Edit routes in `sidecar/main.py` and models in `sidecar/schemas.py`; update Main's client in `electron/core/infrastructure/http/sidecarHttpClient.ts` when the wire contract changes. Requests inherit `StrictRequest` with `extra="forbid"`; this rejects unknown fields but does not make every field type strict. Preserve explicit bounds, validators and `StrictBool` where used ([Pydantic model reference](https://docs.pydantic.dev/latest/concepts/models/#extra-data)).
- Preserve the launch-token middleware for non-health requests and the configured CORS origin boundary. Validate inputs before filesystem or database work.
- Keep blocking service calls off the async route's event loop using the existing `asyncio.to_thread` pattern. Synchronous stream generators must retain thread-pool execution and NDJSON `progress`, `done`, `error` and `cancelled` outcomes ([FastAPI concurrency reference](https://fastapi.tiangolo.com/async/)).
- Preserve expected client failures as `HTTPException` and close opened documents on every outcome.
- After a contract change, run `npm run generate:openapi`, review `sidecar/contracts/openapi-2.5.0.json`, then run targeted pytest and `npm run docs:check`. See [verification commands](../code-quality-and-linting/SKILL.md) for the deterministic pytest invocation and the `test:sidecar` wrapper.
