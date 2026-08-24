# Architettura & Blueprint Evolutivo: Coding Agent Studio — OnlyRag V2

Documento architetturale e piano operativo per l'evoluzione di **Coding Agent Studio** in OnlyRag V2: analisi dello stato corrente, identificazione dei gap, selezione delle librerie universali, progettazione del flusso end-to-end e standard per la compatibilità universale con modelli Ollama (SLM e Frontier).

---

## 1. Analisi di Sistema: "Cosa c'è" vs "Presente ma non efficace" vs "Cosa manca"

```mermaid
mindmap
  root((Coding Agent Studio))
    File System & Progetti
      Cosa c'è
        Tool I/O completi (read, write, fuzzy replace, multi-replace, delete)
        AtomicWorkspaceJournal (Snapshot & Rollback atomico)
        AST Repo Map (compactSemanticRepoMapper)
        Dependency Scanner (package.json, tsconfig)
        Git Toolchain (status, diff, commit)
      Cosa manca
        RAG vettoriale del codice sorgente su LanceDB
        Scaffolding deterministico multi-stack senza prompt interattivi bloccanti
        LSP / TypeScript compiler in-flight feedback
    Debug & Auto-Healing
      Cosa c'è
        Shell PowerShell persistente supervisionata
        Riduzione diagnostica stack trace (diagnosticOutputReducer)
        Intercettazione lazy ask (agentOrchestratorAskAutoHealing)
        Gate import non dichiarati post-write (importDeclarationGate)
      Presente ma non efficace
        Definition of Done Gate su build reale (raggiunto solo se la sessione arriva a finish)
        Rilevatore oscillazioni e stagnazione (blocca ma non produce avanzamento)
        Recupero dai conflitti npm ERESOLVE (npmResolutionConflict)
      Cosa manca
        Typecheck incrementale post-write (la sintassi e' gia' coperta da validateAST)
        Freno alla ripetizione di comandi gia' riusciti
        Auto-reclaim di porte e processi orfani da shell
    Browser & Validazione Visiva
      Cosa c'è
        open_in_browser esterno (OS shell)
        Policy di verifica per file statici
      Cosa manca
        Feedback loop visivo e screenshot automatico
        Cattura console.error JS e codici di rete 404/500
        Headless browser / Offscreen Webview integrato
    Generazione Artefatti
      Cosa c'è
        Monaco DiffEditor e Git Diff Panel
        Cronologia sessioni JSON
      Cosa manca
        Sistema formale di First-Class Artifacts
        Pannello UI Live Preview (React/HTML/Tailwind sandboxato)
        Visualizzatore diagrammi Mermaid e report Markdown interattivi
        1-Click Export (.zip / bundle)
    Planner Strutturato
      Cosa c'è
        Parser canonico e capping a 15 milestone (planMilestoneCapper)
        Probe su disco per deliverable reali (workspaceDeliverableProbe)
        Promozione milestone solo con tutti i deliverable presenti
      Presente ma non efficace
        Microtask orientati ai file invece che alle funzionalità
      Cosa manca
        Pianificazione gerarchica a 4 macro-fasi
        Sub-task branching dinamico su imprevisti tecnici
    Compatibilita Universale Ollama
      Cosa c'è
        toolParser tollerante con jsonrepair
        Pre-stripping tag CoT (<think>...</think>)
        Dual-mode routing (Native Tool Calling / JSON fenced)
        Pinning KV-cache e profili hardware
        Direttiva di correzione schema su tool call rifiutata
      Cosa manca
        Template prompt modulari tarati sulla famiglia del modello
```

---

### 1.1. Gestione File System Locale & di Progetto
* **Presente**:
  * Toolchain atomica per manipolazione file: `read_file` (con line slicing), `write_file`, `replace_file_content` (con fuzzy matching basato su `fast-levenshtein`), `multi_replace_file_content`, `create_directory`, `copy_file`, `move_file`, `delete_file`, `list_dir`, `list_files_recursive`, `grep_search`, `get_file_info`.
  * [`AtomicWorkspaceJournal`](../electron/core/infrastructure/filesystem/atomicWorkspaceJournal.ts): snapshot preventivo in memoria di ogni file modificato e `rollbackAll()` immediato su abort o fallimento.
  * [`compactSemanticRepoMapper`](../electron/core/domain/agent/compactSemanticRepoMapper.ts): albero compatto dei simboli esportati (`class`, `function`, `interface`, `type`) per orientare l'agente senza saturare il context budget.
  * [`dependencyScanner`](../electron/core/infrastructure/filesystem/dependencyScanner.ts) e [`dependencyIntegrityGate`](../electron/core/domain/agent/dependencyIntegrityGate.ts): rilevamento proattivo di pacchetti importati ma assenti da `package.json`.
  * Versionamento Git integrato (`git_status`, `git_diff`, `git_commit`).
* **Mancante**:
  * **RAG Vettoriale Locale per il Codice Sorgente**: Indicizzazione incrementale dei file di codice su LanceDB con chunking semantico per funzioni/classi, per navigare codebase complesse.
  * **Scaffolding Deterministico Multi-Stack**: Modelli di generazione sicuri per stack moderni (React+Vite, FastAPI, Cargo, Next.js) senza invocare comandi CLI interattivi soggetti a freeze.
  * **Refactoring AST Programmatico**: Trasformazioni di codice guidate da parser AST (`@babel/parser`, `ts-morph` o `tree-sitter`) per modifiche strutturali complesse.

---

### 1.2. Gestione Debug Errori & Autocorrezione (Auto-Healing)
* **Presente**:
  * Terminale PowerShell persistente non-interattivo con `CI=true` e blocco comandi distruttivi ([`commandSecurity.ts`](../electron/core/domain/agent/commandSecurity.ts)).
  * [`diagnosticOutputReducer`](../electron/core/domain/agent/diagnosticOutputReducer.ts) e [`autoHealingLogCapper`](../electron/core/domain/agent/autoHealingLogCapper.ts): estrazione compatta degli stack trace di errore con iniezione nel turno successivo (`[TERMINAL AUTO-HEALING DIAGNOSTICS LOG]`).
  * [`agentOrchestratorAskAutoHealing.ts`](../electron/core/application/agentOrchestratorAskAutoHealing.ts): intercettazione di richieste di permesso o stallo passivo in modalità AGENT con redirezione automatica all'implementazione.
  * [`AgentActionLoopDetector`](../electron/core/domain/agent/loopDetector.ts) con hashing SHA-256 e [`loopEscapePolicy.ts`](../electron/core/domain/agent/loopEscapePolicy.ts) per spezzare cicli e avanzare milestone stagnanti.
* **Presente ma non efficace** (rilevato in `coding_agent_audit.log`, sessione `session-1787562597025-q8a5`):
  * **Definition of Done Gate** ([`verificationGatePolicy.ts`](../electron/core/domain/agent/verificationGatePolicy.ts), [`TransactionalExecutionGuard`](../electron/core/application/agentOrchestratorFinishAndLoopGuards.ts)): blocca `finish` senza build passata, ma si attiva **solo quando il modello chiama `finish`**. La sessione osservata è morta al passo 45 sul circuit breaker, quindi il gate — e con lui [`dependencyIntegrityGate`](../electron/core/domain/agent/dependencyIntegrityGate.ts), che gira dentro [`agentOrchestratorVerificationRunner.ts`](../electron/core/application/agentOrchestratorVerificationRunner.ts) — non è mai stato raggiunto. Tre import verso pacchetti inesistenti sono rimasti su disco.
  * **Rilevatore di loop**: identifica correttamente la ripetizione, ma la sua unica risposta è testo che vieta un'azione. In 12 dei 45 passi ha bloccato senza produrre avanzamento, e le direttive iniettate si accumulano nel prompt fino a saturarlo (dagli step 35–45 il prompt resta fisso a 22.237 caratteri, in gran parte blocchi `[FAILURE at Step N]` quasi identici).
* **Mancante**:
  * **Feedback Sintattico/LSP Istantaneo**: Notifica di errori di tipo TypeScript / sintassi subito dopo `write_file`, prima della compilazione globale. **Priorità alta**: nella sessione osservata gli import inventati erano visibili al passo 11 e sono emersi solo trenta passi dopo.
  * **Auto-Reclaim Processi Orfani**: Identificazione e chiusura automatica di processi che occupano porte locali di sviluppo.

---

### 1.3. Browser per Test di Validazione Visiva
* **Presente**:
  * `open_in_browser`: delega l'apertura all'OS (`shell.openExternal`/`shell.openPath`).
  * [`browserPreviewVerification.ts`](../electron/core/domain/agent/browserPreviewVerification.ts): regola che limita la prova di verifica tramite browser ai soli file statici renderizzabili (`.html`, `.svg`, `.pdf`).
* **Mancante (Gap Critico)**:
  * **Feedback Loop Visivo**: L'agente è attualmente cieco all'esito visivo. Non riceve screenshot, né log di errori runtime (`console.error`), né codici di errore HTTP 404/500 per gli asset.
  * **Headless Browser Runner Integrato**: Modulo di validazione visiva (via Electron Offscreen `WebContents` o `playwright-core`) capace di caricare la pagina in background, catturare screenshot ad alta fedeltà, intercettare errori JavaScript e produrre un report di layout leggibile dall'agente (e interpretabile da modelli Vision come `llama3.2-vision` / `qwen2.5-vl`).

---

### 1.4. Generazione Artefatti (Artifacts System)
* **Presente**:
  * Visualizzazione modifiche tramite Monaco DiffEditor e Git Diff Panel.
  * Cronologia delle sessioni salvata in `.onlyrag/sessions/session_history.json`.
* **Mancante (Gap Critico)**:
  * **Sistema di Artefatti di Prima Classe (First-Class Artifacts Engine)**: Modello dati formale per artefatti generati (UI Component, Web App interattiva, Diagramma Mermaid, Documento Tecnico, Walkthrough).
  * **Pannello UI Live Artifacts Preview**: Scheda dedicata nell'interfaccia con iframe sandboxato per il rendering live di componenti React/HTML/Tailwind, rendering SVG di diagrammi Mermaid e visualizzazione Markdown avanzata con export 1-click (`.zip` o bundle).

---

### 1.5. Planner Strutturato
* **Presente**:
  * [`GoalDecompositionPlanner`](../electron/core/domain/agent/planAndSolveGraph.ts) con microtask sequenziali atomici (`- [ ] m-N: ... — verify: <cmd>`).
  * Normalizzatore di falsificabilità, capping deterministico a 15 milestone ([`planMilestoneCapper.ts`](../electron/core/domain/agent/planMilestoneCapper.ts)) e parser canonico unificato.
  * Probe su disco ([`workspaceDeliverableProbe.ts`](../electron/core/infrastructure/filesystem/workspaceDeliverableProbe.ts)) per escludere file placeholder con soli TODO.
  * Filtro di falsificabilità sui comandi di verifica ([`verificationCommandSafety.ts`](../electron/core/domain/agent/verificationCommandSafety.ts)): sei famiglie di rifiuto (mutating, vacuous, existence-only, interactive, gui-mode, non-exiting).
* **Presente ma non efficace**:
  * **Microtask orientati ai file**: dieci milestone su quindici della sessione osservata dicevano "crea il file X"; nessuna esprimeva un comportamento verificabile ("la navigazione fra Dashboard e Tasks funziona"). Un piano di questa forma si può completare al 100% consegnando un'applicazione che non parte.
  * **Promozione milestone parziale** ([`agentOrchestratorPlanTool.ts`](../electron/core/application/agentOrchestratorPlanTool.ts)): quando `update_plan` esegue il `verificationCommand` della milestone e questo esce 0, la milestone è promossa a `verified` **senza alcun controllo sui deliverable** — a differenza della promozione post-build, che passa da [`milestoneVerificationPromotion.ts`](../electron/core/domain/agent/milestoneVerificationPromotion.ts) e richiede tutti i file presenti. `m-2` ("crea `vite.config.ts` e `tsconfig.json`") è stata verificata senza `tsconfig.json`, rendendo impossibile lo `tsc && vite build` dichiarato dal progetto stesso.
* **Mancante**:
  * **Pianificazione Gerarchica a Fasi (4 Macro-Fasi Standard)**:
    1. `Phase 1: Research & Workspace Inventory`
    2. `Phase 2: Core Architecture & Scaffolding`
    3. `Phase 3: Implementation & Component Logic`
    4. `Phase 4: Build Verification, Visual Validation & Artifact Delivery`
  * **Sub-Task Branching Dinamico**: Possibilità di decomporre una milestone in sotto-task operativi quando l'agente rileva complessità impreviste senza corrompere l'avanzamento globale.

---

### 1.6. Compatibilità Universale Modelli Ollama (SLM & Frontier)
* **Presente**:
  * [`toolParser.ts`](../electron/core/domain/agent/toolParser.ts) con pre-stripping tag CoT (`<think>...</think>`), pulizia stringhe e riparazione JSON con `jsonrepair`.
  * Supporto sia per Ollama Native Tool Calling (`POST /api/chat`) che per prompt JSON fenced delimitati.
  * Hardware Ladder unificato con pinning della KV-cache (`keep_alive`, freeze di `num_ctx`).
  * **Correzione schema guidata sugli SLM**: quando una tool call viene rifiutata dalla validazione dei parametri, `buildToolSchemaCorrectionDirective` ([`ollamaToolSchemaCatalog.ts`](../electron/core/domain/agent/ollamaToolSchemaCatalog.ts)) rimanda al modello i parametri obbligatori, quelli opzionali e l'envelope JSON esatto da emettere. Il feedback precedente era una singola frase che non nominava ne' il tool ne' il parametro. `zod` non e' stato adottato: il contratto dei parametri e' gia' dichiarato una volta in questo catalogo e una seconda fonte divergerebbe.
* **Mancante**:
  * **Prompt Adapters per Famiglia di Modello**: Ottimizzazione del formato dei messaggi in base alla famiglia del modello (Qwen, Llama, DeepSeek-R1, Mistral).

---

## 2. Direttiva Anti-Hardcoding: Librerie Universali Standard

In conformità con `AGENTS.md`, le logiche di sistema sono delegate a librerie mature e testate.

La colonna **Stato** distingue ciò che è già dichiarato in `package.json` da ciò che questa sezione si limita a proporre: la versione precedente del documento elencava otto pacchetti non installati sotto l'intestazione "Libreria Adottata", e un lettore — umano o agente che riceve il documento come contesto — ne concludeva che quelle capacità esistessero già.

| Ambito | Libreria | Stato | Funzione & Motivazione Tecnica |
| :--- | :--- | :--- | :--- |
| **Parsing & Riparazione JSON** | `jsonrepair` | ✅ in uso | Ripara JSON corrotti/incompleti generati da SLM quantizzati. |
| **Validazione Schemi a Runtime** | `ollamaToolSchemaCatalog.ts` (interno) | ✅ in uso | Contratto dei parametri di ogni tool dichiarato una volta sola e usato sia per il native tool calling sia per generare la direttiva di correzione quando una chiamata viene rifiutata. **`zod` non e' stato adottato**: duplicherebbe questo catalogo con una seconda fonte di verita' divergente. La coercizione degli alias resta in `toolSchemaValidator.ts`. |
| **Fuzzy Matching & Diffing** | `fast-levenshtein` + `diff` | ✅ in uso | Distanze di modifica deterministiche per il patching del codice. |
| **Rendering Diff Visivi** | `diff2html` | ⬜ da adottare | Rendering HTML dei diff. Oggi la UI usa Monaco DiffEditor. |
| **Validazione AST** | `typescript` | ✅ in uso (solo build) | Compiler API disponibile ma non ancora invocata come check post-write. |
| **Parsing AST alternativo** | `@babel/parser` | ⬜ da adottare | Necessario solo per stack non-TypeScript. |
| **Risoluzione Percorsi & Globbing** | `fast-glob` + `pathe` | ⬜ da adottare | Oggi la scansione usa `node:fs` diretto e `node:path`. |
| **Browser & Validazione Visiva** | Electron Offscreen `WebContents` | ⬜ da adottare | Runtime già presente (Electron), modulo di cattura non ancora scritto. |
| **Browser headless alternativo** | `playwright-core` | ⬜ da adottare | Alternativa a Offscreen `WebContents`; sceglierne una sola. |
| **Web Scraping & Markdown** | `cheerio` + `turndown` | ✅ in uso | Parsing DOM resiliente e conversione HTML→Markdown compatto. |
| **Esecuzione Processi & Shell** | `node:child_process` | ✅ in uso | `persistentPowerShellSession.ts`, sessione persistente non-interattiva. |
| **Esecuzione Processi (ergonomia)** | `execa` | ⬜ da adottare | Sostituto opzionale; la sessione persistente attuale copre già timeout e streaming. |

---

## 3. Flusso End-to-End Robusto: Dal Prompt all'Esecuzione

```mermaid
sequenceDiagram
    autonumber
    actor User as Utente
    participant UI as Studio UI (React 19)
    participant Orchestrator as Agent Orchestrator (App Service)
    participant Planner as GoalDecompositionPlanner (Domain)
    participant LLM as Ollama Runtime / Model
    participant Parser as ToolParser & Schema Validator
    participant Journal as Atomic Workspace Journal
    participant Tools as Tool Handlers (FS, Browser, Artifacts, Shell)
    participant Gate as Verification & DoD Gate

    User->>UI: Inserimento prompt ("Crea dashboard React con grafici e visual preview")
    UI->>Orchestrator: startAgentSession(prompt, mode, workspace)
    Orchestrator->>Orchestrator: Risoluzione profilo hardware & Context Budgeting
    Orchestrator->>Planner: Genera piano a 4 Fasi con comandi di verifica falsificabili
    Planner-->>Orchestrator: PlanMilestones[] (max 15 microtask)
    Orchestrator->>UI: Emissione stato iniziale piano (Plan Checklist)

    loop Multi-Turn Autonomous Tool Loop (Fino a completamento o maxSteps)
        Orchestrator->>LLM: Invia prompt assemblato (Repo Map + Skills + History + Active Milestone)
        LLM-->>Orchestrator: Generazione in streaming (CoT <think> + Tool Call)
        Orchestrator->>Parser: Isola CoT, ripara JSON con jsonrepair e valida contro il catalogo dei tool
        
        alt Tool Call Valida
            Orchestrator->>Journal: createSnapshot(targetFiles)
            Orchestrator->>Tools: Esegui tool (write_file, run_command, visual_inspect, create_artifact)
            Tools-->>Orchestrator: ToolExecutionResult (stdout, screenshot, diff, status)
            
            alt Errore di Esecuzione / Test Fallito
                Orchestrator->>Orchestrator: diagnosticOutputReducer: estrai stack trace
                Orchestrator->>LLM: Inietta blocco diagnostico per auto-healing immediato
            else Esecuzione Riuscita
                Orchestrator->>Planner: workspaceDeliverableProbe: valida presenza deliverable reale
                Planner-->>Orchestrator: Avanzamento milestone (verified / in_progress)
            end
        else JSON non valido / Loop Rilevato
            Orchestrator->>Orchestrator: loopEscapePolicy o direttiva di correzione schema; force advance se necessario
        end
    end

    Orchestrator->>Gate: validateTaskCompletion (Verifica finale: build/test reali)
    alt Build Passata con Successo
        Gate-->>Orchestrator: All checks passed
        Orchestrator->>Journal: commit() (Consolida modifiche su disco)
        Orchestrator->>UI: Consegna sessione, Walkthrough, Artefatti e Diff completi
    else Build Fallita
        Gate-->>Orchestrator: Error trace
        Orchestrator->>LLM: Auto-healing cycle finale (max 3 tentativi)
    end
```

---

## 4. Architettura dei Tool Refattorizzata (Single Responsibility Principle)

Per eliminare il monolite [`agentToolExecutorService.ts`](../electron/core/application/agentToolExecutorService.ts), l'architettura dei tool viene scomposta in moduli a responsabilità singola sotto `electron/core/domain/agent/tools/`:

```
electron/core/domain/agent/tools/
├── fs/
│   ├── readFileTool.ts              # Line slicing, bounds check, path safety
│   ├── writeFileTool.ts              # AST pre-validation, atomic file writer
│   ├── fuzzyPatchTool.ts             # fast-levenshtein fuzzy replace & multi-replace
│   ├── fileExplorerTools.ts          # list_dir, list_files_recursive, glob
│   └── codeSymbolExtractorTool.ts    # TypeScript Compiler API AST extractor
├── execution/
│   ├── runCommandTool.ts             # PowerShell session, timeout policy, CI env
│   ├── runTestsTool.ts               # Test result parser (vitest, jest, pytest, cargo)
│   └── devToolchainTools.ts          # inspect_os_env, ensure_tool (winget)
├── browser/
│   ├── visualValidationTool.ts       # Offscreen Webview/Playwright screenshot & DOM inspect
│   └── consoleLogsExtractorTool.ts   # Intercettazione console.error, 404 assets
├── artifacts/
│   ├── artifactCreationTool.ts       # Registrazione formale artefatti (React, HTML, MD, SVG)
│   └── artifactExportTool.ts         # Zip bundle e render export
├── web/
│   ├── webSearchTool.ts              # DuckDuckGo SSRF-safe web search
│   └── fetchWebContentTool.ts        # Cheerio scraping + Turndown markdown converter
├── git/
│   ├── gitStatusTool.ts              # Git working tree status
│   └── gitCommitDiffTools.ts         # Git diff compute & atomic commit
└── diagnostics/
    ├── askClarificationTool.ts       # Clarification & permission interceptor
    └── finishTaskTool.ts             # Definition of Done gate trigger
```

---

## 5. Prossimi Passi di Sviluppo

L'ordine è vincolato: le funzionalità nuove poggiano su cicli di feedback che devono prima chiudersi. Un modulo di validazione visiva non serve a un progetto che non compila, e un motore di artefatti non serve a una sessione che muore al passo 45.

### 5.1. Completato — cicli di feedback riaperti

* **L'agente riceve di nuovo gli errori.** `run_command`, `run_tests`, `ensure_tool` e la verifica delle milestone univano i due flussi con `res.stdout || res.stderr`: siccome `npm` scrive sempre un banner su stdout, lo stderr veniva scartato ogni volta e il modello riceveva "exit code 1" con un blocco diagnostico vuoto, sotto una direttiva che gli chiedeva di ispezionare uno stack trace mai mostrato. Sostituito da `DiagnosticOutputReducer.composeCommandOutput`.
* **Il guard delle installazioni non annulla più l'install che serve.** Controllava solo `package.json`: in un workspace generato dall'agente ogni dipendenza risulta "già installata" mentre `node_modules` non esiste. Ora richiede anche la presenza su disco (`agentToolFileRepository.missingFromNodeModules`).
* **Le verifiche non falsificabili sono rifiutate.** [`verificationCommandSafety.ts`](../electron/core/domain/agent/verificationCommandSafety.ts) ha due famiglie nuove: *existence-only* (`cat`, `Get-Content`, `ls`, `Test-Path` — passano per qualunque file esista, incluso quello appena scritto) e *gui-mode* (`cypress open`, `--ui`, `--headed`, più gli opener di sistema). Le ricerche di contenuto (`grep`, `findstr`, `Select-String`) restano ammesse: falliscono quando il file esiste ma è sbagliato, che è una vera affermazione sul codice.
* **Le direttive anti-loop non mentono più sulla propria durata.** Dicevano "You are FORBIDDEN from calling run_command on 'npm run build'" — il comando che il Definition of Done Gate esige — mentre il rilevatore ha in realtà una finestra di 5 passi. Ora dichiarano l'ambito reale (la chiamata identica, finché nulla cambia) e indicano l'uscita: leggere l'errore, correggerlo, rieseguire.

### 5.2. Completato — i controlli anticipati

* **Import allucinati intercettati alla scrittura.** [`importDeclarationGate.ts`](../electron/core/domain/agent/importDeclarationGate.ts) estrae i package importati dal file appena scritto e li confronta con `package.json` (alias `tsconfig.paths` inclusi). Il file viene comunque salvato — buttarlo costerebbe il turno che lo ha prodotto — ma il risultato del tool porta la lista dei pacchetti non dichiarati. Verificato live: `@vitejs/plugin-react`, `@tailwindcss/react`, `react-router-dom` e `tailwindcss-react-components` segnalati al passo in cui sono stati scritti, invece che mai.
* **Milestone verificabili solo con i deliverable presenti.** [`milestoneUpdateAuthority.ts`](../electron/core/domain/agent/milestoneUpdateAuthority.ts) rifiuta `verified` finche' un file dichiarato dal titolo manca, e' vuoto o e' un placeholder, nominando i file mancanti. Le milestone senza artefatto (`not_applicable`) restano chiudibili dal loro comando.
* **`write_file` distingue file e directory.** Un path che termina con separatore viene instradato a `create_directory` (o rifiutato se porta contenuto). Verificato live su `src/services/`, che nella sessione originale aveva prodotto un file da 0 byte.
* **Blocchi di fallimento deduplicati per tool+target sull'intero buffer**, non solo sull'ultimo elemento: l'alternanza A,B,A,B che riempiva il prompt non si accumula piu'.
* **Report di chiusura reale**: `compileSessionStopSummary` sostituisce la stringa interna del circuit breaker con motivo, milestone completate e aperte, e file toccati. Il `SESSION_TRACKER.md` non dichiara piu' "all verified" quando restano milestone aperte.
* **Rifiuto di una tool call con il contratto del tool**: `buildToolSchemaCorrectionDirective` rende i parametri obbligatori, quelli opzionali e l'esempio JSON esatto, al posto della frase generica precedente.

### 5.3. Completato — recupero dai conflitti di versione

* **`npm ERESOLVE` diventa un'istruzione eseguibile.** [`npmResolutionConflict.ts`](../electron/core/domain/agent/npmResolutionConflict.ts) legge dal report di npm quale versione e' installata e quale viene richiesta, e produce il comando esatto che risolve — con l'intervallo copiato verbatim da npm, mai sintetizzato. Prima, sopra quell'output c'era la direttiva generica "locate the failing file, syntax, or command parameter", che mandava il modello a riscrivere file che non erano il problema.
* **Il guard delle installazioni distingue una versione da un nome.** `npm install vite@^8.0.0` non e' una reinstallazione: chiede un cambio di versione. Confrontando solo i nomi, il guard rispondeva "vite e' gia' installato" e annullava proprio il comando che risolve il conflitto.
* **Nomi di tool inventati vengono rifiutati.** `normalizeToolName` restituiva qualunque stringa come se fosse un tool valido: in un run il passo 1 e' stato `npm_install`, dispacciato a un executor che non ha un handler per quel nome. Ora il catalogo dei tool decide, e il rifiuto porta con se' l'elenco dei tool reali.
* **Verificato live**: partendo da `vite@4.5.14` installato e da un `npm install @vitejs/plugin-react@6.1.0` che non puo' risolvere, il modello ha eseguito il comando indicato dalla direttiva (`npm install vite@^8.0.0`), poi ha ripetuto l'installazione del plugin con successo. Nessun ricorso a `--force` o `--legacy-peer-deps`. Nel run precedente, con la stessa situazione, si era fermato a chiedere all'utente quale opzione preferisse.

> Nota sul tono delle direttive: la prima stesura elencava due opzioni e diceva "Pick ONE and run it now". Il modello le ha lette, capite, e ha girato la scelta all'utente con `ask` — in modalita' AGENT, dove non c'e' nessuno che risponda. Una direttiva che offre una decisione a un modello lo invita a delegarla. Ora c'e' una sola istruzione imperativa e un ripiego, non un menu.

### 5.4. Prossimo — cio' che i run live hanno messo in evidenza

**1. Churn: il modello ripete lavoro gia' riuscito.** E' il collo di bottiglia attuale, ed e' quello che oggi impedisce a una sessione di arrivare a `finish`.
* Sintomo A: rilancia un comando **passato**. Nel probe ERESOLVE ha rieseguito quattro volte un `npm run build` che era gia' verde, invece di chiudere. Il guard glielo dice (`[REDUNDANT ACTION: ... ALREADY SUCCEEDED]`) e lui lo rifa'.
* Sintomo B: riscrive lo stesso file. 21-31 `write_file` per ~14 file in una sessione da 50 passi.
* Dove guardare: [`loopDetector.ts`](../electron/core/domain/agent/loopDetector.ts) sezione 1 (finestra di 5 passi sulla fingerprint) e [`loopEscapePolicy.ts`](../electron/core/domain/agent/loopEscapePolicy.ts) (`REDUNDANT_SUCCESS_ADVISORY_ATTEMPTS = 3`). Il ramo "ripetizione riuscita" e' deliberatamente esente dalla scala di stagnazione — vedi il commento in `resolveRedundantSuccessAction`, scritto per non abbandonare milestone il cui lavoro era davvero avvenuto. L'esenzione e' corretta ma oggi non porta a nulla: dopo gli avvisi il modello non ha una mossa migliore da fare.
* Ipotesi da valutare (non ancora testata): quando la verifica del progetto e' **gia' passata** e non ci sono state mutazioni successive, il ripetersi di quello stesso comando dovrebbe portare il sistema a proporre `finish` in modo esplicito, non solo a scoraggiare la ripetizione. Il segnale esiste gia': `flags.hasVerifiedBuild` in [`agentOrchestratorCircuitBreakerAndVerification.ts`](../electron/core/application/agentOrchestratorCircuitBreakerAndVerification.ts), azzerato a ogni scrittura.

**2. Feedback sintattico esteso**: `validateAST` copre gia' la sintassi in pre-commit; manca il typecheck incrementale.

### 5.5. Poi — le funzionalità del blueprint

1. **Modulo Visual Validation**: Implementazione di `visualValidationTool.ts` basato su Electron Offscreen `WebContents` per screenshot automatici e cattura `console.error`. Non affrontato finora per una ragione precisa: richiede il runtime Electron, che il banco di prova headless (`npm run test:live`) non puo' esercitare. Va sviluppato lanciando l'app vera, altrimenti si consegna codice mai visto funzionare.
2. **First-Class Artifacts Engine**: Creazione del repository e dei canali IPC `artifacts:*` per registrare e mostrare anteprime live di componenti UI e documenti.
3. **Refactoring Modulare dei Tool**: Scomposizione di `agentToolExecutorService.ts` nella struttura modulare a singoli handler.

---

## 6. Come riprendere questo lavoro

Punto di ingresso per una sessione nuova, che non ha il contesto di quella in cui le tre onde sono state applicate.

**Stato.** Le sezioni 5.1, 5.2 e 5.3 sono applicate, coperte da test e verificate su sessioni reali. La 5.4 e' il lavoro successivo, in quell'ordine. La 5.5 e' il blueprint originale, che resta valido ma poggia su queste fondamenta.

**Verifica che la base sia sana** prima di toccare qualsiasi cosa:

```bash
npm run lint     # catena seriale completa: typecheck, test, build Electron, smoke test
```

**Osserva l'agente davvero**, perche' i difetti che restano sono comportamentali e i test unitari non li vedono:

```bash
npm run test:live
```

Vedi [agent-live-testing.md](./agent-live-testing.md) per i prerequisiti, le tre trappole che rendono un run live inutile senza che sembri, e come si progetta una sonda che il modello non possa aggirare.

**Il debito aperto** e' in `PROJECT_STATUS.json`, non in questo documento: qui c'e' il piano, li' c'e' la lista di cosa manca.

**Il principio che tiene insieme le tre onde**, e che vale per il lavoro che resta: il sistema accumulava sorveglianza invece di chiudere cicli. Ogni guard nuovo aggiungeva testo al prompt e un'altra azione vietata, e nessuno di loro poteva *fare* qualcosa. Le correzioni applicate non hanno aggiunto guard: hanno reso osservabile cio' che gia' accadeva (l'errore vero), falsificabile cio' che era una formalita' (la verifica delle milestone), e azionabile cio' che era solo un divieto (le direttive). Prima di aggiungere un controllo, verifica che non ne esista gia' uno posizionato dove non puo' scattare.
