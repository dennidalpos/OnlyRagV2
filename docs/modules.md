# Specifiche Tecniche dei Moduli — OnlyRag V2

Questo documento descrive in dettaglio la struttura modulare, le responsabilità, gli entry point, gli input/output e le interdipendenze di tutti i componenti di OnlyRag V2.

---

## 1. Moduli Frontend (Renderer React 19)

### 1.1. Core Hooks & State Engines (`src/hooks/`)
* **`useChatEngine.ts`**:
  * **Responsabilità**: Gestisce lo stato conversazionale della chat RAG, l'interrogazione asincrona al database vettoriale, l'instradamento di dominio (`domainRouter.ts`), la formattazione dei prompt contestualizzati con bounding budget e lo streaming della risposta da Ollama.
  * **Input/Output**: Accetta messaggi utente, lista documenti attivi; emette lo stream di token e l'elenco delle citazioni verificate.
* **`useCodingAgent.ts`**:
  * **Responsabilità**: Gestisce il ciclo agentico autonomo (Tool Calling Loop), l'orchestrazione delle sessioni di lavoro nidificate, la sincronizzazione del file system e l'iniezione dei feedback di auto-healing.
  * **Input/Output**: Accetta istruzioni di coding e file allegati; emette log di tool eseguiti, diff di file e messaggi dell'agente.
* **`useIngestedDocuments.ts`**:
  * **Responsabilità**: Mantiene l'elenco e lo stato di sincronizzazione dei documenti memorizzati in LanceDB, gestendo il polling e le operazioni atomiche di eliminazione.

### 1.2. Servizi Frontend (`src/services/`)
* **`api.ts` (`apiService`)**:
  * **Responsabilità**: Adapter di comunicazione HTTP verso il FastAPI Sidecar locale (`http://127.0.0.1:8000`).
  * **Metodi**: `ingestFile(formData)`, `search(query, topK, model, docIds)`, `getDocuments()`, `deleteDocument(docId)`, `exportDocument(params)`.
* **`domainRouter.ts`**:
  * **Responsabilità**: Sub-Router specialistico per la classificazione dell'intento (Medical, Legal, General) basato su keyword regex e **Vector Centroid Semantic Matching** con morfi clinici e giuridici (`calculateCentroidSimilarity`).
* **`hardwareRecommendationEngine.ts`**:
  * **Responsabilità**: Motore deterministico di profilazione hardware (**P1 – P5**) e raccomandazione modelli basato su calcolo della VRAM GPU, RAM di sistema e capienza disco richiesta.

### 1.3. Viste e Componenti UI (`src/components/`)
* **`components/chat/`**: Interfaccia di conversazione RAG con visualizzazione badge di citazione sorgente, anteprima snippet dei chunk ed espansione fonti.
* **`components/coding/`**: AI Coding Agent Studio con editor Monaco integrato, split diff viewer, terminale interattivo xterm (ConPTY) e file explorer.
* **`components/translation/`**: Vista di traduzione strutturata con Monaco `DiffEditor` side-by-side ed export multi-formato.
* **`components/ingestion/`**: Vista di caricamento documenti, anteprima testo estratto e ricerca vettoriale live.
* **`components/wizard/`**: Setup Wizard hardware guidato per la configurazione iniziale dei modelli.
* **`components/skills/`**: Gestione, installazione e modifica delle Skill agentiche (`SKILL.md`) con calcolo di checksum SHA-256 e tracciamento provenance.

---

## 2. Moduli Electron Main Process (`electron/core/`)

### 2.1. Presentation Layer (`electron/core/presentation/`)
Espone e valida i canali IPC bidirezionali tra Renderer e Main:
* **`agentIpc.ts`**: Canali per l'esecuzione di turni agentici (`agent:run-turn`), stop generation (`agent:stop-generation`) e benchmark (`agent:run-benchmark`).
* **`ollamaIpc.ts`**: Canali per download modelli (`ollama:pull-model`), modelli residenti in VRAM (`ollama:get-running-models`) ed evizione esplicita (`ollama:unload-model`).
* **`systemIpc.ts`**: Diagnostica di sistema (CPU, RAM, GPU/VRAM via NVML, spazio su disco) e gestione del logger.
* **`workspaceIpc.ts`**: Operazioni su file, directory, terminale PTY e comandi shell.
* **`skillIpc.ts`**: Sincronizzazione, salvataggio e cancellazione delle skill nel workspace.

### 2.2. Application Layer (`electron/core/application/`)
Orchestra i casi d'uso di sistema implementando la logica applicativa:
* **`agentOrchestratorAppService.ts`**: Esegue il loop agentico multi-step (Tool Calling), coordina lo streaming token per token verso la UI, calcola il `dynamicNumCtx`, intercetta loop ripetitivi con `AgentActionLoopDetector`, esegue il **Pre-Finish Verification Gate** per validare modifiche al codice prima della terminazione e gestisce l'auto-healing con rollback transazionale del filesystem.
* **`resilientModelDispatcher.ts`**: Gestore del dispacciamento resiliente verso Ollama con degradazione graduale (fallback automatico su modelli alternativi e dimezzamento del context window in caso di OOM o timeout).
* **`agentToolExecutorService.ts`**: Esegue in modo sicuro i tool invocati dal modello (`read_file`, `extract_code_symbols`, `write_file`, `replace_file_content`, `multi_replace_file_content`, `run_command`, `list_dir`, `grep_search`), registrando gli snapshot preventivi su `AtomicWorkspaceJournal`.
* **`skillAppService.ts`**: Gestisce il ciclo di vita delle skill, l'installazione dai marketplace e la sincronizzazione con il file system.
* **`ollamaAppService.ts`**: Facade per la gestione dello stato del daemon Ollama e del ciclo di vita dei modelli.
* **`systemAppService.ts`**: Ispezione delle risorse hardware e verifica preventiva dello spazio su disco.

### 2.3. Domain Layer (`electron/core/domain/`)
Contiene entità pure, logica decisionale e regole di business indipendenti dall'infrastruttura:
* **`agent/loopDetector.ts`**: Fingerprinting crittografico (SHA-256) delle invocazioni di tool per il rilevamento istantaneo di oscillazioni e loop ripetitivi con iniezione di direttive correttive (`[CRITICAL LOOP INTERVENTION]`).
* **`ollama/lifecycleCoordinator.ts`**: Regole di residenza in memoria (`primary_pinned`, `ephemeral`, `standard`), calcolo allocazione VRAM e prevenzione del thrashing.
* **`agent/contextWindowCalculator.ts`**: Calcolo dinamico a bucket ($2048, 4096, 8192, 16384, 32768, 65536$) del parametro `num_ctx` per il risparmio di KV-Cache.
* **`agent/toolParser.ts`**: Parser tollerante per l'estrazione di chiamate tool strutturate, rimozione di tag `<think>...</think>` e auto-riparazione di JSON malformato.
* **`agent/complexityEvaluator.ts`**: Valutazione della complessità del prompt per instradamento gerarchico (Fast Tier, Standard Tier, Deep Tier, Escalated Tier).
* **`agent/hardwareProfileResolver.ts`**: Risoluzione del profilo hardware e mappatura dei parametri ottimali di runtime.
* **`agent/promptCompiler.ts`**: Compilatore e risolutore di template per prompt di sistema con sostituzione deterministica di variabili contestuali (`{userTask}`, `{workspacePath}`, `{sourceLang}`, `{targetLang}`) ed ereditarietà tra preset di famiglia.
* **`agent/promptPresets.ts`**: Definizione unificata e canonica (Single Source of Truth) dei prompt factory, metadati delle famiglie di modelli (`MODEL_FAMILIES`) e logica di rilevamento architetturale (`detectModelFamily`).
* **`skills/skillMatcher.ts`**: Valutazione euristica e scoring ponderato per l'abbinamento contestuale delle skill al prompt utente.

### 2.4. Infrastructure Layer (`electron/core/infrastructure/`)
Implementa l'interazione con il sistema operativo, i protocolli di rete e l'I/O:
* **`filesystem/atomicWorkspaceJournal.ts`**: Snapshot preventivo e gestione transazionale delle mutazioni file su disco con supporto a `rollbackAll()` completo su errore/annullamento e `commit()` a fine task.
* **`http/ollamaHttpClient.ts`**: Client HTTP verso Ollama (`/api/generate`, `/api/tags`, `/api/ps`, `/api/pull`, `/api/show`).
* **`http/agentStreamTransport.ts`**: Gestore dello streaming SSE/NDJSON per i turni dell'agente con supporto a `keep_alive` pinning.
* **`filesystem/fileSystemRepository.ts`**: Repository per la lettura, scrittura sicura, patch e rimpiazzo multi-chunk tollerante a CRLF.
* **`filesystem/skillRepository.ts`**: Repository per il caricamento, parsing YAML multi-line, verifica SHA-256 e persistenza dello stato attivo (`active_skills.json`) delle skill agentiche.
* **`http/skillHubClient.ts`**: Client di integrazione marketplace multi-hub con adapter specifici (Anthropic `agentskills.io`, LobeHub, Skills.sh, cataloghi JSON e repository GitHub) dotato di caching in-memory TTL e mitigazione rate-limiting.
* **`process/persistentPowerShellSession.ts`**: Gestore di sessioni PowerShell interattive persistenti con mantenimento dello stato della shell (variabili d'ambiente `$env:`, percorsi `cd`, virtualenv) tra chiamate sequenziali di `run_command`.
* **`logging/codingAgentLogger.ts`**: Logger di audit strutturato per Coding Agent Studio (`logs/coding_agent_audit.log`) con registrazione dettagliata di prompt, tool call, parametri JSON, log di esecuzione terminale e feedback di auto-healing.
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
