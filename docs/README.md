# Documentazione OnlyRag V2

Documentazione tecnica breve, verificata contro il codice. I contratti prevalgono sulle descrizioni:

- IPC: [`../electron/preload.ts`](../electron/preload.ts), handler in [`../electron/core/presentation/`](../electron/core/presentation/) e tipi in [`../shared/types/index.ts`](../shared/types/index.ts).
- REST: [`../sidecar/main.py`](../sidecar/main.py), schemi in [`../sidecar/schemas.py`](../sidecar/schemas.py) e OpenAPI in [`../sidecar/contracts/openapi-2.3.0.json`](../sidecar/contracts/openapi-2.3.0.json).
- Comandi: [`../package.json`](../package.json).

## Ambiti

| Ambito | Documento |
| --- | --- |
| Architettura e confini | [`architecture.md`](./architecture.md) |
| Electron Main e processi | [`electron-main.md`](./electron-main.md) |
| Renderer React | [`frontend.md`](./frontend.md) |
| Coding Agent | [`agent.md`](./agent.md) |
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
- Ogni link locale e comando `npm run` documentato deve passare `npm run docs:check`.
- Aggiornare la pagina dell'ambito interessato; evitare di riaprire diari storici o note duplicate.

## Lettura rapida

- Nuovo contributore: [`operations.md`](./operations.md) → [`architecture.md`](./architecture.md).
- Coding Agent: [`agent.md`](./agent.md) → [`api-ipc.md`](./api-ipc.md) → [`verification.md`](./verification.md).
- Sidecar: [`rag-sidecar.md`](./rag-sidecar.md) → [`api-rest.md`](./api-rest.md).
