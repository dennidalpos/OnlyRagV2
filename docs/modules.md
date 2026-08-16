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
* **`agentOrchestratorAppService.ts`**: Esegue il loop agentico multi-step (Tool Calling), coordina lo streaming token per token verso la UI, calcola il `dynamicNumCtx`, intercetta loop ripetitivi con `AgentActionLoopDetector`, esegue il **Pre-Finish Verification Gate** per validare modifiche al codice prima della terminazione e gestisce l'auto-healing con rollback transazionale del filesystem. Integra l'escalation dinamica dei modelli su scatto del `StagnationCircuitBreaker` seguendo l'ordine dei tier (🟢 Fast → 🔵 Standard → 🟣 Deep Reasoning → 🔶 Heavy) con evizione atomica VRAM prima del cambio modello.
* **`resilientModelDispatcher.ts`**: Gestore del dispacciamento resiliente verso Ollama con degradazione graduale ed escalation gerarchica su 4 tier: 🟢 Fast Tier (`complexityFastModel`) → 🔵 Standard Tier (`codingModel` / `defaultModel`) → 🟣 Deep Reasoning Tier (`complexityStandardModel` / `intermediateModel`) → 🔶 Heavy Tier (`complexityHeavyModel`). Supporta l'evizione preventiva VRAM via `/api/generate` (`keep_alive: 0`) ed il calcolo deterministico del prossimo tier disponibile tramite `getNextEscalationModel`.
* **`agentToolExecutorService.ts`**: Esegue in modo sicuro i tool invocati dal modello (`read_file`, `extract_code_symbols`, `write_file`, `replace_file_content`, `multi_replace_file_content`, `run_command`, `list_dir`, `grep_search`), registrando gli snapshot preventivi su `AtomicWorkspaceJournal`.
* **`skillAppService.ts`**: Gestisce il ciclo di vita delle skill, l'installazione dai marketplace e la sincronizzazione con il file system.
* **`ollamaAppService.ts`**: Facade per la gestione dello stato del daemon Ollama e del ciclo di vita dei modelli.
* **`systemAppService.ts`**: Ispezione delle risorse hardware, verifica preventiva dello spazio su disco e applicazione persistente delle variabili d'ambiente OS utente per l'ottimizzazione dell'hardware host.

### 2.3. Domain Layer (`electron/core/domain/`)
Contiene entità pure, logica decisionale e regole di business indipendenti dall'infrastruttura:
* **`agent/loopDetector.ts`**: Fingerprinting crittografico (SHA-256) delle invocazioni di tool per il rilevamento istantaneo di oscillazioni e loop ripetitivi con iniezione di direttive correttive (`[CRITICAL LOOP INTERVENTION]`).
* **`agent/agentRuntimeMode.ts`**: FSM (Finite State Machine) per la gestione dei permessi di esecuzione per modalità (`ASK`, `PLAN`, `AGENT`). Definisce la matrice di permessi per tool (`ModePermissionConfig`), il gate di autorizzazione `isToolAllowed()` e il filtro dinamico degli strumenti disponibili per ciascuna modalità.
* **`agent/planManager.ts`**: Parser e serializzatore del piano di esecuzione `.assistant/plan.md` in formato markdown checklist machine-parseable. Gestisce il ciclo di vita delle task (`- [ ]` / `- [x]`), l'identificazione della prima task pendente e il rilevamento della condizione di piano completato (`GOAL_COMPLETED`).
* **`agent/heuristicContextCompactor.ts`**: Compattatore deterministico a costo zero (nessuna inferenza LLM aggiuntiva) attivato al 75% del watermark del contesto hardware. Segmenta il prompt in 4 tier di priorità (Immutable Anchor, Pinned Files, History, Aux Context) e riduce proporzionalmente i segmenti a bassa priorità usando `DiagnosticOutputReducer` per distillare i log di terminale.
* **`ollama/lifecycleCoordinator.ts`**: Regole di residenza in memoria (`primary_pinned`, `ephemeral`, `standard`), calcolo allocazione VRAM e prevenzione del thrashing.
* **`agent/contextWindowCalculator.ts`**: Calcolo dinamico a bucket ($2048, 4096, 8192, 16384, 32768, 65536$) del parametro `num_ctx` per il risparmio di KV-Cache.
* **`agent/toolParser.ts`**: Parser tollerante per l'estrazione di chiamate tool strutturate, unificazione e unwrapping automatico di parametri flat (root-level), conversione resiliente di template literals JavaScript con backtick in stringhe JSON conformi, rimozione di tag `<think>...</think>` e auto-riparazione di JSON malformato.
* **`agent/complexityEvaluator.ts`**: Valutazione della complessità del prompt per instradamento gerarchico (Fast Tier, Standard Tier, Deep Tier, Escalated Tier).
* **`agent/hardwareProfileResolver.ts`**: Risoluzione del profilo hardware e mappatura dei parametri ottimali di runtime.
* **`agent/planAndSolveGraph.ts`**: Planner gerarchico disaccoppiato (`GoalDecompositionPlanner`) che scompone gli obiettivi in milestone verificabili con assunzioni falsificabili e traccia la convergenza del task.
* **`agent/diagnosticOutputReducer.ts`**: Compattatore semantico per l'output di terminale e test runner (`DiagnosticOutputReducer`), con rimozione dei codici ANSI ed estrazione deterministica delle asserzioni fallite e degli stack trace.
* **`agent/episodicMemoryCompactor.ts`**: Gestore della memoria episodica a finestra scorrevole con compattazione del contesto per prevenire il context drift nei task multi-step lunghi.
* **`agent/fuzzyPatchEngine.ts`**: Engine di rimpiazzo fuzzy basato su distanza di Levenshtein normalizzata con tolleranza a whitespace/a-capo e validazione in-flight dell'AST (TypeScript/JavaScript/JSON) pre-commit per impedire la scrittura di file corrotti.
* **`agent/shellStreamGuard.ts`**: Guardrail non-interattivo per sessioni shell con iniezione di env (`CI=true`, `NPM_CONFIG_YES=true`), scanner Regex per prompt interattivi (abort immediato via SIGINT) e buffer circolare da 64KB.
* **`agent/roleAgentGraph.ts`**: Macchina a stati per la separazione dei ruoli agentici (`PLANNER`, `EXPLORER`, `CODER`, `VERIFIER`) con matrice di autorizzazione tool ad accesso ristretto per ruolo.
* **`agent/compactSemanticRepoMapper.ts`**: Scansione ed estrazione AST dei simboli esportati (`class`, `function`, `interface`, `type`) per la generazione di Repo Map ad alta densità informativa.
* **`agent/cycleOscillationDetector.ts`**: Algoritmo di rilevamento cicli di oscillazione a $k$-Stati ($k \in [2, 4]$) per la prevenzione di trappole alternati $A \rightarrow B \rightarrow A \rightarrow B$ ed emissione di Repro Test template.
* **`agent/ephemeralSubAgentDispatcher.ts`**: Dispacciatore di worker sub-agent effimeri a contesto isolato e token cap dedicato per task ad alta intensità di esplorazione senza inquinamento della memoria dell'orchestratore primario.
* **`agent/tddReproductionGatekeeper.ts`**: Controller di flusso TDD / Reproduction-First per la validazione obbligatoria della sequenza `REPRO_TEST_WRITTEN` $\rightarrow$ `RUN_REPRO (FAIL)` $\rightarrow$ `CODE_MUTATED` $\rightarrow$ `RUN_REPRO (PASS)`.
* **`agent/unifiedDiffPatchApplier.ts`**: Applicatore nativo di patch Unified Diff (`@@ -L,C +L,C @@`) con parsing strutturato delle hunk e matching ad offset tollerante.
* **`agent/workspaceStateHashTracker.ts`**: Hashing dello stato del workspace tramite SHA-256 dei file coinvolti per il rilevamento di stagnazioni fisiche di stato ($S_1 \rightarrow S_2 \rightarrow S_1$).
* **`agent/policySecurityInterceptor.ts`**: Intercettore di sicurezza a matrice dinamicamente valutata per azioni distruttive, comandi di rete e policy per modalità (`PLAN`, `ASK`, `AGENT`).
* **`agent/virtualMemoryStore.ts`**: Memoria virtuale simbolica persistente cross-step (`VirtualMemorySymbolStore`) per la conservazione dei fatti dei file già ispezionati, eliminando riletture ridondanti nei modelli locali compatti.
* **`agent/astStackTraceExtractor.ts`**: Estrattore di stack trace orientato all'AST per l'isolamento puntuale di file, riga e messaggio di errore dai log di terminale.
* **`agent/strictAnchorFuzzyPatcher.ts`**: Validatore di unicità dell'ancora di patching per garantire l'applicazione di rimpiazzi solo su sezioni univoche del file target.
* **`agent/stagnationCircuitBreaker.ts`**: Interruttore automatico di circuit breaker per la prevenzione di runaway loop di 300+ step su hardware minimo.
* **`agent/sessionDebtTracker.ts`**: Gestore della persistenza del resoconto di sessione e del debito tecnico in `.assistant/SESSION_TRACKER.md`. Traccia bug non risolti, file modificati e task pendenti e li inietta nel prompt di ciascun turno per eliminare l'amnesia contestuale cross-step.
* **`skills/skillMatcher.ts`**: Valutazione euristica e scoring ponderato per l'abbinamento contestuale delle skill al prompt utente, arricchito da fingerprinting automatico dello stack tecnologico del progetto (`package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`) e bonus di sinergia prompt+progetto.

### 2.4. Infrastructure Layer (`electron/core/infrastructure/`)
Implementa l'interazione con il sistema operativo, i protocolli di rete e l'I/O:
* **`filesystem/atomicWorkspaceJournal.ts`**: Snapshot preventivo e gestione transazionale delle mutazioni file su disco con gestione sicura di directory e file inesistenti, supporto a `rollbackAll()` completo su errore/annullamento e `commit()` a fine task.
* **`http/ollamaHttpClient.ts`**: Client HTTP verso Ollama (`/api/generate`, `/api/tags`, `/api/ps`, `/api/pull`, `/api/show`).
* **`http/agentStreamTransport.ts`**: Gestore dello streaming SSE/NDJSON per i turni dell'agente con supporto a `keep_alive` pinning.
* **`filesystem/fileSystemRepository.ts`**: Repository per la lettura, scrittura sicura, patch e rimpiazzo multi-chunk tollerante a CRLF.
* **`process/taskRunner.ts` & `process/persistentPowerShellSession.ts`**: Gestore di processi e sessioni PowerShell persistenti con mantenimento dello stato della shell e normalizzazione automatica dei comandi concatenati (`&&`) in sintassi condizionale PowerShell compatibile nativa.
* **`filesystem/skillRepository.ts`**: Repository per il caricamento, parsing YAML multi-line, verifica SHA-256 e persistenza globale cross-project (`userData/skills/`) e locale (`workspace/skills/`) con tracciamento dello stato attivo.
* **`http/skillHubClient.ts`**: Client di integrazione marketplace multi-hub con adapter specifici (Anthropic `agentskills.io`, LobeHub, Skills.sh, cataloghi JSON e repository GitHub) dotato di caching in-memory TTL e mitigazione rate-limiting.
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
