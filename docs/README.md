# OnlyRag V2 — Indice della documentazione

Benvenuti nella documentazione ufficiale e centralizzata di **OnlyRag V2**, l'ecosistema AI desktop locale, autonomo e zero-cloud per Retrieval-Augmented Generation (RAG), AI Coding Agent Studio, traduzione strutturata ad alta fedeltà e ingestion multimodale basato su **Electron**, **Ollama**, **LanceDB** e **FastAPI Sidecar**.

---

## 📚 Indice e fonti canoniche

La documentazione operativa risiede in `/docs/`. Per evitare divergenze, ogni argomento ha un solo documento autorevole; codice, test e `package.json` restano la fonte normativa per i dettagli eseguibili.

## Fonti canoniche per argomento

| Argomento | Fonte autorevole | Contenuto e confini |
| :--- | :--- | :--- |
| Topologia e confini architetturali | [`architecture.md`](./architecture.md) | Panoramica multi-process, Clean Architecture, pipeline RAG e integrazione agentica. |
| Moduli, responsabilità e percorsi | [`modules.md`](./modules.md) | Inventario di Frontend, Electron, Sidecar, skill e script; nessun duplicato di contratti API. |
| Contratti REST e IPC | [`api.md`](./api.md) | Endpoint, canali, payload, tipi ed errori; verificare sempre handler, preload e tipi del codice. |
| Osservabilità e diagnosi | [`observability.md`](./observability.md) | Log strutturati, gestione errori, soglie, limiti, segnali critici e lacune metriche. |
| Installazione, hardware e comandi | [`setup-and-env.md`](./setup-and-env.md) | Prerequisiti, tier hardware, dimensionamento, Ollama e procedure operative. |
| Qualità del workspace | `npm run format:check` e `npm run lint` | Controllo whitespace sul diff e gate seriale; non esiste ancora un formatter AST dedicato. |
| Prove live dell’agente | [`agent-live-testing.md`](./agent-live-testing.md) | Prerequisiti, scenari, isolamento e interpretazione dei log live. |
| Stato della roadmap e tracker | [`PROJECT_STATUS.json`](../PROJECT_STATUS.json) | Checklist esecutiva; dopo il completamento verificato delle Wave 1–6 non contiene task pendenti. |
| Dipendenze e implementazioni custom | [`libraries-and-domain-implementations.md`](./libraries-and-domain-implementations.md) | Librerie e logiche custom; le versioni effettive sono nei manifest. |
| Sicurezza e salute delle dipendenze | [`dependency-audit.md`](./dependency-audit.md) | Snapshot CVE, obsolescenza, ridondanze, rischi e follow-up. |
| Versioni installabili | `package.json` e `package-lock.json` | Fonte normativa per range dichiarati e risoluzioni; la documentazione riporta solo snapshot e motivazioni. |

---

## 🎯 Principi Guida del Progetto

1. **Zero Cloud Dependencies & 100% Privacy**: Tutta l'elaborazione (LLM inference, embeddings, chunking, OCR) avviene in locale sulla macchina host.
2. **Layered Clean Architecture**: Rigida separazione delle responsabilità (`Presentation` $\rightarrow$ `Application` $\rightarrow$ `Domain` $\rightarrow$ `Infrastructure`).
3. **Gerarchical 2-Level Routing**: Prevenzione del VRAM thrashing tramite Global Resource Coordinator e instradamento ad alta precisione tramite Sub-Router specialistici.
4. **Resilienza e Auto-Healing**: Parsing tollerante dei tool call JSON, rimozione dei tag CoT (`<think>`) e correzione automatica degli errori di esecuzione nei workflow agentici.

---

## 🔄 Protocollo di Governance

Come stabilito in [`AGENTS.md`](../AGENTS.md), la cartella `/docs/` costituisce l'**unica fonte di verità**. A ogni modifica di codice (architettura, moduli, API, configurazioni o comandi), i file in `/docs/` devono essere contestualmente sincronizzati.

I documenti nella tabella hanno confini esclusivi: `architecture.md` spiega la topologia, `modules.md`
le responsabilità dei moduli, `api.md` i contratti e `setup-and-env.md` i comandi operativi. Le versioni
e i dettagli eseguibili restano verificati contro il codice e i manifest, non contro copie narrative.

## Archivio

I materiali storici non normativi sono esclusi dall’indice canonico: non usarli per dedurre l’architettura, i tool o i comandi correnti.
