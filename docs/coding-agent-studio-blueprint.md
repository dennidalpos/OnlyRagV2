# Architettura & Blueprint Evolutivo: Coding Agent Studio — OnlyRag V2

Documento architetturale e operativo di riferimento per il sottosistema Coding Agent Studio. Descrive lo stato dei componenti, le policy anti-hardcoding, il flusso end-to-end, i meccanismi di auto-healing e le evidenze empiriche misurate con modelli locali Ollama.

> Per riprendere lo sviluppo da una nuova sessione, consultare [§6. Guida Operativa & Principi](#6-guida-operativa--principi). Il debito tecnico aperto è tracciato in `PROJECT_STATUS.json`.

---

## 1. Analisi di Sistema

```mermaid
mindmap
  root((Coding Agent Studio))
    File System & Progetti
      Cosa c'è
        Tool I/O atomici completi (read, write, fuzzy/multi-replace, delete)
        AtomicWorkspaceJournal (Snapshot & Rollback atomico)
        AST Repo Map (compactSemanticRepoMapper)
        Dependency Scanner & Gate
        Git Toolchain (status, diff, commit)
      Cosa manca
        RAG vettoriale sorgenti su LanceDB
        Scaffolding deterministico multi-stack
        LSP / Feedback AST incrementale
    Debug & Auto-Healing
      Cosa c'è
        Shell PowerShell persistente non-interattiva
        diagnosticOutputReducer & autoHealingLogCapper
        Intercettazione lazy ask
        importDeclarationGate & undeclaredImportScanner
        redundantWriteDetector & postVerificationClosure
        planDirectiveArbiter a 6 priorità
        toolRejectionEscalation a 3 livelli
      Presente ma non efficace
        DoD Gate isolato (eseguito solo su comando finish)
        Loop detector solo restrittivo (senza vie d'uscita concrete)
      Cosa manca
        Typecheck incrementale post-write in-flight
        Auto-reclaim porte e processi orfani
    Browser & Validazione Visiva
      Cosa c'è
        open_in_browser esterno (OS shell)
        Policy di verifica file statici renderizzabili
      Cosa manca
        Runner headless (Electron Offscreen WebContents / Playwright)
        Cattura automatica screenshot, console.error e 404/500
    Generazione Artefatti
      Cosa c'è
        Monaco DiffEditor & Git Diff Panel
        Cronologia sessioni JSON
      Cosa manca
        Sistema formale First-Class Artifacts
        Live Preview sandboxata (React/HTML/Tailwind)
        Rendering diagrammi Mermaid e report interattivi
        1-Click Export (.zip / bundle)
    Planner Strutturato
      Cosa c'è
        GoalDecompositionPlanner (max 15 milestone)
        workspaceDeliverableProbe su disco
        milestoneUpdateAuthority (promozione condizionata)
        Iniezione deterministica entrypoint e runnable milestone
        Microtask capacità + path (falsificabili)
        Direttive unprovable, partial-delivery e deferred-notes
      Presente ma non efficace
        Deliverable cartella nuda (convertiti in criteri)
      Cosa manca
        Sub-task branching dinamico
    Compatibilità Ollama
      Cosa c'è
        toolParser tollerante con jsonrepair e pre-strip CoT
        Dual-mode Native Tool Calling / JSON fenced
        Ladder hardware con KV-cache pinning
        buildToolSchemaCorrectionDirective
        codingModelMatrix con metriche reali
      Presente ma non efficace
        num_ctx dimensionato solo da RAM/VRAM e non da Ollama
      Cosa manca
        Prompt adapter modulari per famiglia di modello
```

### 1.1. File System & Progetto
* **Presente**: Toolchain atomica I/O ([`atomicWorkspaceJournal.ts`](../electron/core/infrastructure/filesystem/atomicWorkspaceJournal.ts) con `rollbackAll()`, fuzzy patch via `fast-levenshtein`, multi-replace, tree walk); [`compactSemanticRepoMapper.ts`](../electron/core/domain/agent/compactSemanticRepoMapper.ts); [`dependencyScanner.ts`](../electron/core/infrastructure/filesystem/dependencyScanner.ts) e [`dependencyIntegrityGate.ts`](../electron/core/domain/agent/dependencyIntegrityGate.ts); integrazione Git nativa.
* **Manca**: RAG vettoriale del codice su LanceDB (chunking per classe/funzione); scaffolding deterministico multi-stack non interattivo; refactoring programmatico AST (`ts-morph` / `@babel/parser`).

### 1.2. Debug & Auto-Healing
* **Presente**: PowerShell persistente supervisionata (`CI=true`, blocco comandi distruttivi in [`commandSecurity.ts`](../electron/core/domain/agent/commandSecurity.ts)); [`diagnosticOutputReducer.ts`](../electron/core/domain/agent/diagnosticOutputReducer.ts) e [`autoHealingLogCapper.ts`](../electron/core/domain/agent/autoHealingLogCapper.ts); [`agentOrchestratorAskAutoHealing.ts`](../electron/core/application/agentOrchestratorAskAutoHealing.ts) anti-stallo; [`loopDetector.ts`](../electron/core/domain/agent/loopDetector.ts) e [`loopEscapePolicy.ts`](../electron/core/domain/agent/loopEscapePolicy.ts).
* **Presente ma non efficace**: Il **Definition of Done Gate** ([`verificationGatePolicy.ts`](../electron/core/domain/agent/verificationGatePolicy.ts)) interviene solo alla chiamata di `finish`: se la sessione non raggiunge il finish, il gate non gira; il loop detector tradizionale impone divieti senza offrire un'azione risolutiva.
* **Manca**: Feedback LSP/typecheck istantaneo post-`write_file`; auto-reclaim dei processi orfani sulle porte di sviluppo.

### 1.3. Browser & Validazione Visiva
* **Presente**: `open_in_browser` su shell OS; [`browserPreviewVerification.ts`](../electron/core/domain/agent/browserPreviewVerification.ts) limitato a file statici (`.html`, `.svg`, `.pdf`).
* **Manca (gap critico)**: Headless runner (Electron Offscreen `WebContents` o `playwright-core`) per screenshot automatici, intercettazione `console.error` e log HTTP 404/500, fruibili anche da modelli Vision (`llama3.2-vision`, `qwen2.5-vl`).

### 1.4. Artefatti
* **Presente**: Monaco DiffEditor, Git Diff Panel, log JSON in `.onlyrag/sessions/session_history.json`.
* **Manca (gap critico)**: Modello formale First-Class Artifacts (UI Component, webapp interattiva, diagrammi Mermaid, walkthrough) con pannello Live Preview sandboxato ed export 1-click in archivio `.zip`.

### 1.5. Planner Strutturato
* **Presente**: [`planAndSolveGraph.ts`](../electron/core/domain/agent/planAndSolveGraph.ts) con normalizzazione falsificabilità; [`planMilestoneCapper.ts`](../electron/core/domain/agent/planMilestoneCapper.ts) (max 15); [`workspaceDeliverableProbe.ts`](../electron/core/infrastructure/filesystem/workspaceDeliverableProbe.ts) anti-placeholder; filtri di sicurezza comando in [`verificationCommandSafety.ts`](../electron/core/domain/agent/verificationCommandSafety.ts) (6 famiglie di rifiuto); [`milestoneUpdateAuthority.ts`](../electron/core/domain/agent/milestoneUpdateAuthority.ts) che subordina la promozione alla presenza effettiva dei deliverable.
* **Presente ma non efficace**: Le milestone che nominano cartelle nude (`src/services/`) non sono dimostrabili direttamente come deliverable e vengono normalizzate in criteri di milestone reali.
* **Manca**: Sub-task branching dinamico su errori complessi.

### 1.6. Compatibilità Universale Ollama
* **Presente**: [`toolParser.ts`](../electron/core/domain/agent/toolParser.ts) con pre-stripping CoT (`<think>`) e riparazione via `jsonrepair`; dual-mode Native Tool Calling (`POST /api/chat`) e JSON fenced; hardware ladder con pinning KV-cache; [`ollamaToolSchemaCatalog.ts`](../electron/core/domain/agent/ollamaToolSchemaCatalog.ts) per contratti schema e direttive di correzione; [`codingModelMatrix.ts`](../src/services/codingModelMatrix.ts).
* **Presente**: `num_ctx` clampato al `context_length` addestrato del modello letto da `/api/tags` ([`selectModelForTurn`](../electron/core/application/agentOrchestratorPromptAssembly.ts)), con `num_predict` e `maxContextChars` riderivati dalla finestra clampata.

> **Decisione architetturale — adattamento per capability, non per famiglia.**
> L'adattamento del prompt avviene esclusivamente sulle **capability** che Ollama stesso dichiara
> su `/api/tags` (`tools`, `vision`), risolte da
> [`ollamaToolCallingCapability.ts`](../electron/core/domain/agent/ollamaToolCallingCapability.ts) e
> applicate come partial condizionali in
> [`promptCompiler.ts`](../electron/core/domain/agent/promptCompiler.ts). **Non esiste, e non deve
> esistere, branching per famiglia di modello** (Qwen, Llama, DeepSeek, Mistral).
>
> Motivazione: l'app è usata con modelli aggiornati in modo indipendente tra loro. Un adapter per
> famiglia è manutenzione moltiplicata per il numero di famiglie e invecchia a ogni release,
> mentre una capability dichiarata dal runtime è vera il giorno in cui il modello viene
> installato. Un modello nuovo funziona senza che nessuno lo abbia mai misurato. È lo stesso
> principio di §6.2.1 applicato alla compatibilità: preferire un dato oggettivo del sistema a una
> tassonomia mantenuta a mano.
>
> Corollario sul badge di [`codingModelMatrix.ts`](../src/services/codingModelMatrix.ts):
> `compatible` si deriva dalle capability live, `verified` resta riservato ai modelli per cui una
> sonda live è stata realmente eseguita e letta (oggi solo `qwen2.5-coder:7b`).

* **Manca**: Handshake automatico nei primi turni che latchi il modo di tool calling osservato quando `/api/tags` non dichiara nulla (Ollama datati), oggi coperto dal solo allow-list di famiglia come fallback.

---

## 2. Direttiva Anti-Hardcoding: Librerie Universali

| Ambito | Libreria / Modulo | Stato | Funzione & Motivazione |
| :--- | :--- | :--- | :--- |
| **Parsing & Riparazione JSON** | `jsonrepair` | ✅ in uso | Ripara payload JSON corrotti o troncati generati da SLM locali. |
| **Validazione Schemi Runtime** | `ollamaToolSchemaCatalog.ts` | ✅ in uso | Fonte unica di verità per Native Tool Calling e direttive di correzione. |
| **Fuzzy Matching & Diffing** | `fast-levenshtein` + `diff` | ✅ in uso | Patching deterministico tollerante e calcolo diff. |
| **Validazione AST** | `typescript` | ✅ in uso (build/pre-commit) | Compiler API per validazione sintattica pre-commit e typecheck. |
| **Web Scraping & Markdown** | `cheerio` + `turndown` | ✅ in uso | Parsing DOM sicuro e conversione HTML→Markdown per tool web. |
| **Esecuzione Shell** | `node:child_process` | ✅ in uso | Sessione PowerShell persistente non-interattiva (`persistentPowerShellSession.ts`). |
| **Rendering Diff Visivi** | `diff2html` | ⬜ da adottare | Rendering visuale diff in sostituzione o affiancamento a Monaco. |
| **Parsing AST non-TS** | `@babel/parser` | ⬜ da adottare | Supporto per file JSX/JS/Vue/Svelte non tipizzati. |
| **File Globbing** | `fast-glob` + `pathe` | ⬜ da adottare | Scansione FS universale multipiattaforma. |
| **Validazione Visiva Headless** | Electron Offscreen `WebContents` | ⬜ da adottare | Validazione visiva e cattura errori DOM/console senza dipendenze esterne. |
| **Browser Headless alternativo** | `playwright-core` | ⬜ da adottare | Alternativa ad Offscreen WebContents (selezionare una sola soluzione). |
| **Process Runner ergonomico** | `execa` | ⬜ da adottare | Alternativa per comandi one-shot con timeout/cancellazione integrati. |

---

## 3. Flusso End-to-End

```mermaid
sequenceDiagram
    autonumber
    actor User as Utente
    participant UI as Studio UI (React 19)
    participant Orchestrator as Agent Orchestrator (App Service)
    participant Planner as GoalDecompositionPlanner & Arbiter
    participant LLM as Ollama Runtime / Local SLM
    participant Parser as ToolParser & Schema Validator
    participant Journal as Atomic Workspace Journal
    participant Tools as Tool Handlers (FS, Exec, Web, Git)
    participant Gate as Verification & DoD Gate

    User->>UI: Richiesta utente (prompt e workspace target)
    UI->>Orchestrator: startAgentSession(prompt, mode, workspace)
    Orchestrator->>Orchestrator: Risoluzione profilo HW, Context Budgeting e Repo Map
    Orchestrator->>Planner: Genera piano con microtask (capacità + path) e iniezione entrypoint
    Planner-->>Orchestrator: PlanMilestones[] (max 15, falsificabili)
    Orchestrator->>UI: Emissione stato iniziale del piano

    loop Multi-Turn Autonomous Tool Loop (Fino a finish o maxSteps)
        Orchestrator->>Planner: planDirectiveArbiter.resolveNextDirective()
        Planner-->>Orchestrator: Direttiva attiva (closure | undeclared | missing | verification | unprovable | focus)
        Orchestrator->>LLM: Invia prompt (System + RepoMap + History + FocusDirective)
        LLM-->>Orchestrator: Risposta in streaming (CoT <think> + Tool Call)
        Orchestrator->>Parser: Isola CoT, ripara JSON (jsonrepair) e valida parametri

        alt Tool Call Valida
            Orchestrator->>Journal: createSnapshot(targetFiles)
            Orchestrator->>Tools: Esegui tool (write_file, run_command, ecc.)
            Tools-->>Orchestrator: ToolExecutionResult (stdout, stderr, exitCode, noOpMutation)

            alt Errore di Esecuzione / Fallimento Test
                Orchestrator->>Orchestrator: diagnosticOutputReducer: estrai diagnostica compatta
                Orchestrator->>LLM: Inietta blocco diagnostico specifico per auto-healing
            else Esecuzione Riuscita
                Orchestrator->>Planner: workspaceDeliverableProbe + milestoneUpdateAuthority
                Planner-->>Orchestrator: Aggiornamento milestone (verified / in_progress)
            end
        else Rifiuto Schema / Loop Rilevato
            Orchestrator->>Orchestrator: toolRejectionEscalation / loopEscapePolicy
            Orchestrator->>LLM: Invia schema esatto o scala a fallback write_file
        end
    end

    Orchestrator->>Gate: validateTaskCompletion (Build reale & Typecheck globale)
    alt Build & Typecheck Verificate
        Gate-->>Orchestrator: All checks passed
        Orchestrator->>Journal: commit() (Consolida su disco)
        Orchestrator->>UI: Sessione completata, Walkthrough, Artefatti e Diff
    else Fallimento Verifica Finale
        Gate-->>Orchestrator: Error trace
        Orchestrator->>LLM: Ciclo di auto-healing finale guidato da diagnostica
    end
```

---

## 4. Architettura dei Tool Refattorizzata (SRP)

Scomposizione prevista del servizio monolitico [`agentToolExecutorService.ts`](../electron/core/application/agentToolExecutorService.ts) sotto `electron/core/domain/agent/tools/`:

```
tools/
├── fs/          readFileTool · writeFileTool (pre-validazione AST) · fuzzyPatchTool
│                fileExplorerTools (list_dir, list_files_recursive, glob) · codeSymbolExtractorTool
├── execution/   runCommandTool (PowerShell non-interattiva, timeout, CI) · runTestsTool (vitest/jest/pytest)
│                devToolchainTools (inspect_os_env, ensure_tool)
├── browser/     visualValidationTool (Offscreen/Playwright screenshot & DOM) · consoleLogsExtractorTool
├── artifacts/   artifactCreationTool (React, HTML, MD, SVG) · artifactExportTool (zip bundle, preview)
├── web/         webSearchTool (SSRF-safe) · fetchWebContentTool (cheerio + turndown)
├── git/         gitStatusTool · gitCommitDiffTools
└── diagnostics/ askClarificationTool · finishTaskTool (DoD Gate trigger)
```

---

## 5. Meccanismi Implementati, Validazione e Risultati Empirici

Tutte le ottimizzazioni sono state guidate da metriche e sonde reali (`scripts/live/fullTaskRun.live.ts`, `qwen2.5-coder:7b`).

### 5.1. Cicli di Feedback e Sicurezza Esecuzione
* **Composizione Output Diagnostico**: `DiagnosticOutputReducer.composeCommandOutput` unifica `stdout` e `stderr` senza scartare lo stderr in presenza di banner stdout (es. banner iniziale di `npm`).
* **Verifica Dipendenze su Disco**: `missingFromNodeModules` verifica l'effettiva presenza in `node_modules` oltre a `package.json`, evitando falsi positivi nei workspace generati.
* **Sicurezza Comandi di Verifica**: [`verificationCommandSafety.ts`](../electron/core/domain/agent/verificationCommandSafety.ts) rifiuta comandi *existence-only* (`cat`, `Test-Path`, `ls`) e *gui-mode* (`cypress open`, `--ui`), ammettendo solo test falsificabili.
* **Scope Reale Anti-Loop**: Le direttive anti-loop dichiarano la finestra reale di blocco (5 passi) e indicano la via d'uscita corretta (analizzare l'errore, modificare il codice, rieseguire).

### 5.2. Controlli Anticipati e Integrità
* **Intercettazione Import Non Dichiarati**: [`importDeclarationGate.ts`](../electron/core/domain/agent/importDeclarationGate.ts) valida i pacchetti importati contro `package.json` e `tsconfig.paths` al momento di `write_file`, restituendo l'elenco dei non dichiarati senza annullare la scrittura.
* **Autorità Aggiornamento Milestone**: [`milestoneUpdateAuthority.ts`](../electron/core/domain/agent/milestoneUpdateAuthority.ts) blocca la promozione a `verified` finché i deliverable del titolo non sono presenti e non vuoti su disco.
* **Prevenzione Directory come File**: `write_file` con trailing slash delega a `create_directory`.
* **Deduplicazione Fallimenti**: Collasso dei log falliti per coppia `tool + target` sull'intero buffer per evitare la saturazione della finestra contestuale.

### 5.3. Risoluzione Deterministica Conflitti Dipendenze
* **Risoluzione Automatica `npm ERESOLVE`**: [`npmResolutionConflict.ts`](../electron/core/domain/agent/npmResolutionConflict.ts) estrae le versioni in conflitto dal log npm e genera il comando esatto con range copiato **verbatim** (es. `npm install vite@^8.0.0`), senza delegare la scelta o usare `--force`.
* **Validazione Nome vs Versione**: Il guard riconosce comandi con versione esplicita (`pkg@version`) evitando blocchi errati di "già installato".
* **Validazione Nomi Tool**: `normalizeToolName` valida i comandi contro [`ollamaToolSchemaCatalog.ts`](../electron/core/domain/agent/ollamaToolSchemaCatalog.ts) rifiutando nomi allucinati (es. `npm_install`).
* **Rifiuto del Registro = Fallimento dell'Install (risolto 2026-08-25)**: il guard del registro in [`agentToolExecutorService.ts`](../electron/core/application/agentToolExecutorService.ts) rifiuta l'install di un pacchetto inesistente **senza eseguirlo**, restituendo il marcatore `[PACKAGE DOES NOT EXIST`. Quel marcatore non era in [`isFailureOutput`](../electron/core/application/agentOrchestratorToolResultProcessor.ts), quindi l'episodio veniva registrato `SUCCESS` — e `packagesWithFailedInstall` ([`installCommandParser.ts`](../electron/core/domain/agent/installCommandParser.ts)) usa un `SUCCESS` per **azzerare** il contatore dei fallimenti del pacchetto. La soglia `FAILURES_BEFORE_UNINSTALLABLE` diventava percio' irraggiungibile e l'arbitro non passava mai a `dependencies_uninstallable`, continuando a ordinare l'unico install che non poteva riuscire mentre il guard continuava a rifiutarlo.
  * **Sintomo misurato**: sessione `live-full-task` del 2026-08-25T11:03 (e identicamente quella delle 08:37) — `npm install @tailwindcss/react` ordinato agli step 9, 11, 18, 19, 25, 26, 32, 33, 39, 40, 46 e 48, con il loop detector a bloccare i turni intermedi, fino al tetto dei 50 step con **0 milestone verificate**. Due canali davano al modello istruzioni opposte nello stesso turno: il tool-result diceva "Do NOT run this install again", il plan-directive diceva "Your next tool call MUST be `npm install @tailwindcss/react`".
  * **Lezione**: la via d'uscita era gia' costruita e semplicemente non armata. Un marcatore assente da un elenco di classificazione non e' una lacuna cosmetica: e' un esito su cui l'intero loop ragiona al contrario. Vale anche per §1.2 ("loop detector solo restrittivo"): il detector non era il problema, bloccava correttamente una ripetizione inutile — mancava il segnale che avrebbe reso quella ripetizione non necessaria.
  * **Replay sugli episodi reali**: con la classificazione corretta la soglia e' raggiunta subito dopo lo step 11, cioe' l'escape sarebbe scattato allo step 12 anziche' mai.

### 5.4. Riduzione Churn e Criteri di Chiusura
* **Rilevamento Scritture a Vuoto (No-Op)**: [`redundantWriteDetector.ts`](../electron/core/domain/agent/redundantWriteDetector.ts) normalizza CRLF/LF e newline finale. Se il contenuto è identico, non tocca il file e imposta `noOpMutation: true`, preservando `flags.hasVerifiedBuild`.
* **Stato di Chiusura Dichiarabile**: [`postVerificationClosure.ts`](../electron/core/domain/agent/postVerificationClosure.ts) rileva quando la build è verificata e le sole milestone aperte sono non falsificabili (`not_applicable`), ordinando la chiusura della sessione.
* **Direttiva Milestone Indimostrabili**: [`unprovableMilestoneDirective.ts`](../electron/core/domain/agent/unprovableMilestoneDirective.ts) guida il modello a chiudere via `update_plan` compiti che non producono file o comandi (es. requisiti di accessibilità o stile diffuso).
* **Direttiva Consegna Parziale**: [`milestoneVerificationPromotion.ts`](../electron/core/domain/agent/milestoneVerificationPromotion.ts) nomina i file ancora mancanti di una milestone composita, vietando la riscrittura del file già accettato (risolto in 1 passo vs 9 passi precedenti).
* **Compattazione Output Recenti**: [`recentFullLogs`](../electron/core/domain/agent/diagnosticOutputReducer.ts) collassa i fallimenti ripetuti per `tool + target`, liberando oltre il 46% di spazio utile nel prompt.

### 5.5. Matrice Modelli e Context Budgeting Ollama
* **Metriche Reali Modelli**: [`getModelMetrics`](../electron/core/infrastructure/http/ollamaHttpClient.ts) legge `context_length`, `parameter_size` e quantizzazione reale da `/api/tags`.
* **Matrice Modelli Verificati**: [`codingModelMatrix.ts`](../src/services/codingModelMatrix.ts) badge `verified` assegnato esclusivamente a modelli testati end-to-end su sonde live (`qwen2.5-coder:7b`).
* **Truncamento Ollama Silenzioso (risolto)**: Ollama clampa `num_ctx` al `context_length` addestrato del modello e scarta la **testa** del prompt — system prompt e blocco piano. Il danno non era il clamp ma `maxContextChars` derivato dalla finestra **non** clampata: dichiarava a `HeuristicContextCompactor` uno spazio inesistente, quindi il compattatore non interveniva e la decapitazione era garantita anziché possibile. [`selectModelForTurn`](../electron/core/application/agentOrchestratorPromptAssembly.ts) clampa ora `num_ctx` su `context_length` e rideriva da lì `num_predict` e `maxContextChars`; [`freezeOrGrowContextWindow`](../electron/core/application/agentOrchestratorPromptAssembly.ts) applica lo stesso tetto al valore **in uscita**, perché il freeze è per sessione mentre il tetto è per modello e il fallback di resilienza può scambiare i modelli a metà sessione.
* **Fonte autorevole della finestra**: `context_length` da `/api/tags` ([`getModelMetrics`](../electron/core/infrastructure/http/ollamaHttpClient.ts)), noto **prima** del caricamento e recuperato nella stessa lettura che fornisce le capability. `/api/ps` riporta il contesto allocato *per la nostra stessa richiesta*: è a valle della decisione da prendere, quindi utile come segnale di verifica ma circolare come fonte di dimensionamento.

### 5.6. Arbitro delle Direttive e Risoluzione Deadlock
[`planDirectiveArbiter.ts`](../electron/core/domain/agent/planDirectiveArbiter.ts) stabilisce la singola direttiva attiva per turno secondo una priorità deterministica:

| Priorità | Stato | Condizione di Attivazione | Azione Prescritta |
| :---: | :--- | :--- | :--- |
| **1** | `session_closure` | Build verificata e zero scritture successive | Chiudere la sessione con `finish` |
| **2** | `dependencies_undeclared` | Il codice importa package non dichiarati nel manifest | `npm install <pkg>` (via `undeclaredImportScanner.ts`) |
| **3** | `dependencies_missing` | Manifest dichiara package assenti da `node_modules` | `npm install` |
| **4** | `verification_due` | Nessuna milestone unsatisfied e verifica non ancora eseguita | Eseguire il comando di verifica primaria del progetto |
| **5** | `unprovable_milestone` | Milestone attiva priva di deliverable su disco | `update_plan` con ID milestone |
| **6** | `focus` | Avanzamento ordinario | Microtask della milestone attiva |

* **Impatto misurato**: Risolto il deadlock storico (da 0 comandi eseguiti in 50 passi a **13 comandi**, con `npm install` al passo 2 e `npm run build` al passo 28).
* **Protezione Escape Milestone Consegnate**: `isActiveMilestoneDelivered` impedisce a `loopEscapePolicy` di marcare fallita una milestone i cui file sono già presenti su disco.

### 5.6b – 5.6c. Risoluzione Deliverable e Gestione Riconsegne
* **Risoluzione Basename nel Workspace**: [`workspaceDeliverableProbe.ts`](../electron/core/infrastructure/filesystem/workspaceDeliverableProbe.ts) risolve i file con nome nudo (es. `globals.css`) cercando nell'albero del workspace (es. `src/styles/globals.css`), eliminando i loop di riscrittura (da 6 riscritture a 1).
* **Direttiva Riconsegna**: [`redeliveredMilestoneDirective`](../electron/core/domain/agent/milestoneVerificationPromotion.ts) avverte quando un file appartiene a una milestone già completata, indicando il deliverable atteso.

### 5.6d. Escalation Rifiuti di Schema Tool
* **Escalation a 3 Livelli**: [`toolRejectionEscalation.ts`](../electron/core/domain/agent/toolRejectionEscalation.ts) invia il contratto schema nei primi 2 rifiuti (es. `replace_file_content` malformato), scala a `write_file` integrale al 3° tentativo e interrompe a `REJECTION_ABORT_STREAK` evitando loop infiniti.

### 5.6e – 5.6f. Whole-Project Verification & Integrità Entrypoint
* **Typecheck Globale Sintetizzato**: In assenza di script dedicato, [`resolvePrimaryVerificationCommand`](../electron/core/domain/agent/projectVerificationResolver.ts) sintetizza `npx tsc --noEmit`, intercettando errori in tutti i file e non solo nell'albero importato.
* **Direttiva Diagnostica Compilatore**: [`compilerDiagnosticDirective.ts`](../electron/core/domain/agent/compilerDiagnosticDirective.ts) estrae file, riga e codice errore, prescrivendo un **singolo imperativo** di correzione (`write_file`), con rinvio esplicito degli errori secondari tramite [`buildDeferredDiagnosticNote`](../electron/core/domain/agent/compilerDiagnosticDirective.ts). Quando il compilatore ha stampato il rimedio lo passa verbatim invece di riformularlo: il comando di install per `TS7016` ([`extractSuggestedCommand`](../electron/core/domain/agent/compilerDiagnosticDirective.ts)) e la riga di import per `TS2613`/`TS2614` ([`extractExportMismatch`](../electron/core/domain/agent/compilerDiagnosticDirective.ts), §5.6i).
* **Controllo Entrypoint HTML/JS**: [`entrypointIntegrity.ts`](../electron/core/domain/agent/entrypointIntegrity.ts) rileva file `index.html` privi di script verso `src/main.tsx` o root component, iniettando il tag esatto (compilazione passata da 2 moduli a 43 moduli / 180 kB).

### 5.6g – 5.6h. Generazione Piano & Iniezione Strutturale
* **Formato Microtask (Capacità + Path)**: [`planGenerationAppService.ts`](../electron/core/application/planGenerationAppService.ts) genera milestone nella forma: `- [ ] m-N: <Funzionalità/Capacità> — <path/del/file.ext>`.
* **Iniezione Deterministica Entrypoint**: [`ensureEntrypointMilestones`](../electron/core/domain/agent/planCompilation.ts) antepone nello scheletro `package.json`, `index.html`, `tsconfig.json` e `src/main.tsx` se non presenti.
* **Iniezione Milestone di Verifica**: [`ensureRunnableMilestone`](../electron/core/domain/agent/planCompilation.ts) appende la milestone di verifica end-to-end con il comando reale del progetto.
* **Risultato Misurato (Run 9)**: **12/13 milestone verificate (92%)**, `finish` raggiunto autonomamente, `npm run build` con exit code 0 e 43 moduli compilati.

> [!WARNING]
> **Run 9 non è riproducibile allo stato attuale (verificato 2026-08-25).** Due esecuzioni di
> `fullTaskRun.live.ts` su `qwen2.5-coder:7b` nella stessa giornata — una alle 08:37 e una alle
> 11:03, la prima precedente a qualunque modifica della sessione di lavoro — hanno entrambe
> raggiunto il tetto dei **50 step con 0 milestone verificate e senza `finish`**. Le due corse
> sono in `logs/coding_agent_audit.log` e concordano tra loro, quindi la divergenza da Run 9 non
> è varianza fra modelli né effetto di una modifica recente.
>
> **`npm run test:live` esce comunque con codice 0** in entrambi i casi: le sonde asseriscono
> molto meno dei numeri che questa sezione pubblicizza. Finché non asseriscono il tasso di
> milestone verificate e il raggiungimento di `finish`, un `PASS` della sonda non è evidenza di
> ciò che è scritto qui.
>
> Questa nota resta finché una corsa non riproduce il risultato o non lo sostituisce. Cancellare
> il numero sarebbe perdere il riferimento; lasciarlo senza la nota violerebbe §6.2.3.

### 5.6i. Registro npm vs Limiti di Training
* **Consultazione Registro npm**: [`npmRegistryClient.ts`](../electron/core/infrastructure/http/npmRegistryClient.ts) valida l'esistenza dei pacchetti e recupera la versione stabile reale prima dell'installazione.
* **Normalizzazione Versioni & `ETARGET`**: [`dependencyVersionReality.ts`](../electron/core/domain/agent/dependencyVersionReality.ts) e [`npmVersionNotFound.ts`](../electron/core/domain/agent/npmVersionNotFound.ts) correggono pacchetti inesistenti (es. `@tailwindcss/react`) e versioni allucinate.
* **Preservazione Configurazioni Major**: Esclusione automatica di major breaking (`typescript`, `tailwindcss`, `eslint`) che richiederebbero modifiche di configurazione estranee al training del modello.
* **Coerenza Export/Import (`TS2613`/`TS2614`)**: `tsc` chiude entrambi i messaggi con la frase *"Did you mean to use '<import>' instead?"*, cioè con l'istruzione già scritta. [`extractExportMismatch`](../electron/core/domain/agent/compilerDiagnosticDirective.ts) la estrae e la direttiva la cita **verbatim** su riga propria, nominando file e riga e prescrivendo un solo `write_file` sul file importante. Sostituisce la direttiva file+riga ordinaria (§6.2.2), non la affianca, e vince sull'errore in prima posizione quando il mismatch è più in basso: fra gli errori a tabellino è l'unico la cui correzione è già nota. Resta subordinata all'installazione quando il compilatore ha anche nominato un pacchetto mancante.
* **Limite noto**: la direttiva applica la sola correzione che il compilatore propone — cambiare l'import. Se la scelta corretta fosse cambiare l'export del modulo importato, il modello non lo dedurrà da qui.

### 5.6j. Politica di Contesto per Turno — il secondo asse di arbitrato

L'arbitro di §5.6 decide **cosa dire** al modello. Non decideva **cosa mostrargli**: ogni blocco
opzionale partiva a ogni turno, dimensionato a quote fisse del budget (repo map 18%, RAG 12% in
[`agentPromptAssembler.ts`](../electron/core/domain/agent/agentPromptAssembler.ts); pinned, file
attivo e skill a frazioni fisse del tier 2 in
[`heuristicContextCompactor.ts`](../electron/core/domain/agent/heuristicContextCompactor.ts)). Su un
7B a 8k questo spende metà finestra in contesto che la milestone attiva spesso non usa, e il blocco
che lo paga — quando il compattatore esaurisce lo spazio — è la **history**, l'unico che porta ciò
che è già stato fatto.

[`turnContextPolicy.ts`](../electron/core/domain/agent/turnContextPolicy.ts) chiude la lacuna
**senza aggiungere alcuna inferenza**: il `PlanDirectiveKind` che l'arbitro ha già risolto è di per
sé la risposta a "cosa serve davanti al modello adesso". Un turno la cui azione prescritta è
`npm install react` non è reso più corretto da una mappa del repository.

| `PlanDirectiveKind` | Azione prescritta | Map | RAG | Skill | Pinned | File attivo |
| :--- | :--- | :-: | :-: | :-: | :-: | :-: |
| `session_closure` | `finish` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| `dependencies_undeclared` | `npm install <pkg>` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| `dependencies_missing` | `npm install` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| `verification_due` | comando di verifica | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| `unprovable_milestone` | `update_plan <id>` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| `dependencies_uninstallable` | riscrivere l'import | ⬜ | ⬜ | ✅ | ✅ | ✅ |
| `verification_failing` | correggere il file diagnosticato | ⬜ | ⬜ | ✅ | ✅ | ✅ |
| `entrypoint_disconnected` | iniettare il tag esatto | ⬜ | ⬜ | ⬜ | ✅ | ⬜ |
| `focus` | microtask della milestone | ✅ | ✅ | ✅ | ✅ | ✅ |

* **Invariante strutturale**: system prompt, blocco piano e tool history **non hanno un campo** in
  `TurnContextPolicy`, quindi nessuna policy può sopprimerli. Sono la testa immutabile e la coda di
  progresso, cioè esattamente ciò che la troncatura di Ollama distrugge (§5.5). Sopprimere un
  blocco opzionale libera la sua allocazione a favore della history.
* **Esaustività forzata**: la risoluzione è uno `switch` senza `default`, così un nuovo
  `PlanDirectiveKind` diventa un errore di compilazione anziché ereditare un fallback silenzioso.
* **Effetto collaterale sulla latenza**: quando la mappa non è ammessa, `generateCompactRepoMap`
  non viene proprio invocata — è un tree walk del workspace a ogni turno.
* **Relazione con i principi (§6.2)**: è il Principio 1 applicato al contesto anziché alle
  istruzioni. Quando il sistema conosce già l'azione del turno, non deve far riscoprire al modello
  quale degli otto blocchi fosse pertinente.

### 5.7. Roadmap Funzionalità Future
1. **Modulo Validazione Visiva**: `visualValidationTool.ts` su Electron Offscreen `WebContents` con cattura screenshot, DOM e `console.error`.
2. **First-Class Artifacts Engine**: Canali IPC `artifacts:*`, repository artefatti e Live Preview sandboxata.
3. **Refactoring Modulare Tool**: Scomposizione di `agentToolExecutorService.ts` secondo la struttura SRP (§4).

---

## 6. Guida Operativa & Principi

### 6.1. Tabella di Sintesi Componenti & Stato

| Modulo / Area | Responsabilità | Stato |
| :--- | :--- | :---: |
| [`planDirectiveArbiter.ts`](../electron/core/domain/agent/planDirectiveArbiter.ts) | Selezione della singola direttiva prioritaria di turno | ✅ Verificato Live |
| [`turnContextPolicy.ts`](../electron/core/domain/agent/turnContextPolicy.ts) | Selezione dei blocchi di contesto ammessi nel turno (§5.6j) | ✅ Unit test |
| [`selectModelForTurn`](../electron/core/application/agentOrchestratorPromptAssembly.ts) | Clamp di `num_ctx` sul `context_length` reale del modello (§5.5) | ✅ Unit test |
| [`npmResolutionConflict.ts`](../electron/core/domain/agent/npmResolutionConflict.ts) | Risoluzione deterministica conflitti `ERESOLVE` npm | ✅ Verificato Live |
| [`redundantWriteDetector.ts`](../electron/core/domain/agent/redundantWriteDetector.ts) | Riconoscimento no-op writes e preservazione build verde | ✅ Verificato Live |
| [`postVerificationClosure.ts`](../electron/core/domain/agent/postVerificationClosure.ts) | Sblocco chiusura sessione su milestone residue non dimostrabili | ✅ Verificato Live |
| [`importDeclarationGate.ts`](../electron/core/domain/agent/importDeclarationGate.ts) / [`undeclaredImportScanner.ts`](../electron/core/infrastructure/filesystem/undeclaredImportScanner.ts) | Intercettazione e installazione automatica import mancanti | ✅ Verificato Live |
| [`workspaceDeliverableProbe.ts`](../electron/core/infrastructure/filesystem/workspaceDeliverableProbe.ts) | Risoluzione deliverable con fallback basename su workspace | ✅ Verificato Live |
| [`entrypointIntegrity.ts`](../electron/core/domain/agent/entrypointIntegrity.ts) / [`planCompilation.ts`](../electron/core/domain/agent/planCompilation.ts) | Iniezione deterministica entrypoint web e runnable milestone | ✅ Verificato Live |
| [`compilerDiagnosticDirective.ts`](../electron/core/domain/agent/compilerDiagnosticDirective.ts) | Estrazione diagnostiche compilatore e direttiva file+riga singola | ✅ Verificato Live |
| [`npmRegistryClient.ts`](../electron/core/infrastructure/http/npmRegistryClient.ts) / [`dependencyVersionReality.ts`](../electron/core/domain/agent/dependencyVersionReality.ts) | Validazione real-time esistenza pacchetti e versioni su registro npm | ✅ Verificato Live |
| `visualValidationTool` & `artifactsEngine` | Validazione visiva headless e motore anteprime artefatti | ⬜ Roadmap (§5.7) |

### 6.2. I Tre Principi Architetturali Fondamentali

1. **Struttura prima di Direttive**: Quando il sistema conosce un dato oggettivo che il modello non può dedurre (workspace vuoto, pacchetto inesistente, entrypoint mancante, versione npm), il sistema lo inietta deterministicamente o lo fornisce come dato. Non forzare il modello con direttive su concetti estranei al suo training.
2. **Singola Istruzione Imperativa per Turno**: Un messaggio non deve mai contenere due imperativi concorrenti (es. "modifica il file E riesegui la build"). Il modello sceglie l'azione più economica o quella del canale più frequente. In caso di conflitti, **sostituire la direttiva, mai accodarla**.
3. **Falsificabilità e Verità dei Controlli**: Una milestone è `verified` solo se supportata da deliverable reali su disco e comandi con exit code 0. I controlli non devono mai assumere conformità senza prove effettive.

### 6.3. Comandi di Verifica & Testing

Esecuzione obbligatoria sequenziale prima di ogni rilascio:

```powershell
# 1. Catena di verifica statica e test unitari
npm run lint

# 2. Esecuzione sonda live end-to-end (richiede Ollama locale attivo)
npm run test:live
```

### 6.4. Gestione Audit Log e Rotazione

* **Append Mode**: `logs/coding_agent_audit.log` viene aggiornato in modalità append. Prima di avviare una sonda live, registrare l'offset iniziale per isolare il run.
* **Rotazione a 10 MB**: Al raggiungimento di 10 MB il log ruota in `coding_agent_audit.1.log`. L'estrazione deve considerare entrambi i file.
* **Preservazione Pulizia**: La directory `logs/` è ignorata da Git e rimossa dagli script `clean_workspace.ps1`. Salvare gli snapshot dei log rilevanti prima di eseguire pulizie complete.
