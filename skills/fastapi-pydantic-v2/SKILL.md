---
name: fastapi-pydantic-v2
description: "FastAPI standards, async endpoints, Pydantic v2 schemas, and dependency injection."
version: "1.4.0"
author: "Python Async WG"
triggers: ["fastapi", "python", "pydantic", "uvicorn", "async def"]
tags: ["python", "fastapi", "pydantic", "backend"]
origin_hub: "OnlyRag Official Core Hub"
origin_hub_id: "official-core"
origin_checksum: "0cd64eb18676512c"
is_modified: false
---

# FastAPI & Pydantic v2 Architecture

## 1. Async & Non-Blocking Execution
- Use `async def` for I/O bound endpoints that use asynchronous libraries.
- For blocking CPU operations or sync filesystem calls, execute them using `asyncio.to_thread(...)` to avoid stalling the event loop.

## 2. Schemas & Dependency Injection
- Define explicit request and response models with Pydantic v2 (`model_config = ConfigDict(...)`).
- Use FastAPI `Depends(...)` for database sessions, authentication, and service orchestration.
- Keep route handlers thin: validate the request, call an application service, and return the typed response.
- Use `HTTPException` with a stable `detail` shape for expected client errors; do not expose tracebacks or local paths.

## 3. Reliability & Testing
- Close database, document, and file resources in `finally` blocks, including when parsing or validation fails.
- Cover success, malformed input, missing resources, timeout, and downstream failure paths with pytest.
- Keep blocking CPU or filesystem work out of the event loop by delegating it to `asyncio.to_thread(...)`.
