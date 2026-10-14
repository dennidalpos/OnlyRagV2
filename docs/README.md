# Documentazione OnlyRag V2

Le guide descrivono il comportamento verificato nel codice al **13 ottobre 2026**. Per API e comandi prevalgono [`shared/ipc/ipcContract.ts`](../shared/ipc/ipcContract.ts), [`sidecar/main.py`](../sidecar/main.py), [`sidecar/schemas.py`](../sidecar/schemas.py) e [`package.json`](../package.json). Il lavoro aperto è nel [`tracker`](../PROJECT_STATUS.json).

## Guide per ambito

| Ambito | Guida |
| --- | --- |
| Architettura e confini | [`architecture.md`](./architecture.md) |
| Renderer, Main e contratti | [`frontend.md`](./frontend.md), [`electron-main.md`](./electron-main.md), [`api-ipc.md`](./api-ipc.md), [`api-rest.md`](./api-rest.md) |
| Ingestion, OCR e originali | [`ingestion.md`](./ingestion.md) |
| Embedding e ricerca | [`retrieval.md`](./retrieval.md) |
| Traduzione | [`translation.md`](./translation.md) |
| Coding Agent | [`coding-agent.md`](./coding-agent.md) |
| Setup, comandi e dati protetti | [`operations.md`](./operations.md) |
| Dipendenze | [`libraries.md`](./libraries.md) |
| Distribuzione locale | [`distribution.md`](./distribution.md) |
| Verifica attuale e limiti | [`verification-current.md`](./verification-current.md) |

## Specifiche e prove conservate

La verifica del repository del 14 ottobre 2026 è in [`repository-audit-2026-10-14.md`](./repository-audit-2026-10-14.md).

[`model-task-baselines.md`](./model-task-baselines.md), [`model-runtime-fit.md`](./model-runtime-fit.md) e [`content-acceptance.md`](./content-acceptance.md) definiscono profili e corpus con i loro limiti. [`agent-runtime.md`](./agent-runtime.md), [`agent-guards.md`](./agent-guards.md) e [`agent-diagnostics.md`](./agent-diagnostics.md) contengono dettagli del Coding Agent. [`distribution-licenses.md`](./distribution-licenses.md), [`distribution-cpu-release.md`](./distribution-cpu-release.md) e [`distribution-agpl-proposal.md`](./distribution-agpl-proposal.md) conservano inventari, decisioni e hash dei candidati.

[`verification.md`](./verification.md), [`rag-sidecar.md`](./rag-sidecar.md), [`agent-runtime.md`](./agent-runtime.md) e [`libraries.md`](./libraries.md) mantengono gli ancoraggi dei link precedenti e rinviano agli archivi datati. Audit e revisioni di corpus sono **evidenze**, non descrizioni correnti: [`repository-residue-audit-2026-10-05.md`](./repository-residue-audit-2026-10-05.md), [`critical-app-audit-2026-10-01.md`](./critical-app-audit-2026-10-01.md), [`reliability-audit-2026-09-30.md`](./reliability-audit-2026-09-30.md), [`reliability-audit-2026-10-01.md`](./reliability-audit-2026-10-01.md), [`coding-agent-audit-2026-09-26.md`](./coding-agent-audit-2026-09-26.md), [`request-ledger-human-review-2026-10-10.md`](./request-ledger-human-review-2026-10-10.md), [`translation-language-audit-2026-10-13.md`](./translation-language-audit-2026-10-13.md) e [`translation-fidelity-2026-10-01.md`](./translation-fidelity-2026-10-01.md).

[`prompt_test_sequenza.txt`](./prompt_test_sequenza.txt) è un input di prova congelato. [`licenses/`](./licenses/) conserva testi, attribuzioni e inventari di licenza; [`DISTRIBUTION-LICENSE.md`](../DISTRIBUTION-LICENSE.md) è la nota destinata al pacchetto. Le skill locali in [`skills/`](../skills/) sono istruzioni eseguibili, controllate con la documentazione.

`npm run docs:check` controlla link locali, ancoraggi Markdown e comandi `npm run`. Una prova offline, un PDF esportato o un build riuscito non equivalgono a qualifica semantica o dell'app installata.

Le vecchie panoramiche `agent.md` e `decisions.md`, duplicate rispetto alle guide per ambito, sono state ritirate; l'audit datato conserva il riferimento alla seconda.
