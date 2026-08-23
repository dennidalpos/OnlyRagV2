# Specifiche e Piano: Modale Gerarchico Unificato di Configurazione Prompt e Regole SLM

Questo documento definisce l'architettura, le specifiche tecniche e i microtask operativi sequenziali per l'implementazione del **Pannello/Modale Gerarchico Unificato di Configurazione dei Prompt e delle Regole SLM** in OnlyRag V2.

L'implementazione sostituisce l'attuale gestione frammentata e contestuale con un'unica interfaccia ad albero centralizzata, accessibile sia dalle **Impostazioni Generali** sia dai **pulsanti prompt delle singole sezioni** (Coding Studio, RAG Chat, Traduzione, Ingestion/OCR), garantendo al contempo la **piena ottimizzazione dei token** e la **coerenza stilistica con il Design System** dell'applicazione.

---

## 🎨 1. Coerenza Stilistica & Design System UI

Il nuovo modale rispetta rigorosamente i componenti e le convenzioni visive di OnlyRag V2:

* **Overlay & Inviluppo**: Utilizzo della primitiva unificata [`Modal.tsx`](file:///d:/GITHUB/OnlyRagV2/src/components/common/Modal.tsx) (`layer="base"`, blocco dello scroll tramite `useLockBodyScroll`, chiusura con tasto ESC o click su backdrop).
* **Dimensioni & Layout**: Layout responsive full-featured `w-[94vw] max-w-6xl h-[88vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col`.
* **Palette Colori & Tematizzazione**:
  - Sfondo container: `bg-slate-900` / `bg-slate-950` con divisori `border-slate-800`.
  - Accenti primari: `text-cyan-400`, `bg-cyan-500/10`, `border-cyan-500/30`, gradienti `from-cyan-600 to-blue-600`.
  - Badge di stato dei nodi:
    - `Default` (di fabbrica): `bg-slate-800/80 text-slate-400 border-slate-700/60`
    - `Modificato` (personalizzato): `bg-amber-500/10 text-amber-300 border-amber-500/30`
    - `Attivo/Selezionato`: `bg-cyan-500/15 text-cyan-300 border-cyan-500/40`
* **Editor Monaco**: Integrazione di `@monaco-editor/react` agganciato al tema ufficiale `onlyrag-dark` configurato in [`src/lib/monacoTheme.ts`](file:///d:/GITHUB/OnlyRagV2/src/lib/monacoTheme.ts).
* **Pulsanti di Azione**:
  - Ripristino sicuro in-place: [`InlineDestructiveConfirm.tsx`](file:///d:/GITHUB/OnlyRagV2/src/components/common/InlineDestructiveConfirm.tsx) per azzerare solo il nodo selezionato senza modali di alert esterni.
  - Salvataggio: Pulsante standard a gradiente ciano-blu con feedback visivo temporizzato.

---

## ⚡ 2. Preservazione Ottimizzazione Token & Anti-Duplicazione

L'implementazione preserva integralmente tutte le ottimizzazioni token e di caching attive nella codebase:

1. **Deduplicazione Tool Calling Nativo (AGT2)**:
   - Su modelli compatibili (`qwen2.5-coder`, `llama3.1`), la compilazione del prompt omette il blocco testuale `CODING_TOOLS_BLOCK` per non duplicare le definizioni inviate tramite il parametro `tools` di `/api/chat` (~1.000 token risparmiati per turno).
2. **Preservazione Ollama Prefix Caching (AGT1)**:
   - Il `turnSuffix` (step counter dinamico, recovery hint) rimane rigorosamente separato in coda al prompt; la `stableSection` e il `baseSystemPrompt` rimangono byte-identici tra i turni per abilitare il riutilizzo della KV cache di Ollama (`context` continuation).
3. **Disgiunzione dei Segmenti per Compattazione Euristica**:
   - `HeuristicContextCompactor` riceve segmenti isolati (plan, files, skills, RAG context, repo map), evitando doppi conteggi che causerebbero l'azzeramento spurio della cronologia dei tool.
4. **Compressione Spazi Bianchi**:
   - `collapseBlankRuns` normalizza le sequenze `\n{3,}` $\rightarrow$ `\n\n` originate da placeholder non valorizzati.

---

## 🌳 3. Struttura Gerarchica dell'Albero dei Nodi

```
├── 🤖 Coding Agent & Autonomous Loop
│   ├── [coding:master]      Master System Template (Ruolo, Workspace, Task, Placeholders)
│   ├── [coding:directives]  Core Directives & Execution Rules (12 Regole, Anti-Loop, Scaffolding, DoD Gate)
│   └── [coding:tools]       Tool Schema & JSON Convention Block (Definizione parametri e formati tool)
│
├── 💬 RAG Chat & Conversational Reasoning
│   ├── [chat:qwen]          Alibaba Qwen 2.5 / Qwen-Coder Preset
│   ├── [chat:llama]         Meta Llama 3 / 3.1 / 3.2 / 3.3 Preset
│   ├── [chat:deepseek]      DeepSeek-Coder / V3 / R1 Preset
│   ├── [chat:mistral]       Mistral / Codestral / Nemo Preset
│   ├── [chat:gemma]         Google Gemma 2 / 3 Preset
│   ├── [chat:phi]           Microsoft Phi-3 / Phi-4 Preset
│   ├── [chat:granite]       IBM Granite 3.0 / 3.3 Preset
│   └── [chat:generic]       Universal Fallback Preset
│
├── 🌐 Document Translation & Localization
│   ├── [translation:qwen]    Qwen Multilingual Preset
│   ├── [translation:llama]   Llama Translation Preset
│   ├── [translation:mistral] Mistral Translation Preset
│   └── [translation:generic] Universal Translation Fallback
│
└── 👁️ Vision, OCR & Multimodal
    ├── [vision:minicpm]     OpenBMB MiniCPM-V Preset
    ├── [vision:llava]        LLaVA / BakLLaVA Preset
    ├── [vision:moondream]    Moondream 2 Preset
    └── [vision:generic]      Universal Vision Fallback
```

---

## 🛠️ SPECIFICHE TECNICHE ED ARTEFATTI DI VERIFICA

* **Manifest di Progetto**: `package.json`
* **Librerie Utilizzate**: `@monaco-editor/react`, `gpt-tokenizer`, `diff`, `jsonrepair`, `lucide-react`
* **Comandi di Validazione Sequenziali Consentiti**:
  - `npm run typecheck` (Controllo statico dei tipi TypeScript)
  - `npm run test:fast` (Suite di test logica di dominio e componenti)
  - `powershell -ExecutionPolicy Bypass -File ./scripts/test_bundle_smoke.ps1 -Fast` (Smoke test bundle e canali IPC)
  - `npm run audit:cycles` (Verifica assenza dipendenze circolari)

---

## 📋 PIANO OPERATIVO AI-AGENT (MICROTASK ATOMICI)

### Fase 1: Domain & Types Layer (Registro e Compilatore Gerarchico)
- [ ] **m-1: Definizione Tipi e Contratti per l'Albero Gerarchico**
  Inserire le interfacce `PromptHierarchyNode`, `PromptHierarchyCategory`, `PromptScope` e `PromptVariableMeta` nei tipi di dominio.
  * **Deliverable**: `src/types/index.ts`
  * **Verifica**: `npm run typecheck`

- [ ] **m-2: Creazione del Registro di Dominio dei Prompt di Fabbrica**
  Implementare il registro centrale immutabile con tutti i nodi e sotto-blocchi (Master, Direttive, Tool, Famiglie SLM), comprensivo di testi predefiniti e descrizioni delle variabili.
  * **Deliverable**: `electron/core/domain/agent/promptHierarchyRegistry.ts`
  * **Verifica**: `npm run test:unit-only`

- [ ] **m-3: Estensione del Compilatore Prompt con Risoluzione a Sotto-Blocchi**
  Aggiornare `PromptCompiler.ts` per supportare la risoluzione gerarchica:
  - Innesto dinamico di `coding:directives` e `coding:tools` all'interno del master template.
  - Spostamento di `getEffectivePrompt` e `compilePromptWithSampleVars` all'interno del Domain Layer con re-export pulito.
  - Preservazione rigorosa dell'omissione di `CODING_TOOLS_BLOCK` su modelli nativi (`toolCallingCapable`).
  * **Deliverable**: `electron/core/domain/agent/promptCompiler.ts` e `src/constants/promptPresets.ts`
  * **Verifica**: `npm run test:agent`

---

### Fase 2: Presentation & UI Layer (Navigazione ad Albero & Monaco Editor)
- [ ] **m-4: Sviluppo del Componente PromptConfigurationModal**
  Costruire il modale unificato a 2 colonne integrato con `Modal.tsx`:
  - **Colonna Sinistra**: Ricerca istantanea, categorie comprimibili, selezione nodi con badge di stato (`Default`, `Modificato`).
  - **Colonna Destra**: Header con metadati nodo, contatore token in tempo reale via `gpt-tokenizer`, Monaco Editor con tema `onlyrag-dark`, pillole variabili dinamiche cliccabili e cassetto per test di anteprima compilata.
  * **Deliverable**: `src/components/settings/PromptConfigurationModal.tsx`
  * **Verifica**: `npm run typecheck`

- [ ] **m-5: Integrazione Reset Sicuro In-Place e Persistenza Atomica**
  Integrare `InlineDestructiveConfirm` nel footer dell'editor per il ripristino atomico del singolo nodo a `defaultValue`. Agganciare il salvataggio al flusso unificato `onUpdateSettings({ customPromptOverrides })` su `AppSettings`.
  * **Deliverable**: `src/components/settings/PromptConfigurationModal.tsx`
  * **Verifica**: `npm run typecheck`

- [ ] **m-6: Eliminazione Codice Legacy (Zero Legacy Policy)**
  Rimuovere completamente il vecchio `SystemPromptModal.tsx` e aggiornare gli unit test associati per testare il nuovo `PromptConfigurationModal.tsx`.
  * **Deliverable**: `src/components/common/SystemPromptModal.tsx` [DELETE], `src/components/settings/PromptConfigurationModal.test.ts` [NEW]
  * **Verifica**: `npm run test:fast`

---

### Fase 3: Integrazione Punti di Accesso UI & Hooks
- [ ] **m-7: Aggancio del Modale a Impostazioni e Viste Funzionali**
  - Aggiungere il pulsante di apertura modale generale in [`SettingsView.tsx`](file:///d:/GITHUB/OnlyRagV2/src/components/settings/SettingsView.tsx).
  - Aggiornare i pulsanti prompt in [`ChatView.tsx`](file:///d:/GITHUB/OnlyRagV2/src/components/chat/ChatView.tsx), [`CodingAgentView.tsx`](file:///d:/GITHUB/OnlyRagV2/src/components/coding/CodingAgentView.tsx), [`TranslationView.tsx`](file:///d:/GITHUB/OnlyRagV2/src/components/translation/TranslationView.tsx) e [`IngestionView.tsx`](file:///d:/GITHUB/OnlyRagV2/src/components/ingestion/IngestionView.tsx) per aprire `PromptConfigurationModal` pre-selezionando il nodo corrispondente.
  - Aggiornare gli import in [`useChatEngine.ts`](file:///d:/GITHUB/OnlyRagV2/src/hooks/useChatEngine.ts) e [`useTranslation.ts`](file:///d:/GITHUB/OnlyRagV2/src/hooks/useTranslation.ts) verso il Domain Layer.
  * **Deliverable**: `src/components/settings/SettingsView.tsx`, viste e custom hooks.
  * **Verifica**: `npm run typecheck`

---

### Fase 4: Chiusura & Definition of Done (DoD Gate)
- [ ] **m-8: Validazione Completa della Codebase e Verifica Regressioni**
  Esecuzione dell'intera catena di verifica sequenziale (Typecheck, Fast Tests, Smoke Test IPC, Controllo Cicli) e aggiornamento documentazione in `/docs/`.
  * **Deliverable**: `package.json`, `docs/piano_configurazione_prompts.md`, `PROJECT_STATUS.json`
  * — verify: `npm run typecheck && npm run test:fast && powershell -ExecutionPolicy Bypass -File ./scripts/test_bundle_smoke.ps1 -Fast && npm run audit:cycles`
