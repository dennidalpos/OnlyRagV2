# Specifiche e Piano: Modale Gerarchico di Configurazione Prompt e Regole SLM

Questo documento descrive i microtask sequenziali e atomici per integrare il pannello di controllo gerarchico dei system prompt in OnlyRag V2 nel rispetto della Clean Layered Architecture del progetto (Presentation, Application, Domain, Infrastructure).

---

## 🛠️ SPECIFICHE TECNICHE ED ARTEFATTI DI VERIFICA
* **Manifest di Progetto Attivo**: `package.json`
* **Comandi di Validazione Consentiti**: 
  - `npm run typecheck` (Verifica statica dei tipi TypeScript)
  - `npm run test:unit-only` (Suite di test logica di dominio)
  - `.\scripts\test_bundle_smoke.ps1` (Smoke test di inizializzazione dei canali IPC)

---

## 📋 PIANO OPERATIVO AI-AGENT (MICROTASK ATOMICI)

### Fase 1: Domain & Types Layer (Estensione dei Modelli Puri)
- [ ] **m-1: Definizione Strutture Dati e Tipi TypeScript**
  Inserire le interfacce `PromptScope`, `PromptNode` e `PromptHierarchyConfiguration` nel file dei contratti globale per garantire la tipizzazione rigida cross-process.
  * **Deliverable**: `src/types/index.ts`
  * **Verifica**: Controllare la presenza delle definizioni esportate tramite analisi AST.

- [ ] **m-2: Creazione del Registro di Dominio dei Prompt di Fabbrica**
  Creare il registro centrale immutabile contenente l'albero gerarchico dei prompt ereditati (Global, RAG Grounding, Anti-Loop, DoD Gate) con i relativi metadati e testi di fallback predefiniti.
  * **Deliverable**: `electron/core/domain/agent/promptHierarchyRegistry.ts`
  * **Verifica**: Eseguire `npm run test:unit-only` per validare l'integrità del file di dominio.

---

### Fase 2: Infrastructure & Application Layer (Persistenza e Routing)
- [ ] **m-3: Estensione dello Schema AppSettings e Sanitizzatore**
  Aggiornare l'entità pura e le funzioni di merge/sanitizzazione delle impostazioni applicative per includere il dizionario di mappatura dei prompt personalizzati dall'utente (`customPrompts`).
  * **Deliverable**: `electron/core/domain/settings/appSettingsDomain.ts`
  * **Verifica**: `npm run test:unit-only` su regressioni di configurazione.

- [ ] **m-4: Implementazione Canali IPC di Lettura e Scrittura Atomica**
  Implementare i canali IPC `settings:get-prompt-hierarchy` e `settings:save-prompt-node` nel Presentation Layer, agganciandoli al sistema di scrittura sicura su filesystem (.tmp + rename).
  * **Deliverable**: `electron/core/presentation/settingsIpc.ts`
  * **Verifica**: Eseguire lo smoke test headless `.\scripts\test_bundle_smoke.ps1` per validare la corretta registrazione dei nuovi canali IPC a livello di Main Process.

---

### Fase 3: Frontend Component Layer (UI & Monaco Editor Integration)
- [ ] **m-5: Sviluppo del Componente PromptConfigurationModal**
  Costruire l'interfaccia ad albero nel Renderer Process sfruttando la primitiva unificata `Modal.tsx` per il blocco dello scroll e l'overlay standard. Integrare `@monaco-editor/react` configurato con il tema ufficiale `onlyrag-dark` per l'editing in tempo reale dei prompt Markdown.
  * **Deliverable**: `src/components/settings/PromptConfigurationModal.tsx`
  * **Verifica**: Verificare l'assenza di conflitti di classi CSS e l'uso corretto dei nodi modificabili.

- [ ] **m-6: Integrazione del Pulsante di Ripristino Sicuro In-Place**
  Integrare la primitiva `InlineDestructiveConfirm.tsx` all'interno del modale per consentire l'azzeramento locale di un prompt modificato riportandolo al valore `defaultValue` di fabbrica, evitando dialoghi a tutto schermo estranei al design system.
  * **Deliverable**: `src/components/settings/PromptConfigurationModal.tsx`
  * **Verifica**: `npm run typecheck` per escludere firme di callback errate.

---

### Fase 4: Chiusura e Quality Assurance Gate
- [ ] **m-7: Aggancio dei Moduli Funzionali al Runtime di Configurazione**
  Sostituire i riferimenti statici dei prompt nel loop agentico e nella chat RAG inserendo il caricamento dinamico dallo store delle impostazioni, applicando il fallback deterministico se la regola personalizzata è assente.
  * **Deliverable**: `electron/core/application/agentOrchestratorAppService.ts`
  * **Verifica**: Eseguire `npm run typecheck` per accertarsi che nessun modulo utilizzi più le vecchie costanti rigide.

- [ ] **m-8: Validazione Finale della Codebase (DoD Verification)**
  Eseguire la catena completa di testing dell'applicazione per certificare che l'introduzione dei canali di configurazione non abbia introdotto dead code o violazioni architetturali.
  * **Deliverable**: `package.json`
  * — verify: `npm run typecheck && npm run test:fast && .\scripts\test_bundle_smoke.ps1`
