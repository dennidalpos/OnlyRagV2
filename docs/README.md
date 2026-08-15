# OnlyRag V2 — Indice Documentazione Ufficiale

Benvenuti nella documentazione ufficiale e centralizzata di **OnlyRag V2**, l'ecosistema AI desktop locale, autonomo e zero-cloud per Retrieval-Augmented Generation (RAG), AI Coding Agent Studio, traduzione strutturata ad alta fedeltà e ingestion multimodale basato su **Electron**, **Ollama**, **LanceDB** e **FastAPI Sidecar**.

---

## 📚 Indice della Documentazione (Single Source of Truth)

La documentazione del repository risiede esclusivamente in `/docs/` ed è suddivisa nei seguenti documenti canonici:

| Documento | Descrizione |
| :--- | :--- |
| [**`architecture.md`**](./architecture.md) | Architettura di sistema, topologia multi-process, Clean Architecture a 4 livelli, diagrammi Mermaid, Router Gerarchico a 2 Livelli, Pipeline RAG Ibrida (LanceDB + BM25 + RRF + Re-Ranker) e Agent Studio tool loop. |
| [**`modules.md`**](./modules.md) | Mappatura dettagliata di tutti i moduli e servizi (Frontend React 19, Electron Main/Presentation/Application/Domain/Infrastructure, Python Sidecar, Skill Hub). Responsabilità, entry point, contratti di input/output e dipendenze. |
| [**`api.md`**](./api.md) | Specifiche e contratti API completi: canali IPC di Electron (`window.electronAPI`), endpoint REST del FastAPI Sidecar (`/health`, `/ingest`, `/search`, `/documents`, `/export`), payload JSON, schemi TypeScript e gestione errori. |
| [**`setup-and-env.md`**](./setup-and-env.md) | Guida all'installazione, requisiti minimi di sistema, matrice dei profili hardware (**P1 – P5**), formule analitiche di dimensionamento VRAM/RAM/SSD, variabili d'ambiente OS per Ollama, script PowerShell 1-click e comandi seriali di sviluppo/build/test. |

---

## 🎯 Principi Guida del Progetto

1. **Zero Cloud Dependencies & 100% Privacy**: Tutta l'elaborazione (LLM inference, embeddings, chunking, OCR) avviene in locale sulla macchina host.
2. **Layered Clean Architecture**: Rigida separazione delle responsabilità (`Presentation` $\rightarrow$ `Application` $\rightarrow$ `Domain` $\rightarrow$ `Infrastructure`).
3. **Gerarchical 2-Level Routing**: Prevenzione del VRAM thrashing tramite Global Resource Coordinator e instradamento ad alta precisione tramite Sub-Router specialistici.
4. **Resilienza e Auto-Healing**: Parsing tollerante dei tool call JSON, rimozione dei tag CoT (`<think>`) e correzione automatica degli errori di esecuzione nei workflow agentici.

---

## 🔄 Protocollo di Governance

Come stabilito in [`AGENTS.md`](../AGENTS.md), la cartella `/docs/` costituisce l'**unica fonte di verità**. A ogni modifica di codice (architettura, moduli, API, configurazioni o comandi), i file in `/docs/` devono essere contestualmente sincronizzati.
