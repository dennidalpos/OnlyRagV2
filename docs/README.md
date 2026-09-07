# OnlyRag V2 — Indice della Documentazione

Questa directory costituisce l'unica fonte di verità (*source of truth*) tecnica e architetturale del repository OnlyRag V2. La documentazione è strutturata in modo modulare per ambiti di competenza verticali, sintetici e pratici.

---

## 1. Mappa dei Documenti per Ambito

| Ambito | Documento Canonico | Descrizione |
| :--- | :--- | :--- |
| **Architettura Generale** | [`architecture.md`](./architecture.md) | Topologia multi-processo, Clean Architecture a 4 layer, Resource Coordinator e RAG flow. |
| **Autonomous Coding Agent** | [`agent.md`](./agent.md) | Tool calling loop, circuit breakers, loop detector, authority milestone e compattazione memoria. |
| **Razionali ed Evidenze** | [`code-rationales.md`](./code-rationales.md) | Diario delle evidenze empiriche, lezioni storiche delle live session e psicologia degli SLM compatti. |
| **Pipeline RAG & Sidecar** | [`rag-sidecar.md`](./rag-sidecar.md) | Python FastAPI Sidecar, LanceDB embedded, OCR/Vision (RapidOCR vs LLM) e traduzione in-place. |
| **Electron Main Process** | [`electron-main.md`](./electron-main.md) | Struttura dei 4 layer Main, isolamento con `shared/`, gestione processi (PowerShell, sidecar :8000). |
| **Frontend React 19** | [`frontend.md`](./frontend.md) | Architettura Renderer, Zustand stores, core hooks, Monaco Editor e virtualizzazione timeline. |
| **Contratti IPC** | [`api-ipc.md`](./api-ipc.md) | Riferimento verificato e completo di tutti i 96 canali IPC Main-Renderer. |
| **REST API Sidecar** | [`api-rest.md`](./api-rest.md) | Riferimento degli endpoint REST del FastAPI Sidecar (`http://127.0.0.1:8000`). |
| **Operazioni & Quality Gates** | [`operations.md`](./operations.md) | Prerequisiti ambiente, setup, catalogo comandi verificati, script PowerShell e packaging NSIS. |
| **Dipendenze & Librerie** | [`libraries.md`](./libraries.md) | Dipendenze esterne vs implementazioni di dominio pure, audit licenze e sicurezza. |
| **Backlog di Sviluppo** | [`../PROJECT_STATUS.json`](../PROJECT_STATUS.json) | Backlog canonico delle attività completate e pianificate. |

---

## 2. Regole di Manutenzione e Vincoli Contrattuali

- **Specifiche OpenAPI Sidecar**: Il contratto OpenAPI machine-readable è versionato in [`../sidecar/contracts/openapi-2.3.0.json`](../sidecar/contracts/openapi-2.3.0.json). Si rigenera con `npm run generate:openapi` e si audita con `npm run test:sidecar`.
- **Integrità dei Comandi e Link**: Ogni comando documentato deve esistere in [`../package.json`](../package.json). Il comando `npm run docs:check` valida automaticamente l'assenza di broken link e la validità dei comandi `npm run`.
- **Riferimento Contratti**: [`api-ipc.md`](./api-ipc.md) e [`api-rest.md`](./api-rest.md) governano i contratti di interfaccia. Gli altri documenti descrivono il comportamento senza definire payload concorrenti.

---

## 3. Percorsi di Lettura Consigliati

- **Nuovo Contributore**: [`operations.md`](./operations.md) → [`architecture.md`](./architecture.md) → [`agent.md`](./agent.md).
- **Integrazione API & IPC**: [`api-ipc.md`](./api-ipc.md) → [`api-rest.md`](./api-rest.md).
- **Coding Agent Maintainer**: [`agent.md`](./agent.md) → [`code-rationales.md`](./code-rationales.md) → [`electron-main.md`](./electron-main.md).
- **RAG & Search Specialist**: [`rag-sidecar.md`](./rag-sidecar.md) → [`api-rest.md`](./api-rest.md).
- **Quality & Release Engineer**: [`operations.md`](./operations.md) → [`libraries.md`](./libraries.md).
