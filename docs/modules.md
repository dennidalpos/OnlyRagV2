# Specifiche Tecniche dei Moduli — OnlyRag V2

Questo documento descrive in dettaglio la struttura modulare, le responsabilità, i flussi di dati e le interdipendenze di tutti i componenti di OnlyRag V2.

---

## 1. Moduli Frontend (Renderer React 19)

### 1.1. Core Hooks & State Engines (`src/hooks/`)
* **`useChatEngine.ts`**: Gestisce lo stato conversazionale della chat RAG, l'interrogazione asincrona al database vettoriale, l'instradamento di dominio (`domainRouter.ts`), la formattazione dei prompt contestualizzati con bounding budget e lo streaming della risposta da Ollama.
* **`useAgentStudio.ts`**: Gestisce il ciclo agentico autonomo (Tool Calling Loop), l'orchestrazione delle sessioni di lavoro, la sincronizzazione del file system e l'iniezione dei feedback di auto-healing.
* **`useIngestedDocuments.ts`**: Mantiene l'elenco e lo stato di sincronizzazione dei documenti memorizzati in LanceDB, gestendo il polling e le operazioni di cancellazione.

### 1.2. Servizi Frontend (`src/services/`)
* **`api.ts` (`apiService`)**: Adapter di comunicazione HTTP verso il FastAPI Sidecar locale (ingestion, hybrid search vettoriale, export report).
* **`domainRouter.ts`**: Sub-Router specialistico per la classificazione dell'intento (Medical, Legal, General) basato su keyword regex e **Vector Centroid Semantic Matching** con morfi clinici e giuridici (`calculateCentroidSimilarity`).
* **`hardwareRecommendationEngine.ts`**: Motore deterministico di raccomandazione dei modelli basato su profilo hardware (**P1 – P5**), calcolo della VRAM, RAM di sistema e capienza disco richiesta.

### 1.3. Viste e Componenti UI (`src/components/`)
* **`components/chat/`**: Interfaccia di conversazione RAG con visualizzazione badge di citazione sorgente, anteprima snippet dei chunk ed espansione fonti.
* **`components/studio/`**: AI Coding Agent Studio con editor Monaco integrato, split diff viewer, terminale interattivo xterm (ConPTY) e file explorer.
* **`components/wizard/`**: Setup Wizard hardware guidato con sub-tab di selezione modelli per Chat Generale, Coding, Settore Medico/Clinico, Legale/Compliance e Vision OCR.
* **`components/skills/`**: Gestione, installazione e modifica delle Skill agentiche (`SKILL.md`) con calcolo di checksum SHA-256 e tracciamento provenance (`local_custom`, `hub_original`, `hub_modified`).

---

## 2. Moduli Electron Main Process (`electron/core/`)

### 2.1. Presentation Layer (`electron/core/presentation/`)
Espone e valida i canali IPC bidirezionali tra Renderer e Main:
* **`agentIpc.ts`**: Canali per l'esecuzione di turni agentici, stop generation, gestione sessioni e benchmark.
* **`ollamaIpc.ts`**: Canali per download modelli (`pull`), stato modelli residenti in VRAM (`get-running-models`) ed evizione controllata (`unload-model`).
* **`systemIpc.ts`**: Diagnostica di sistema (CPU, RAM, GPU/VRAM via NVML, spazio su disco) e gestione del logger.
* **`workspaceIpc.ts`**: Operazioni su file, directory, terminale PTY e comandi shell.
* **`skillIpc.ts`**: Sincronizzazione, salvataggio e cancellazione delle skill nel workspace.

### 2.2. Application Layer (`electron/core/application/`)
Orchestra i casi d'uso di sistema implementando la logica applicativa:
* **`agentOrchestratorAppService.ts`**: Esegue il loop agentico multi-step (Tool Calling), coordina lo streaming token per token verso la UI, calcola il `dynamicNumCtx` e gestisce l'auto-healing in caso di errori di build o test.
* **`agentToolExecutorService.ts`**: Esegue in modo sicuro i tool invocati dal modello (`read_file`, `write_file`, `replace_file_content`, `run_command`, `list_dir`).
* **`ollamaAppService.ts`**: Facade per la gestione dello stato del daemon Ollama e del ciclo di vita dei modelli.
* **`systemAppService.ts`**: Ispezione delle risorse hardware e verifica preventiva dello spazio su disco.

### 2.3. Domain Layer (`electron/core/domain/`)
Contiene entità pure, logica decisionale e regole di business indipendenti dall'infrastruttura:
* **`ollama/lifecycleCoordinator.ts`**: Regole di residenza in memoria (`primary_pinned`, `ephemeral`, `standard`), calcolo `calculateVramAllocationRatio` per memorie unificate/discrete e prevenzione del VRAM thrashing.
* **`agent/contextWindowCalculator.ts`**: Calcolo a bucket dinamici ($2048, 4096, 8192, 16384, 32768, 65536$) del parametro `num_ctx` per il risparmio di KV-Cache.
* **`agent/toolParser.ts`**: Parser tollerante per l'estrazione di chiamate tool strutturate, rimozione di tag `<think>...</think>` e auto-riparazione di JSON dirty.
* **`agent/complexityEvaluator.ts`**: Valutazione della complessità del prompt per instradamento gerarchico (Fast Tier, Standard Tier, Deep Tier, Escalated Tier) con Circuit Breaker per la de-escalation graduale.


### 2.4. Infrastructure Layer (`electron/core/infrastructure/`)
Implementa l'interazione con il sistema operativo, i protocolli di rete e l'I/O:
* **`http/ollamaHttpClient.ts`**: Client HTTP verso Ollama (`/api/generate`, `/api/tags`, `/api/ps`, `/api/pull`, `/api/show`).
* **`http/agentStreamTransport.ts`**: Gestore dello streaming SSE/NDJSON per i turni dell'agente con supporto a `keep_alive` pinning.
* **`filesystem/fileSystemRepository.ts`**: Repository per la lettura, scrittura sicura, patch e rimpiazzo multi-chunk tollerante a CRLF.
* **`filesystem/skillRepository.ts`**: Repository per il caricamento, parsing YAML e verifica SHA-256 delle skill agentiche.
* **`pty/ptySessionManager.ts`**: Gestore di sessioni terminale Windows ConPTY su `node-pty`.

---

## 3. Moduli Python FastAPI Sidecar (`sidecar/`)

### 3.1. Servizi Applicativi (`sidecar/services/`)
* **`ingest_service.py`**: Pipeline di estrazione testo e markdown da PDF, DOCX, TXT e immagini OCR, creazione dei chunk contestuali e generazione degli embedding vettoriali.
* **`search_service.py`**: Motore di ricerca ibrido su LanceDB (Dense Cosine Similarity + Sparse BM25), aggregazione tramite Reciprocal Rank Fusion ($k=60$) e re-ranking cross-encoder.
* **`export_service.py`**: Generazione di report strutturati in formato PDF e Markdown.

### 3.2. Dominio & Infrastruttura (`sidecar/domain/` & `sidecar/infrastructure/`)
* **`domain/ingestion.py`**: Logica di chunking semantico gerarchico con anteposizione degli header Anthropic (`[Documento: <file> | Sezione: <header>]`).
* **`infrastructure/db.py`**: Connessione persistente e gestione tabelle LanceDB (`chunks_v2`, `documents_v2`).
* **`infrastructure/embeddings.py`**: Generazione degli embedding vettoriali interfacciandosi con il runtime locale Ollama.
* **`infrastructure/reranker.py`**: Adapter in-process di re-ranking con supporto a `flashrank` e fallback deterministico su similarità morfo-semantica (`calculate_cross_score`).
