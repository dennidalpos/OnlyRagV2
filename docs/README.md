# OnlyRag V2 documentation

Start with the [English user guide](user-guide.md) for the app's26 workflows or the [English developer/operations guide](developer-guide.md) for setup, architecture, contracts, tests and recovery. The [root README](../README.md) gives the quick start, existing screenshots and product limits.

## Coverage map

The English guides consolidate the maintained operational subjects below. Original Italian pages remain useful detailed translations/reference; dated reports and approved/frozen texts remain originals, not newly qualified instructions.

| Retained source | English coverage |
|---|---|
| [Visual user flows00–25](guida-utente.md) | [User guide](user-guide.md): orientation, services, ingestion02–07, chat08–10, translation11–13, coding14–20 and settings21–25 |
| [Operations](operations.md) | [Developer guide](developer-guide.md): prerequisites, setup/check commands, generated files, recovery, embedding maintenance and cleanup limits |
| [Architecture](architecture.md) | Developer guide: process boundaries and storage/acknowledgement model |
| [Renderer](frontend.md) | User guide: settings/chat/document/agent persistence and recovery; developer guide: Renderer/Preload boundary |
| [Electron Main](electron-main.md) | Developer guide: IPC validation, lifecycle/Sidecar ownership and application/domain responsibilities |
| [IPC](api-ipc.md) | Developer guide: typed contract as authority, secure dispatch and field/behavior limits |
| [REST](api-rest.md) | Developer guide: FastAPI/schemas/OpenAPI, token, CORS and transport/cancellation |
| [Ingestion/OCR](ingestion.md) | User guide: import/review/edit/export; developer guide: original archives, provider diagnostics and revision checks |
| [Retrieval](retrieval.md) | User guide: inspector/context/citations; developer guide: provenance, ranking, archive lifetime and embedding maintenance |
| [Translation](translation.md) | Both guides: Markdown/layout choices, verified source/revision, markers, format limits, cancellation and publication |
| [Coding Agent](coding-agent.md) | User guide: workspace/modes/plans/actions/results/recovery; developer guide: arbitration and ownership |
| [Agent runtime](agent-runtime.md) | Developer guide: policy/budgets, recovery receipts and explicit resume; historical anchors remain in original |
| [Agent guards](agent-guards.md) | Developer guide: compare-and-swap, profile differences and native verification |
| [Agent diagnostics](agent-diagnostics.md) | Developer guide: advice versus authority, parser/test/compiler and incomplete-proof distinctions |
| [Model/runtime fit](model-runtime-fit.md) | User guide: roles, estimates and fit limits; dated proposals/measures remain originals |
| [Libraries](libraries.md) | Developer guide: manifest/lockfile/generated version authority; dated dependency review retained |
| [Local candidates](distribution.md) | Developer guide: CPU candidate build and active local-phase boundaries |
| [RAG/Sidecar](rag-sidecar.md) | Developer guide: extraction/retrieval/translation; historical index retained |
| [Current verification](verification-current.md) | Developer guide: check scope and qualification distinctions; dated receipts retain original provenance |
| [Screenshots](assets/screenshot-provenance.md) | User guide/root README: existing captures and bounded provenance, no new screenshot claim |

## Historical and approved material

[History](history.md), dated audit/verification/handoff reports, distribution license proposals/reviews, frozen content acceptance, model-task baselines and the [approved local-phase policy](local-development-policy-2026-10-20.md) preserve their original wording, hashes, decisions and limits. They do not authorize new publication, real model campaigns, customer-data operations or cleanup.

## Sources of truth

- [package.json](../package.json), lockfile, .nvmrc and Python requirement/pin files define the actual toolchain and commands.
- [IPC contract](../shared/ipc/ipcContract.ts), [FastAPI routes](../sidecar/main.py) and [schemas](../sidecar/schemas.py) define implemented interfaces.
- OpenAPI and app assets have generators. Existing visual-guide SVGs have no maintained generator; do not claim a regeneration from assets:generate.
- Managed instructions are generated through SecondBrain; repository knowledge and task changes remain in the identity-resolved dossier.
- npm run docs:check validates local links/anchors/command names and supported Mermaid syntax. It does not render diagrams, check live URLs or prove application behavior.
