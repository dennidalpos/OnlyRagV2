# Razionali Ingegneristici ed Evidenze Empiriche — OnlyRag V2

Questo documento raccoglie il patrimonio di lezioni apprese, evidenze empiriche da sessioni live ed esiti di benchmark dell'Autonomous Coding Agent di OnlyRag V2, permettendo al codice sorgente di restare sintetico e token-efficient senza perdere alcun dettaglio storico o decisionale.

---

## 1. Psicologia Operativa degli SLM Locali (Small Language Models)

L'agente di coding è progettato e testato primariamente per modelli locali compatti (7B - 14B parametri, es. `qwen2.5-coder:7b`, `deepseek-r1:8b`). I benchmark e le live session (in particolare quelle del 24-25 agosto 2026) hanno evidenziato pattern comportamentali specifici:

### 1.1. Singolo Imperativo vs Decisioni Multiple
* **Evidenza**: Quando a un modello 7B viene presentata una direttiva contenente due imperativi o un'alternativa ("installa il pacchetto oppure rimuovi l'import dal file"), il modello sceglie sistematicamente l'azione cognitivamente più economica (spesso creare un nuovo file vuoto o ignorare l'errore) piuttosto che risolvere il problema alla radice.
* **Soluzione architetturale**: [`planDirectiveArbiter.ts`](../electron/core/domain/agent/planDirectiveArbiter.ts) formula sempre **un solo comando univoco** con il nome esatto del tool (`run_command: npm install <pkg>`). Nessuna alternativa da soppesare nel prompt.

### 1.2. Ordine delle Dipendenze prima del Build
* **Evidenza**: Se `npm run build` viene eseguito in un workspace senza `node_modules`, il terminale fallisce con `vite: not found`. Un modello 7B non interpreta l'assenza del binario, ma presume che `package.json` sia errato e inizia a riscriverlo, allucinando configurazioni.
* **Soluzione**: La direttiva `dependencies_missing` (`npm install`) è tassativamente ordinata prima del build. Lanciare un comando destinato a fallire distrugge la coerenza dell'agente.

### 1.3. Gestione di Import Non Installabili e Falsi Positivi
* **Evidenza (Live run 2026-08-25)**: Il modello ha importato un pacchetto non esistente (`@tailwindcss/react`). La direttiva di installazione ha tentato il comando per 13 step a vuoto. Quando è stata introdotta la rimozione forzata, il sistema segnalava erroneamente `@mui/material` come pacchetto "inventato" solo perché `npm install` falliva con `ERESOLVE` dovuto a conflitti di versione preesistenti (`react@16.14.0`).
* **Soluzione**: [`planDirectiveArbiter.ts`](../electron/core/domain/agent/planDirectiveArbiter.ts) riporta solo fatti provati da conteggi di errore (`packagesWithFailedInstall`), senza asserire che un pacchetto "non esiste nel registry". Quando un'installazione fallisce, ordina `write_file` su un singolo file target per rimuovere l'import, riportando eventuali altri file solo come conteggio.

### 1.4. Direttive del Compilatore e Diagnostica TypeScript
* **Evidenza**: Nei log di build di Vite/TypeScript compaiono frequentemente decine di errori contemporaneamente. Se l'agente riceve una lista caotica, tenta correzioni parziali sovrascrivendo file corretti.
* **Soluzione**: [`compilerDiagnosticDirective.ts`](../electron/core/domain/agent/compilerDiagnosticDirective.ts) isola l'errore bloccante prioritario, fornendo il path esatto e la linea, lasciando gli errori secondari come lista non ordinata da risolvere nei turni successivi.

---

## 2. Autorità sulle Milestone e Verifica delle Prove

### 2.1. Da Modello Assoluto a Verifica Falsificabile
* **Problema originario**: In passato il modello poteva invocare `update_plan` e marcare arbitrariamente una milestone come `completed` anche senza aver scritto il file o senza test superati.
* **Soluzione ([`milestoneUpdateAuthority.ts`](../electron/core/domain/agent/milestoneUpdateAuthority.ts))**: Lo status di completamento è tolto al modello. L'avanzamento a `completed` avviene esclusivamente tramite il promotion watcher del sistema, che verifica la presenza reale dei deliverable sul file system e l'esecuzione con exit code 0 dei comandi di test associati.

### 2.2. Rigetto di File Placeholder e Stub
* **Evidenza**: I modelli tendono a creare file contenenti unicamente `// TODO: implement later` o scheletri vuoti pur di marcare il file come esistente.
* **Soluzione ([`milestoneDeliverableResolver.ts`](../shared/domain/agent/milestoneDeliverableResolver.ts))**: La sola presenza e dimensione non nulla non bastano: il resolver analizza il contenuto ed espelle file che consistono unicamente di commenti, stub vuoti o blocchi di deferral.

### 2.3. Circuit Breaker per No-Op e Re-delivery
* **Evidenza**: Nelle sessioni live, quando il modello si trova in stallo, tende a riscrivere ripetutamente gli stessi file senza modifiche sostanziali (*no-op rewrite*) oppure a ri-completare milestone già chiuse.
* **Soluzione ([`agentOrchestratorCircuitBreakerAndVerification.ts`](../electron/core/application/agentOrchestratorCircuitBreakerAndVerification.ts))**: Il circuit breaker rileva se un file non ha diff rispetto alla versione su disco o se una milestone era già completa, interrompendo il loop e indirizzando il modello verso l'obiettivo successivo non ancora soddisfatto.

---

## 3. Gestione Dinamica della Memoria di Contesto

### 3.1. Dimensionamento `num_ctx` per Ollama
* **Evidenza**: L'allocazione statica di contesti ampi (es. 32K) su GPU consumer causa crash CUDA Out of Memory o riversamento pesante su RAM di sistema, abbattendo la velocità di inferenza da 30 token/s a 1 token/s.
* **Soluzione ([`contextWindowCalculator.ts`](../shared/domain/agent/contextWindowCalculator.ts))**: Il calcolo di `num_ctx` è dinamico: conteggio reale dei token BPE con `gpt-tokenizer` (`o200k_base`), dimensionamento della KV-cache sui tier di VRAM disponibili e pre-allocazione calibrata (es. 8192 quando consentito dal tier per prevenire ri-allocazioni KV durante il task).

### 3.2. Compattatore Euristico delle Memorie Episodiche
* **Evidenza**: Conservare l'intero dump dei turni precedenti esaurisce la finestra di contesto entro 10-15 step dell'agente.
* **Soluzione ([`episodicMemoryCompactor.ts`](../electron/core/domain/agent/episodicMemoryCompactor.ts))**: Mantiene una quota fissa per la mappa del workspace (~18% di `maxContextChars`), comprime i turni storici intermedi distillando solo le azioni chiave e gli esiti dei comandi, preservando integrali solo l'ultimo turno e gli errori bloccanti attivi.

---

## 4. Sicurezza nell'Esecuzione dei Comandi Shell

### 4.1. Filtraggio Comandi Distruttivi
* **Soluzione ([`verificationCommandSafety.ts`](../shared/domain/agent/verificationCommandSafety.ts))**: Interdizione assoluta di comandi come `rm -rf`, `clean -fd`, `drop table`, `format`, o comandi con redirect arbitrari che sovrascrivono cartelle di sistema.

### 4.2. Quoting e Falsi Positivi JSX
* **Caso Limite Storico**: Un comando shell contenente un echo con markup JSX (es. `echo "<div className=...>"` o reindirizzamento testuale) veniva intercettato dal parser di sicurezza come tentativo di redirection malevola (`>`).
* **Risoluzione**: Sostituzione delle porzioni racchiuse tra virgolette prima dell'analisi degli operatori di redirezione, eliminando i falsi positivi senza indebolire le guardie di sicurezza.
