# Documentazione OnlyRag V2

Per iniziare dall'app segui la [guida utente](./guida-utente.md); per preparare il checkout usa [setup e operazioni](./operations.md). Il [README GitHub](../README.md) presenta funzionalità, avvio rapido, schermate e limiti.

## Guide per ambito

| Per chi / obiettivo | Documento |
| --- | --- |
| Utilizzatori: scelte e flussi desktop | [Guida utente](./guida-utente.md) |
| Manutentore: setup, comandi, profili e recupero | [Guida sviluppatori in inglese](./developer-guide.md), [operazioni](./operations.md), [conservazione dei test](./test-storage.md) |
| Architettura e responsabilità | [Architettura](./architecture.md), [Renderer](./frontend.md), [Main](./electron-main.md) |
| Contratti tra processi | [IPC](./api-ipc.md), [REST](./api-rest.md) |
| Documenti, ricerca e lingue | [Ingestion/OCR](./ingestion.md), [embedding e fonti](./retrieval.md), [traduzione](./translation.md) |
| Coding Agent | [Uso e confini](./coding-agent.md), [runtime](./agent-runtime.md), [guard](./agent-guards.md), [diagnostica](./agent-diagnostics.md) |
| Modelli e stime di memoria | [Runtime fit](./model-runtime-fit.md) |
| Dipendenze e candidati locali | [Librerie](./libraries.md), [distribuzione](./distribution.md) |
| Verifiche registrate e relativi limiti | [Stato delle verifiche](./verification-current.md) |
| Decisioni della fase locale | [Politica del 20 ottobre](./local-development-policy-2026-10-20.md), [direttive del repository](../AGENTS.md) |
| Risultati datati e riferimenti conservati | [Indice storico](./history.md) |
| Schermate dell'app | [Provenienza e limiti degli asset](./assets/screenshot-provenance.md) |

## Come usare le fonti

Le guide descrivono il prodotto; i rapporti datati attestano soltanto i casi, la revisione e l'ambiente indicati. I riferimenti storici trasferiti nel dossier privato conservano gli ancoraggi esistenti e non sono guide di avvio. Il tracker interno e i passaggi operativi di sessione sono gestiti in SecondBrain.

- [package.json](../package.json), lockfile e [requisiti Python](../sidecar/requirements-dev.txt) identificano comandi e dipendenze effettivi.
- [Contratto IPC](../shared/ipc/ipcContract.ts), [route REST](../sidecar/main.py) e [schemi](../sidecar/schemas.py) definiscono i confini implementati.
- [OpenAPI](../sidecar/contracts/openapi-2.5.0.json) e asset dell'app hanno generatori: [operazioni](./operations.md#file-generati-e-documenti-congelati) ne distingue uso e rigenerazione. I blocchi gestiti di AGENTS.md seguono SecondBrain Sync.
- Le istruzioni di sviluppo specifiche del repository sono nel dossier SecondBrain; le skill installate dal Coding Agent nei workspace sono una funzionalità separata del prodotto.

`npm run docs:check` controlla collegamenti locali, ancoraggi, nomi degli script npm e il sottoinsieme Mermaid supportato dal validatore. Non esegue rendering, richieste agli URL remoti o prove del comportamento applicativo. Una modifica documentale non rinnova le qualifiche storiche dei modelli o degli installer.
