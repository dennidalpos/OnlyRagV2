---
name: fastapi-pydantic-v2
description: Change OnlyRag Sidecar REST routes or Pydantic request and response schemas, including streaming ingestion, translation, search, and cancellation.
triggers: ["sidecar api", "fastapi", "pydantic", "api-rest", "sidecar/main.py", "sidecar/schemas.py"]
tags: ["rest contract", "sidecar"]
---

# Sidecar REST contracts

- Edit routes in `sidecar/main.py` and models in `sidecar/schemas.py`; update Main's client in `electron/core/infrastructure/http/sidecarHttpClient.ts` when the wire contract changes. Requests inherit `StrictRequest` with `extra="forbid"`; this rejects unknown fields but does not make every field type strict. Preserve explicit bounds, validators and `StrictBool` where used ([Pydantic 2.13.4 model reference](https://github.com/pydantic/pydantic/blob/v2.13.4/docs/concepts/models.md#extra-data)).
- Preserve the launch-token middleware for non-health requests and the configured CORS origin boundary. Validate inputs before filesystem or database work.
- Keep blocking service calls off the async route's event loop using the existing `asyncio.to_thread` pattern. Synchronous stream generators must retain thread-pool execution and NDJSON `progress`, `done`, `error` and `cancelled` outcomes ([FastAPI concurrency reference](https://fastapi.tiangolo.com/async/)).
- Preserve expected client failures as `HTTPException` and close opened documents on every outcome.
- After a contract change, regenerate and review `sidecar/contracts/openapi-2.5.0.json` with the isolated-data procedure in [verification commands](../code-quality-and-linting/SKILL.md). Check `sidecar/tests/test_contracts.py`, `sidecar/tests/test_openapi_contract.py` and `sidecar/tests/test_launch_token.py`, plus affected clients. [api-rest.md](../../docs/api-rest.md) describes the public contract; a health response is not authentication for another route.
