# OnlyRag V2 — Technical & Operational Documentation

Benvenuti nella documentazione ufficiale e centralizzata di **OnlyRag V2**, l'ecosistema AI locale, autonomo e zero-cloud per Retrieval-Augmented Generation (RAG), AI Coding Agent Studio, traduzione ad alta fedeltà e ingestion multimodale basato su **Ollama**, **LanceDB** e **FastAPI Sidecar**.

---

## 📚 Indice della Documentazione

La documentazione del progetto è organizzata modularmente nelle seguenti sezioni:

| Documento | Descrizione |
| :--- | :--- |
| [**`architecture.md`**](./architecture.md) | Panoramica architetturale ad alto livello, Clean Architecture a 4 livelli, diagrammi Mermaid, topologia del processo Electron, Sidecar Python, e Router Gerarchico a 2 Livelli. |
| [**`modules.md`**](./modules.md) | Dettaglio tecnico dei singoli moduli e servizi (Frontend React, Electron Main/Application/Domain/Infrastructure, Python Sidecar, Skill Hub). Responsabilità, input/output e dipendenze. |
| [**`api.md`**](./api.md) | Specifiche e contratti API completi: IPC Channels di Electron, endpoint REST del FastAPI Sidecar (`/health`, `/ingest`, `/search`, `/documents`, `/export`), schemi di validazione Pydantic/TypeScript e codici di errore. |
| [**`setup-and-env.md`**](./setup-and-env.md) | Guida all'installazione, requisiti di sistema, matrice dei profili hardware (**P1 – P5**), configurazione variabili d'ambiente Ollama/Electron e comandi PowerShell per build, test e packaging. |
| [**`ollama-models-matrix.md`**](./ollama-models-matrix.md) | Matrice completa di compatibilità modelli Ollama, calcolo analitico footprint VRAM/KV-Cache, storage SSD e algoritmo di assegnazione per profili hardware P1–P5. |

---

## 🎯 Principi Architetturali Fondamentali

1. **Zero Cloud Dependencies & 100% Data Sovereignty**: Nessuna telemetria o chiamata a server remoti per l'inferenza o l'elaborazione dei documenti.
2. **Layered Clean Architecture**: Rigida separazione delle responsabilità (`Presentation` $\rightarrow$ `Application` $\rightarrow$ `Domain` $\rightarrow$ `Infrastructure`).
3. **Gerarchical 2-Level Routing**: Prevenzione del VRAM thrashing tramite Global Resource Coordinator e instradamento ad alta precisione tramite Sub-Router specialistici.
4. **Resilienza e Auto-Healing**: Parsing tollerante dei tool call JSON, rimozione dei tag di CoT (`<think>`) e correzione automatica degli errori di esecuzione nei workflow agentici.

---

## 🔄 Governance della Documentazione

Come stabilito in [`AGENTS.md`](../AGENTS.md), la cartella `/docs` costituisce la **Single Source of Truth** per l'intero repository. Qualsiasi modifica architetturale, interfaccia, endpoint o variabile d'ambiente deve essere contestualmente sincronizzata nei relativi documenti.
