# Documentazione OnlyRag V2

Documentazione tecnica breve, verificata contro il codice. I contratti prevalgono sulle descrizioni:

- IPC: contratto in [`../shared/ipc/ipcContract.ts`](../shared/ipc/ipcContract.ts), Preload in [`../electron/preload.ts`](../electron/preload.ts), handler in [`../electron/core/presentation/`](../electron/core/presentation/).
- REST: [`../sidecar/main.py`](../sidecar/main.py), schemi in [`../sidecar/schemas.py`](../sidecar/schemas.py) e OpenAPI in [`../sidecar/contracts/openapi-2.5.0.json`](../sidecar/contracts/openapi-2.5.0.json).
- Comandi: [`../package.json`](../package.json).

## Ambiti

| Ambito | Documento |
| --- | --- |
| Architettura e confini | [`architecture.md`](./architecture.md) |
| Electron Main e processi | [`electron-main.md`](./electron-main.md) |
| Renderer React | [`frontend.md`](./frontend.md) |
| Coding Agent (Panoramica) | [`agent.md`](./agent.md) |
| Agent Runtime e orchestrazione | [`agent-runtime.md`](./agent-runtime.md) |
| Agent Guardrail e progresso | [`agent-guards.md`](./agent-guards.md) |
| Agent Diagnostica e auto-healing | [`agent-diagnostics.md`](./agent-diagnostics.md) |
| IPC | [`api-ipc.md`](./api-ipc.md) |
| REST Sidecar | [`api-rest.md`](./api-rest.md) |
| RAG, OCR e traduzione | [`rag-sidecar.md`](./rag-sidecar.md) |
| Setup, test e release | [`operations.md`](./operations.md) |
| Dipendenze | [`libraries.md`](./libraries.md) |
| Decisioni non ovvie | [`decisions.md`](./decisions.md) |
| Verifica e limiti noti | [`verification.md`](./verification.md) |
| Backlog | [`../PROJECT_STATUS.json`](../PROJECT_STATUS.json) |

## Regole

- Non duplicare payload o versioni qui: aggiornare prima codice, tipi o OpenAPI.
- `npm run docs:check` controlla link locali e comandi `npm run` in `docs/`, `README.md` e `skills/`.
- Aggiornare la pagina dell'ambito interessato; evitare di riaprire diari storici o note duplicate.

## Lettura rapida

- Nuovo contributore: [`operations.md`](./operations.md) → [`architecture.md`](./architecture.md).
- Coding Agent: [`agent.md`](./agent.md) ([`agent-runtime.md`](./agent-runtime.md), [`agent-guards.md`](./agent-guards.md), [`agent-diagnostics.md`](./agent-diagnostics.md)) → [`api-ipc.md`](./api-ipc.md) → [`verification.md`](./verification.md).
- Sidecar: [`rag-sidecar.md`](./rag-sidecar.md) → [`api-rest.md`](./api-rest.md).
