# Piano di Refactoring Universale & Checklist Esecutiva

Piano di implementazione per il perfezionamento di **Ingestione Doc** (traduzione in-place universale) e **Coding Agent Studio** (intervista pre-flight Claude Code, sincronizzazione plan e tool browser).

---

## 📋 Checklist delle Attività

### Fase 1: Ingestione Doc & Traduzione In-Place Universale
- [x] **1.1. Rimozione Regex Buggata e Anti-Hardcoding in `sidecar/domain/translator.py`**:
  - Eliminare la regex difettosa `(?:run_sep|run_s|ep)` che corrompe le parole contenenti 'ep' (es. Telepass -> Telass).
  - Rimuovere tutte le regex euristiche su parole/lingue singole in `_smart_decode_pdf_text`.
  - Normalizzare universalmente il testo con `unicodedata.normalize('NFKC')` e `ftfy.fix_text()`.
- [x] **1.2. Token Placeholder Masking per Entità Immutabili**:
  - Mascherare email (RFC regex standard), URL e codici strutturati con token `__PROT_ENT_N__` prima dell'invio a Ollama e ripristinarli al 100% dopo la traduzione.
- [x] **1.3. Batching Strutturato Multi-Riga**:
  - Sostituire il batching riga per riga (`[1]`, `[2]`) con un formato a tag deterministici `<seg id="K">...</seg>` che preserva fedelmente ritorni a capo (`\n`), indirizzi completi e tabelle.
- [x] **1.4. Validazione & Test Unitari Traduzione**:
  - Eseguire i test `pytest sidecar/tests/test_translator.py` e verificare la traduzione del PDF `Richiesta cessazione contratto telepass.pdf`.

---

### Fase 2: Coding Agent Studio — Intervista Pre-Flight Stile Claude Code
- [x] **2.1. Creazione Servizio Intervista `electron/core/application/agentInterviewAppService.ts`**:
  - Analizzare il prompt per rilevare scelte architetturali/tecniche ambigue.
  - Generare 1-3 domande mirate con schema JSON strutturato (opzioni con badge "(Consigliato)" + opzione write-in).
  - Validare e sanificare l'output JSON con `jsonrepair`.
- [x] **2.2. Integrazione nel Flusso Plan (`planGenerationAppService.ts` e IPC `electron/preload.ts`)**:
  - Esporre IPC per l'intervista preliminare e fondere le risposte dell'utente nel prompt arricchito per la generazione del piano.
- [x] **2.3. Integrazione UI nel Frontend (`src/components/coding/` e `src/hooks/usePlanApproval.ts`)**:
  - Visualizzare le domande prima dell'approvazione del piano con chip di selezione e campo personalizzato.

---

### Fase 3: Coding Agent Studio — Sincronizzazione Plan e Risoluzione Loop Trap
- [x] **3.1. Riconciliazione Stato e Prompt di Ripresa Turno**:
  - In `agentOrchestratorPromptAssembly.ts` e `agentOrchestratorSessionState.ts`, includere lo stato dei file già scritti per evitare che l'agente riesegua lo step 1 e inneschi loop trap.
- [x] **3.2. Flessibilità Definition-of-Done per Progetti Statici**:
  - Adeguare `TransactionalExecutionGuard` e `trackVerification` per consentire la verifica e chiusura su progetti web statici (es. singolo file `index.html`).

---

### Fase 4: Coding Agent Studio — Tool `open_in_browser`
- [x] **4.1. Implementazione Tool in `agentToolExecutorService.ts`**:
  - Aggiungere il tool `open_in_browser` con validazione `validatePathSafety` e integrazione con `electron.shell.openPath` / `electron.shell.openExternal`.
- [x] **4.2. Aggiornamento Catalogo Schemi e Prompt**:
  - Registrare `open_in_browser` in `ollamaToolSchemaCatalog.ts` e nelle istruzioni operative dell'agente.

---

### Fase 5: Verifica Completa & Allineamento Documentazione
- [x] **5.1. Esecuzione Suite di Test Seriale**:
  - Pytest sidecar, Vitest frontend/electron (`npm run test:unit-only`, `npm run test:agent`, `npm run typecheck`).
- [x] **5.2. Aggiornamento Documentazione `/docs/` e Pulizia `PROJECT_STATUS.json`**:
  - Sincronizzare `docs/libraries-and-domain-implementations.md`, `docs/architecture.md`, `docs/modules.md`.

---

### Fase 6: Coding Agent Studio — Refactoring Completo UI/UX & Architettura
- [x] **6.1. Header & System Specs Streamlining**:
  - In `CodingHeader.tsx`, sostituire i 10+ badge statici con un indicatore di stato compatto (`🟢 System Ready ▾`) dotato di popover/tooltip con specifiche runtime e tool hardware.
- [x] **6.2. Workspace Explorer & File Tree Moderno**:
  - In `WorkspaceExplorer.tsx`, `FileExplorerTree.tsx` e `WorkspaceExplorerProjectSwitcher.tsx`:
    - Eliminare le card nidificate e i selettori doppi.
    - Implementare guide verticali di profondità (`tree guides`), icone contestuali per estensione via `lucide-react`, barra di filtro rapido e gestione pulita dei file pinnati.
  - Eliminare il file morto `WorkspaceExplorerTreeSection.tsx`.
- [x] **6.3. Timeline & Collapsible Tool Execution**:
  - In `AgentTimeline.tsx`, `AgentTimelineMessage.tsx` e `AgentActionLogPanel.tsx`:
    - Raggruppare i passaggi dei tool in badge compatti espandibili al click (`✓ Read file`, `⚡ Ran command`).
    - Collassare il blocco di ragionamento (*CoT*) e ottimizzare la virtualizzazione.
  - Eliminare il componente duplicato `AgentSessionHeaderBar.tsx`.
- [x] **6.4. Prompt Composer con Context Pills & Auto-Resize**:
  - In `PromptComposer.tsx`: textarea ad auto-espansione, pill rimovibili per file pinnati e documenti allegati, selettore di modalità a 3 stati (`Agent` | `Ask` | `Plan`) e token gauge compatto.
- [x] **6.5. Separazione Editor & Bottom Tool Dock (Opzione 1)**:
  - Creare `CodingBottomDock.tsx` per ospitare Terminale PTY, Piano dei task, Git Diff e Diagnostica con tab e resize dedicato.
  - In `CodingEditorTabBar.tsx` e `CodingEditorContent.tsx`, dedicare la tab bar superiore esclusivamente ai file di codice Monaco aperti.
  - In `CodingAgentView.tsx`, assemblare il layout a 3 colonne con Bottom Dock inferiore.
- [x] **6.6. Verifica Seriale, Test & Sync Documentazione**:
  - Eseguire typecheck, suite di test e aggiornare `/docs/`.

