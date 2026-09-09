# Architettura Frontend (Renderer Process) — OnlyRag V2

Il processo di rendering di OnlyRag V2 è un'applicazione Single Page Application moderna sviluppata con **React 19**, **Vite**, **Tailwind CSS**, **Monaco Editor** e **Zustand** per lo state management.

---

## 1. Topologia delle Viste e Code Splitting

Le viste principali dell'applicazione sono caricate tramite code splitting dinamico (`React.lazy` + `Suspense` in [`AppLayout.tsx`](../src/components/layout/AppLayout.tsx)). Una volta scaricata e montata la prima volta, la vista rimane in memoria: in questo modo il bundle iniziale è ridotto all'essenziale e lo stato delle tab aperte non viene mai perso quando l'utente passa da una schermata all'altra.

| Vista | Path Componente | Scopo |
| :--- | :--- | :--- |
| **Coding Agent Studio** | [`CodingAgentView.tsx`](../src/components/coding/CodingAgentView.tsx) | Studio con azioni principali Chiedi/Modifica, accesso esplicito al Plan, Monaco Editor, Git Diff e Timeline agentica. |
| **RAG Chat** | [`ChatView.tsx`](../src/components/chat/ChatView.tsx) | Interfaccia conversazionale con grounding documentale, visualizzazione citazioni e gestione multi-sessione. |
| **Document Ingestion** | [`IngestionView.tsx`](../src/components/ingestion/IngestionView.tsx) | Upload e parsing ad alta velocità (PyMuPDF + RapidOCR o Vision LLM), editor Markdown ed esportazione. |
| **Translation** | [`TranslationView.tsx`](../src/components/translation/TranslationView.tsx) | Traduzione bilingue Markdown side-by-side e traduzione geometrica in-place su file PDF e Word. |
| **Settings & Wizard** | [`SettingsView.tsx`](../src/components/settings/SettingsView.tsx) | Gestione hardware tier, assegnazione ruoli modelli, prompt di sistema e Setup Wizard guidato. |

---

## 2. Core Hooks & State Engines

Gli hook in [`src/hooks/`](../src/hooks/) incapsulano lo stato e i flussi asincroni con Electron IPC:

* **`useCodingAgent.ts`**: Composition root del Coding Agent Studio. Coordina il ciclo agentico, lo streaming dei tool eseguiti, le richieste di approvazione per comandi critici e il tracciamento metriche.
* **`useChatEngine.ts`**: Gestisce lo stato conversazionale multi-sessione della chat RAG, calcolo dinamico del budget prompt (`chatContextBudget.ts`), streaming token Ollama ed espansione snippet citati.
* **`useIngestion.ts`**: Gestisce drag & drop, upload sequenziale, parsing progressivo con NDJSON streaming, anteprima raster pagine e sincronizzazione scroll bidirezionale editor-anteprima.
* **`useAgentTerminal.ts`**: Terminale PowerShell interattivo integrato con buffer delle ultime 500 righe e mirroring dei comandi shell eseguiti in background dall'agente.
* **`useAgentTimelineScroll.ts`**: Distingue accuratamente lo scroll programmatico (verso l'ultimo log) dai gesti manuali dell'utente (rotella o touch): se l'utente scorre in alto per ispezionare log precedenti, l'autoscroll si disattiva istantaneamente.
* **`useSessionHistory.ts`**: Persistenza delle sessioni sul filesystem del workspace (`.onlyrag/`), debouncing delle scritture e migrazione da localStorage.

---

## 3. Servizi del Frontend (`src/services/`)

* **`hardwareRecommendationEngine.ts`**: Calcola la compatibilità dei modelli GGUF rispetto alla RAM di sistema e alla VRAM GPU disponibile.
* **`modelIntentClassifier.ts`**: Classificatore deterministico delle capacità dei modelli Ollama (coding, vision, embedding, translation, chat).
* **`domainRouter.ts`**: Sub-router ultrarapido (<1ms sincrono in React) basato su similarità di centroidi TF-IDF / N-gram multilingua per indirizzare query mediche, legali o generali ai modelli specialistici dedicati.
* **`chatContextBudget.ts` & `chatContextCompactor.ts`**: Dimensionamento del retrieval e compattazione della cronologia conversazionale a coppie di turni utente-assistente per prevenire perdite di contesto.

---

## 4. UI e Componenti Specializzati

* **Timeline Virtualizzata** ([`AgentTimeline.tsx`](../src/components/coding/AgentTimeline.tsx)): Renderizzata con `@tanstack/react-virtual` per garantire 60 FPS costanti anche con sessioni contenenti centinaia di tool eseguiti, diff di codice e log di build.
* **Diagnostica sessione** ([`AgentTimelineMessage.tsx`](../src/components/coding/AgentTimelineMessage.tsx)): fase e stop restano immediati; esito verifica, budget di recupero e runtime riproducibile sono raccolti in un dettaglio espandibile. I controlli non disponibili restano distinti da quelli falliti.
* **Gerarchia Studio** ([`AgentModeSelector.tsx`](../src/components/coding/AgentModeSelector.tsx)): Chiedi è il percorso iniziale supervisionato, Modifica avvia l'esecuzione autonoma e Plan resta una scelta esplicita. Stato corrente e Stop restano nell'header; Terminale e diagnostica sono espandibili da Dettagli, mentre skill e storico restano nel menu strumenti.
* **Intervista e revisione Plan** ([`PlanInterviewCard.tsx`](../src/components/coding/PlanInterviewCard.tsx), [`PlanReviewCard.tsx`](../src/components/coding/PlanReviewCard.tsx)): i consigli richiedono accettazione esplicita e ogni domanda ammette una risposta libera. Prima della checklist sono visibili decisioni confermate e assunzioni; risultato, file e check possono essere validati e salvati come nuova revisione. Durante generazione o salvataggio le azioni incompatibili restano disabilitate; retry e cambio sessione conservano soltanto lo stato appartenente alla sessione corrente.
* **Monaco Editor Ufficiale** ([`monacoTheme.ts`](../src/lib/monacoTheme.ts)): Configurazione centralizzata del tema scuro `onlyrag-dark`, font stack (Fira Code / Cascadia Code), ligature e minimappa.
* **Normalizzazione Centralizzata Errori** ([`errorNormalizer.ts`](../src/lib/errors/errorNormalizer.ts)): Pulisce caratteri ANSI, categorizza errori di rete, GPU CUDA (OOM), permessi filesystem (`EACCES`, `EBUSY`) e genera suggerimenti correttivi (*remediation*) per l'utente.
