---
name: fastapi-pydantic-v2
description: Sidecar endpoint and schema rules for OnlyRag V2.
---

# FastAPI Sidecar

- Define routes in `sidecar/main.py` and request/response models in `sidecar/schemas.py`.
- Keep handlers thin and move blocking CPU or filesystem work to `asyncio.to_thread`.
- Return typed responses and `HTTPException` for expected client errors; do not leak traces or local paths.
- Close documents and files on every outcome.
- Regenerate OpenAPI with `npm run generate:openapi` after a REST contract change and verify with `npm run test:sidecar`.
