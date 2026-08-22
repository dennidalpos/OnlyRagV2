# Universal Refactor Plan & Architecture Specification — OnlyRag V2

Documento architetturale completo e traccia di riferimento del refactoring di OnlyRag V2 per l'eliminazione dell'overengineering, l'adozione dell'architettura **Workhorse Model deterministica** con gestione resiliente dei fallback e la riorganizzazione dell'interfaccia utente.

---

## 1. Motivazione & Diagnosi delle Criticità Iniziali

### 1.1. Overengineering del Complexity Router Multi-Tier
Nel design precedente, il sistema implementava 4 livelli di complessità proattivi (*🟢 Fast, 🔵 Standard, 🟣 Deep Reasoning, 🔶 Heavy*) che venivano ricalcolati dinamicamente ad ogni turno agentico:
* **Problema di VRAM Thrashing:** A ogni cambio di tier, Ollama doveva scaricare il modello corrente dalla VRAM ed effettuare il warm-up del nuovo modello GGUF. Questo causava freeze di 3-8 secondi tra i turni, perdita della KV-cache in VRAM e consumo elevato di I/O.
* **Escalation Incontrollata al Tier Heavy (14B):** Su errori ripetuti o fallimenti di comandi (`hasRecentToolFailure`, `errorCountInHistory >= 2`), il router scavalcava il modello selezionato dall'utente forzando l'escalation al tier *Heavy* (`qwen2.5-coder:14b`), eccedendo la VRAM sicura su GPU da 8GB e innescando blocchi e oscillazioni.
* **Disallineamento UI:** Il badge dei tier nella vista di coding non rispecchiava sempre il modello effettivamente configurato.

### 1.2. Wizard e Impostazioni Frammentate
* Il Setup Wizard iniziale era distribuito su 6 passaggi ridondanti con sottomoduli dedicati per ciascun tier (`WizardStepCodingTiers`, `WizardStepGeneralLlms`, `WizardStepMultimodal`, `WizardStepPreferences`).
* Assenza di un meccanismo rapido di cambio modello direttamente dalle barre superiori dei moduli (*Header*) senza dover accedere ogni volta alla pagina Impostazioni.

---

## 2. Nuova Architettura: Deterministic Workhorse & Resilient Fallback

### 2.1. Principio del Modello di Lavoro Fisso ("Workhorse Model")
1. **Unico Modello Principale di Sviluppo:** L'utente o l'hardware recommendation engine imposta un singolo modello primario ottimale per la propria GPU (es. `qwen2.5-coder:7b`, `qwen3:8b`, `deepseek-r1:8b`).
2. **Zero VRAM Swapping:** Il modello rimane allocato in VRAM per l'intera durata della sessione di coding. La KV-cache dei turni precedenti viene conservata intatta, abilitando risposte sub-secondo ad altissima efficienza.
3. **Nessuna Escalation Proattiva a 14B:** L'orchestratore non altera il modello durante la sessione in base a conteggi di errori o token.

### 2.2. Fallback Reattivo di Auto-Healing su Crash / OOM
Il cambio modello avviene **esclusivamente** come meccanismo reattivo di emergenza all'interno di `ResilientModelDispatcher.executeWithFallback`:
* Se e solo se il modello primario genera un errore fisico fatale (`CUDA out of memory`, timeout del processo Ollama o crash del socket di streaming), il dispatcher:
  1. Esegue il dump atomico della VRAM (`POST /api/generate` con `keep_alive: 0`).
  2. Dimezza la context window (`num_ctx = 4096`).
  3. Re-instrada la richiesta verso il modello di fallback configurato (`codingFallbackModel`, es. `llama3.2:3b`).
* Il fallback può essere liberamente modificato o disattivato dall'utente in qualsiasi momento.

---

## 3. Rimodellazione dei Componenti Frontend

### 3.1. Selettore Rapido Universale (`QuickModelSelector.tsx`)
Un componente compatto, interattivo e conforme agli standard di accessibilità (`role="listbox"`, `aria-*`, focus ring):
* Integrato negli header di:
  * **AI Coding Agent Studio** ([`CodingHeader.tsx`](file:///d:/GITHUB/OnlyRagV2/src/components/coding/CodingHeader.tsx))
  * **RAG Chat & Knowledge** ([`ChatView.tsx`](file:///d:/GITHUB/OnlyRagV2/src/components/chat/ChatView.tsx))
  * **Document Translation** ([`TranslationView.tsx`](file:///d:/GITHUB/OnlyRagV2/src/components/translation/TranslationView.tsx))
  * **Ingestion & Text Check** ([`IngestionView.tsx`](file:///d:/GITHUB/OnlyRagV2/src/components/ingestion/IngestionView.tsx))
* Funzionalità:
  * Indicazione istantanea del modello primario attivo.
  * Badge di stato installazione: `✓ Pronto` per i modelli già scaricati in locale, `⬇ Da scaricare` per i modelli selezionati ma assenti.
  * Badge del fallback configurato (`🛡️ <fallback>`).
  * Dropdown con preset raccomandati e possibilità di impostare o disattivare il fallback OOM al volo.

### 3.2. Riorganizzazione Impostazioni Assegnazione Modelli (`ModelAssignmentGrid.tsx`)
La griglia di configurazione è stata ristrutturata in 4 schede logico-funzionali:
1. **AI Coding Agent Studio:** Modello Principale di Sviluppo (Workhorse) + Modello di Fallback (Auto-Healing OOM).
2. **RAG Chat & Document Translation:** Modello Chat RAG (+ Fallback) e Modello Traduzione (+ Fallback).
3. **Ingestion, Vision OCR & Vector Store:** Modello Multimodale Vision OCR e Modello Vector Embedding LanceDB.
4. **Domini Specialistici:** Modelli dedicati per ambito Medico-Sanitario e Giuridico-Normativo.

### 3.3. Setup Wizard a 3 Step Semplificato (`HardwareSetupWizardModal.tsx`)
Flusso snello e guidato:
* **Step 1 — Rilevamento Hardware:** Scansione VRAM GPU, CPU, RAM e stato del server Ollama con pulsante "Configurazione Rapida Consigliata (1-Click)".
* **Step 2 — Suite Modelli Consigliati (`WizardStepRecommendedModels.tsx`):** Selezione intuitiva della suite funzionale consigliata in base al profilo di calcolo rilevato.
* **Step 3 — Riepilogo & Download Batch (`WizardStepSummaryAndDownload.tsx`):** Verifica preventiva dello spazio su disco, visualizzazione dei modelli mancanti e download sequenziale automatico con barra di avanzamento.

---

## 4. Rimodellazione dei Servizi Backend & Domain (Electron)

### 4.1. Assemblaggio Prompt & Target Model (`agentOrchestratorPromptAssembly.ts`)
* `selectModelForTurn` assegna determiniscamente `ctx.settings.codingModel || 'qwen2.5-coder:7b'` come `targetModel`.
* Eliminato il bypass `useComplexityRouting ? routedComplexity.modelName` che causava cambi di modello non richiesti.
* La valutazione di complessità (`evaluateTaskComplexity`) viene mantenuta unicamente per calibrare le direttive del prompt di sistema (es. step di ragionamento su compiti ampi), senza mai alterare i pesi del modello caricato.

### 4.2. Rimozione Escalation dal Stagnation Circuit Breaker (`agentOrchestratorCircuitBreakerAndVerification.ts`)
* In caso di stallo o loop persistente, `runCircuitBreaker` non esegue più lo swap forzato del modello verso un tier 14B.
* Il circuit breaker arresta in sicurezza l'iterazione o inietta la direttiva di auto-interruzione, lasciando il controllo all'utente.

### 4.3. Disaccoppiamento e Pulizia File Obsoleti
* Eliminati i file wizard non più utilizzati:
  * `src/components/wizard/WizardStepCodingTiers.tsx`
  * `src/components/wizard/WizardStepGeneralLlms.tsx`
  * `src/components/wizard/WizardStepMultimodal.tsx`
  * `src/components/wizard/WizardStepPreferences.tsx`

---

## 5. Matrice di Verifica & Test Eseguiti

Tutte le verifiche sono state eseguite in modalità rigorosamente sequenziale (*Strict Serial Execution*):

| Suite di Verifica | Comando | Esito | Note |
| :--- | :--- | :--- | :--- |
| **TypeScript Typecheck** | `npm run typecheck` | **PASS (0 errori)** | Piena conformità tipi e rimozione unused imports. |
| **Vitest Fast Suite** | `npm run test:fast` | **PASS (90/90 files, 652/652 tests)** | Copertura completa domain, application, UI e parser. |
| **Pytest Sidecar FastAPI** | `.venv/pytest sidecar/tests -q` | **PASS (42/42 tests)** | Endpoint di ingestion, LanceDB e ricerca vettoriale. |
| **Lint & Code Quality** | `.\scripts\lint_format.ps1 -Fast` | **PASS** | Verifica stili, formattazione e vincoli PowerShell. |
| **Vite Production Build** | `npx vite build` | **PASS** | Compilazione di tutti i bundle di produzione. |

---

## 6. Registro Storico Sessioni & Diagnostica Log

### Analisi Sessione `session-1787428626914-agy7`
* **Task Utente:** Creazione e scaffolding di un'applicazione React + Tailwind CSS con layout responsive mobile-first.
* **Causa Anomalia Rilevata nei Log:** Nei primi step si è verificato un errore di scaffolding/comando, che ha portato `errorCountInHistory` a 2. Il vecchio meccanismo di `evaluateTaskComplexity` e `runCircuitBreaker` ha interpretato questo conteggio come segnale di auto-healing forzando l'escalation a `qwen2.5-coder:14b` dal turno 5 al turno 9.
* **Risoluzione Definitiva:** Con il blocco del target model in `selectModelForTurn` e la rimozione dello swap nel circuit breaker, l'agente rimane saldamente sul modello impostato dall'utente per tutta la sessione.
