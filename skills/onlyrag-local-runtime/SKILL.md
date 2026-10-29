---
name: onlyrag-local-runtime
description: Diagnose OnlyRag Electron and Sidecar startup, local health, profile isolation or ownership of processes listening on the Sidecar port.
triggers: ["sidecar startup", "sidecar ownership", "sidecar health", "dev bootstrap", "sidecar-ownership.json", "python sidecar", "avvio sidecar", "diagnostica sidecar"]
tags: ["local runtime", "sidecar lifecycle"]
---

# Local runtime lifecycle

- `electron/main.ts` imports `electron/appIdentity.ts` before services can resolve storage. The E2E harness uses `ONLYRAG_E2E_TEST=1` and `ONLYRAG_E2E_USER_DATA` before application imports; headless `userDataRoot` otherwise selects `userdata_dev`. Pass the owned root as `ONLYRAG_DATA_DIR` before Python imports as well.
- Follow `electron/core/infrastructure/process/sidecarProcessManager.ts`: development resolves source Python; packaged execution resolves the bundled Sidecar. Dependency auto-setup can install runtime requirements into a venv; it does not establish that pytest or development tools are available. `npm run setup:dev` also installs dependencies and the Electron runtime, so it is not a read-only probe.
- Concurrent starts share the pending startup promise. Failed health while preparation/readiness remains pending is `checking`; failure after startup settles is `offline`. Keep these states distinct through the diagnostics IPC and renderer.
- A listener or ownership-marker file alone does not establish ownership. Retain PID, executable path and process-creation-time matching before reclaiming a port; require a fresh marker for a restarted process. Do not stop an unrelated service merely because it listens on port 8000.
- Preserve the launch token in Main-to-Sidecar requests. `/health` is the unauthenticated exception, not proof that ingestion/export/search requests may omit the token. OCR provider and host GPU are separate health facts; see [ingestion](../onlyrag-document-ingestion/SKILL.md).
- Start with `electron/core/infrastructure/process/sidecarProcessManager.test.ts` using [verification commands](../code-quality-and-linting/SKILL.md). `npm run test:e2e:sidecar-ownership` uses owned native fixture processes; run it only when that lifecycle boundary needs validation.
- `npm run dev` starts the actual development environment; it is not an isolated diagnostic. `ONLYRAG_E2E_TEST=1` suppresses automatic Sidecar startup, so that harness cannot certify automatic startup. See [operations.md](../../docs/operations.md) for setup, synthetic UX tests and optional configured-model smoke procedures.
