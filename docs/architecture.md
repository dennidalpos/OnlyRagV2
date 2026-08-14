# Architettura del Sistema — OnlyRag V2

OnlyRag V2 adotta un'architettura **Multi-Process Locale Disaccoppiata** basata su **Electron**, **React**, **FastAPI Sidecar**, **LanceDB Embedded Vector DB** e il runtime locale **Ollama**.

---

## 1. Topologia di Sistema e Diagramma dei Componenti

```mermaid
flowchart TD
    subgraph UI["Renderer Process (React 19 + Vite + Tailwind/Vanilla CSS)"]
        UI_Chat["RAG Chat View"]
        UI_Studio["Coding Agent Studio"]
        UI_Trans["Translation View"]
        UI_Doc["Document Ingestion View"]
        UI_Wiz["Hardware Setup Wizard"]
    end

    subgraph Preload["Electron Preload Sandbox"]
        Bridge["ContextBridge (window.electronAPI)"]
    end

    subgraph Main["Electron Main Process (Clean Layered Architecture)"]
        IPC["Presentation: IPC Handlers"]
        AppSvc["Application: Agent / Ollama / System App Services"]
        Domain["Domain: Lifecycle Coordinator, Router, Tool Parser, Context Calc"]
        Infra["Infrastructure: HTTP Transports, PTY Shell, Skill & File Repositories"]
    end

    subgraph Sidecar["Python FastAPI Sidecar (:8000)"]
        API_Route["FastAPI Endpoints (/ingest, /search, /export)"]
        IngestEngine["Contextual Ingestion & Semantic Chunking"]
        LanceStore["LanceDB Embedded Vector Database"]
        HybridEngine["Hybrid Search: Dense Vector + BM25 + RRF (k=60)"]
        ReRanker["Cross-Encoder / FlashRank Re-Ranking Adapter"]
    end

    subgraph OllamaRuntime["Ollama Local Daemon (:11434)"]
        LocalLLM["Local GGUF Models (Llama, Qwen, DeepSeek-R1, BioMistral, Saul)"]
        Embedder["Embedding Engine (nomic-embed-text / bge-m3)"]
    end

    UI -->|IPC Calls| Bridge
    Bridge -->|Node IPC| IPC
    IPC --> AppSvc
    AppSvc --> Domain
    AppSvc --> Infra
    Infra -->|HTTP REST / Streaming| OllamaRuntime
    Infra -->|HTTP REST Client| Sidecar
    Sidecar -->|Embedding Requests| OllamaRuntime
```

---

## 2. Layered Clean Architecture (Electron Main Process)

Il processo principale di Electron rispetta rigorosamente il modello **Layered Architecture a 4 Livelli**:

```
Presentation Layer (IPC / UI Routing)
       │
       ▼
Application Layer (Use Cases & Orchestration)
       │
       ▼
Domain Layer (Pure Business Rules, Entities & Algorithms)
       │
       ▼
Infrastructure Layer (File System, PTY, HTTP Clients, Database)
```

| Livello | Directory | Responsabilità Principale | Dipendenze Consentite |
| :--- | :--- | :--- | :--- |
| **Presentation** | `electron/core/presentation/` | Registrazione dei canali `ipcMain.handle`, validazione input IPC e serializzazione risposte. | Application Layer |
| **Application** | `electron/core/application/` | Orchestrazione dei casi d'uso (Agent Tool Loop, Lifecycle dei modelli, gestione skill e workspace). | Domain, Infrastructure |
| **Domain** | `electron/core/domain/` | Logica pura di business: `lifecycleCoordinator`, `toolParser`, `contextWindowCalculator`, `complexityRouter`. Zero dipendenze da I/O o framework. | Nessuna (Puro TS) |
| **Infrastructure** | `electron/core/infrastructure/` | Interazione con I/O: `ollamaHttpClient`, `agentStreamTransport`, `fileSystemRepository`, `skillRepository`, `ptySessionManager`. | Standard APIs, Node.js libs |

---

## 3. Router Gerarchico a 2 Livelli (Zero VRAM Thrashing)

OnlyRag V2 previene la saturazione della VRAM e il thrashing dei modelli attraverso un router a due stadi:

```mermaid
sequenceDiagram
    autonumber
    participant User as Utente / UI
    participant Router as Sub-Router Specialistico (Livello 2)
    participant Coord as Global Resource Coordinator (Livello 1)
    participant Ollama as Daemon Ollama

    User->>Router: Query utente ("Paziente con faringite acuta")
    Router->>Router: Vector Centroid Matcher (<1ms) -> Medical Intent
    Router->>Coord: Richiesta modello "biomistral:latest" (Dynamic num_ctx: 4096)
    Coord->>Ollama: Check /api/ps (modelli caldi in VRAM)
    alt Modello diverso residente
        Coord->>Ollama: Evict modelli effimeri o secondari (keep_alive: 0)
    end
    Coord->>Ollama: Invocazione modello target (keep_alive: 30m)
    Ollama-->>User: Risposta in streaming con zero VRAM thrashing
```

### Livello 1: Global Resource & Lifecycle Coordinator
- **Model Pinning**: Mantiene residente in memoria il modello di lavoro primario (`keep_alive: '30m'`).
- **Ephemeral Eviction**: I modelli di traduzione rapida o OCR vengono scaricati immediatamente dopo l'esecuzione (`keep_alive: 0m`).
- **Dynamic Context Window Throttling**: Calcola e assegna `num_ctx` in bucket ottimali ($2048 \rightarrow 32768$) basandosi sulla dimensione effettiva del prompt e della cronologia.

### Livello 2: Sub-Router Specialistici di Modulo
- **Coding Studio Sub-Router**: Valutazione della complessità (Fast Tier $\le 3\text{B}$, Standard Tier $7-8\text{B}$, Deep Tier $14\text{B}/\text{R1}$, Escalated su errore di test/build).
- **RAG Chat Domain Sub-Router**: Classificazione semantica tramite **Vector Centroid Semantic Matching** ($<1\text{ms}$) tra Medical (`biomistral`), Legal (`saul-instruct`) e General (`llama3.1`).
- **Chit-Chat Direct Bypass**: Identificazione di saluti o domande convenzionali per escludere il retrieval vettoriale riducendo la latenza a $<100\text{ms}$.

---

## 4. Pipeline RAG Ibrida & Multi-Stage Retrieval

```mermaid
flowchart TD
    DocIn["1. Document Ingestion"] -->|Contextual Header Prepending| Chunking["[Documento: Nome.pdf | Sezione: Cap. 1] + Chunk Markdown"]
    Chunking --> Store["2. LanceDB Embedding Storage"]

    Query["User Search Query"] --> SearchEngine["3. Dual Hybrid Retrieval"]
    SearchEngine -->|Cosine Similarity| Dense["Dense Vector Search (bge-m3 / nomic)"]
    SearchEngine -->|LanceDB Native FTS| Sparse["Sparse Lexical BM25"]

    Dense --> Fusion["4. Reciprocal Rank Fusion (RRF k=60)"]
    Sparse --> Fusion

    Fusion -->|Top 15 Candidati| ReRanker["5. FlashRank / Cross-Encoder Re-Ranking"]
    ReRanker -->|Top 3-5 Chunks ad Alta Fedeltà| Grounding["6. LLM Grounded Generation con Citazioni"]
```

1. **Contextual Retrieval (Anthropic Standard)**: Durante l'ingestione semantica, ogni chunk viene arricchito con un header contestuale che include il documento e la gerarchia delle sezioni.
2. **Dual Hybrid Search**: Combina ricerca vettoriale densa e ricerca lessicale full-text BM25 in LanceDB.
3. **Reciprocal Rank Fusion (RRF)**: Fusione normalizzata dei punteggi dei due ranking:
   $$\text{RRF}(d) = \sum_{m \in \{\text{dense}, \text{sparse}\}} \frac{1}{60 + r_m(d)}$$
4. **In-Process Re-Ranking Adapter**: Re-ranking cross-encoder ultra-veloce tramite `flashrank` su CPU o motore semantico di prossimità termica $(<20\text{ms})$.
