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
| Verifiche, limiti e lavoro aperto | [Stato corrente](./verification-current.md), tracker (SecondBrain: `02-areas/products/OnlyRagV2/tracker.json`) |
| Decisioni della fase locale | [Politica approvata del 20 ottobre](./local-development-policy-2026-10-20.md), [direttive del repository](../AGENTS.md) |
| Risultati datati, proposte e consegne | [Indice storico](./history.md) |

Il lotto corrente del **26 ottobre 2026** riguarda persistenza delle skill, misura dello spazio disco e isolamento dei test degli hub. I contratti sono aggiornati nelle guide [Coding Agent](./coding-agent.md), [IPC](./api-ipc.md) e [utente](./guida-utente.md). Risultati e criteri verificati sono conservati nel dossier SecondBrain, `02-areas/products/OnlyRagV2/history/2026-10-26-skills-disk/report.md`; lo [stato corrente](./verification-current.md) distingue il lotto dai residui ancora aperti. Le precedenti ricevute restano nell'[indice storico](./history.md) e nel dossier. Le autorizzazioni Git delle vecchie consegne non si estendono a questo lotto.

La revisione successiva registra dodici nuovi difetti confermati nel tracker, con quindici attivita aperte complessive e nessuna ulteriore chiusura. La consegna richiesta sul branch principale e la ripresa dai due P1 sono descritte nel [passaggio di sessione del 26 ottobre](./session-handoff-skills-audit-2026-10-26.md).

## Fonti e file da preservare

- 02-areas/products/OnlyRagV2/tracker.json (nel dossier SecondBrain) (SecondBrain: `02-areas/products/OnlyRagV2/tracker.json`) contiene soltanto il lavoro aperto; ricevute e storia Git conservano completamenti e task ritirati. Autorizzazioni al commit/push riportate nelle vecchie consegne appartengono a quelle sessioni.
- [package.json](../package.json), lockfile e requisiti Python identificano comandi e dipendenze; [contratto IPC](../shared/ipc/ipcContract.ts), [route REST](../sidecar/main.py) e [schemi](../sidecar/schemas.py) descrivono il comportamento implementato.
- [OpenAPI](../sidecar/contracts/openapi-2.5.0.json) e gli asset dell'app hanno generatori: [operazioni](./operations.md) ne distingue uso e rigenerazione. Gli snapshot SecondBrain e i blocchi gestiti di AGENTS.md non si modificano a mano.
- Rapporti datati, JSON di evidenza, corpus congelati, hash, licenze e [prompt di prova](./prompt_test_sequenza.txt) restano conservati. I vecchi indici di ancoraggi [verification.md](./verification.md) e [rag-sidecar.md](./rag-sidecar.md) evitano di interrompere riferimenti storici.
- Le [skill del repository](../skills/) sono istruzioni per lo sviluppo; non sono le skill installate dal Coding Agent nei workspace dell'utente.

`npm run docs:check` controlla collegamenti locali, ancoraggi e nomi degli script npm. Non verifica da solo correttezza del comportamento, URL remoti o qualità dei modelli.
