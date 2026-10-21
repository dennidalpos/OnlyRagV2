# Documentazione OnlyRag V2

## Guide per ambito

| Per chi / obiettivo | Documento |
| --- | --- |
| Utilizzatori: scelte e flussi desktop | [Guida utente](./guida-utente.md) |
| Manutentore: setup, comandi, profili e recupero | [Operazioni](./operations.md) |
| Architettura e responsabilità | [Architettura](./architecture.md), [Renderer](./frontend.md), [Main](./electron-main.md) |
| Contratti tra processi | [IPC](./api-ipc.md), [REST](./api-rest.md) |
| Documenti, ricerca e lingue | [Ingestion/OCR](./ingestion.md), [embedding e fonti](./retrieval.md), [traduzione](./translation.md) |
| Coding Agent | [Uso e confini](./coding-agent.md), [runtime](./agent-runtime.md), [guard](./agent-guards.md), [diagnostica](./agent-diagnostics.md) |
| Modelli e stime di memoria | [Runtime fit](./model-runtime-fit.md); i vecchi profili di qualifica sono nell'[indice storico](./history.md#modelli-e-accettazione-storica) |
| Dipendenze e candidati locali | [Librerie](./libraries.md), [distribuzione](./distribution.md) |
| Verifiche, limiti e lavoro aperto | [Stato corrente](./verification-current.md), [tracker](../PROJECT_STATUS.json) |
| Decisioni della fase locale | [Politica approvata del 20 ottobre](./local-development-policy-2026-10-20.md), [direttive del repository](../AGENTS.md) |
| Risultati datati, proposte e consegne | [Indice storico](./history.md) |

Le guide correnti sono state riesaminate il **21 ottobre 2026**. [Metodo, correzioni, discrepanze e limiti](./documentation-audit-2026-10-21.md) distinguono confronto statico, test eseguiti e ricevute storiche. Per individuare il comportamento previsto confrontare direttive e decisioni approvate con contratti, implementazione e test: una divergenza non rende automaticamente corretto il codice.

## Fonti e file da preservare

- [PROJECT_STATUS.json](../PROJECT_STATUS.json) contiene soltanto il lavoro aperto; ricevute e storia Git conservano completamenti e task ritirati. Autorizzazioni al commit/push riportate nelle vecchie consegne appartengono a quelle sessioni.
- [package.json](../package.json), lockfile e requisiti Python identificano comandi e dipendenze; [contratto IPC](../shared/ipc/ipcContract.ts), [route REST](../sidecar/main.py) e [schemi](../sidecar/schemas.py) descrivono il comportamento implementato.
- [OpenAPI](../sidecar/contracts/openapi-2.5.0.json) e gli asset dell'app hanno generatori: [operazioni](./operations.md) ne distingue uso e rigenerazione. Gli snapshot SecondBrain e i blocchi gestiti di AGENTS.md non si modificano a mano.
- Rapporti datati, JSON di evidenza, corpus congelati, hash, licenze e [prompt di prova](./prompt_test_sequenza.txt) restano conservati. I vecchi indici di ancoraggi [verification.md](./verification.md) e [rag-sidecar.md](./rag-sidecar.md) evitano di interrompere riferimenti storici.
- Le [skill del repository](../skills/) sono istruzioni per lo sviluppo; non sono le skill installate dal Coding Agent nei workspace dell'utente.

`npm run docs:check` controlla collegamenti locali, ancoraggi e nomi degli script npm. Non verifica da solo correttezza del comportamento, URL remoti o qualità dei modelli.
