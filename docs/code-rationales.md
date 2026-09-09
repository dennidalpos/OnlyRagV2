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

### 2.4. Piano completo e prove non intercambiabili
* **Problema**: Il precedente tetto a 15 fondeva interventi distinti. Nel gruppo risultante sopravviveva solo il primo `verificationCommand`, quindi un suo esito positivo poteva sostituire le prove successive. Anche due interventi adiacenti sullo stesso file venivano accorpati perdendo identità e metadati.
* **Soluzione**: La compilazione conserva ogni intervento e limita solo la finestra ripetuta nel prompt ([`planPromptWindow.ts`](../shared/domain/agent/planPromptWindow.ts)). Il controllo globale copre le milestone senza prova dedicata; quando una milestone dichiara un comando, la promozione richiede la corrispondenza con quello eseguito, oltre alla presenza degli artefatti. Le note distinguono presenza, compilazione e comportamento.

### Piani canonici strutturati (CAS-17)

* **Problema**: persistenza, revisione ed esecuzione potevano dipendere dal reparsing del Markdown, con perdita di decisioni, requisiti residui o prove.
* **Soluzione**: `AgentPlan` v2 conserva obiettivo, decisioni/assunzioni, interventi con file e criteri, evidenze mantenute e lavoro esplicitamente superato. Il Markdown è solo una vista derivata; ripianificazioni che perdono interventi aperti vengono rifiutate.
* **Compatibilità**: per decisione di progetto non viene eseguita una migrazione dei vecchi piani testuali; le sessioni restano leggibili, ma quelle revisioni vengono ignorate.

### Espansione dell'intervento attivo (CAS-18)

* **Problema**: ripetere più milestone complete nel prompt mescolava lavoro corrente e futuro; una verifica persistita poteva inoltre restare valida dopo modifiche esterne.
* **Soluzione**: il prompt espande soltanto l'intervento attivo in massimo quattro azioni e mantiene il resto nello stato canonico. Gli edit collegati sono ammessi solo quando richiesti dal contratto modificato; la verifica segue il gruppo coerente. Alla ripresa, file e comandi vengono rivalidati prima di conservare lo stato `verified`.

### 2.5. Schema, correttezza e autorizzazione
* **Evidenza (Ollama 0.33.3, 2026-09-08)**: `/api/chat` con `format` ha prodotto JSON conforme ma una domanda inutile per una richiesta già determinata. Con `tools` e `format` simultanei il modello ha restituito contenuto conforme allo schema senza `tool_calls`.
* **Soluzione**: Intervista e piano usano schema Zod tramite `format`; il loop usa `tools` senza `format`. `done`, schema, correttezza del piano e autorizzazione dell'executor restano controlli separati. Nessun contenuto incompleto viene eseguito.

### 2.6. Fasi applicative, non un secondo orchestratore
* **Problema**: La costruzione del prompt e l'inferenza erano una singola operazione, mentre proposta, applicazione e verifica erano visibili soltanto dall'ordine delle chiamate nel loop.
* **Soluzione**: [`agentExecutionPhase.ts`](../electron/core/domain/agent/agentExecutionPhase.ts) ammette solo transizioni esplicite; il loop esistente resta l'unico coordinatore e continua a usare executor, gate, persistenza, log e chiusura preesistenti. Il checkpoint registra l'ultima fase senza riprendere operazioni potenzialmente parziali.

### 2.7. Catalogo tool minimo per turno
* **Problema**: Esporre circa trenta schemi a ogni inferenza consuma contesto e permette a un modello compatto di scegliere operazioni non pertinenti alla fase.
* **Soluzione**: La direttiva applicativa seleziona una allowlist breve. Il catalogo inviato via `/api/chat` e quello testuale contengono gli stessi soli tool; gate ed executor respingono anche una chiamata valida ma non esposta. Le capacità avanzate sono ammesse solo quando nominate dall'obiettivo o richieste dalla direttiva corrente.

### 2.8. Fatti prima delle domande
* **Problema**: Intervista e planner potevano chiedere stack, package manager o verifiche già determinate dai manifest del workspace.
* **Soluzione**: Un collector comune aggrega il discovery esistente, seleziona voci pertinenti dalla repo-map e conserva la provenienza delle decisioni. L'intervista filtra le domande già risolte; il collector non usa cache, quindi ogni workspace o revisione vede fatti aggiornati.

### 2.9. Intervista pre-plan selettiva
* **Problema**: Una chiamata preliminare obbligatoria raddoppiava le inferenze anche per richieste operative chiare.
* **Soluzione**: Una policy deterministica invia direttamente al planner le richieste chiare e attiva il modello intervistatore solo per alternative irrisolte esplicite o su richiesta dell'utente. Evita così di affidare a un modello compatto un fragile schema combinato domanda/piano.

### 2.10. Conferma delle decisioni
* **Problema**: Una preselezione UI o un ID di una vecchia intervista potevano essere interpretati come risposta confermata.
* **Soluzione**: Schema e validatore controllano cardinalità, unicità, lingua, opzioni e raccomandazione. L'arricchimento richiede il set corrente di domande e provenienza esplicita; il pulsante di conferma resta inattivo finché ogni scelta non viene effettuata, mentre l'azione separata sui consigli ne registra l'accettazione.

### 2.11. Scaffold e verifiche derivati dal progetto
* **Problema**: Il compilatore interpretava qualsiasi file JS/TS come applicazione web e anteponeva sempre `package.json`, `tsconfig.json`, `index.html` e `src/main.tsx`; un check futuro poteva inoltre sembrare già disponibile.
* **Soluzione**: Lo scaffold greenfield è una blueprint deterministica ricavata solo dalla richiesta o da decisioni confermate. I file esistenti disattivano il re-scaffolding anche senza manifest. I comandi osservati restano eseguibili e soggetti al gate; quelli richiesti dallo scaffold sono etichettati come futuri e non possono entrare nel runner finché il discovery non li rileva realmente.

### 2.12. Edit ottimistici e conflitti (CAS-20)
* **Problema**: Una riscrittura completa poteva sovrascrivere modifiche dell'utente avvenute dopo la lettura; il fuzzy matching poteva scegliere un blocco simile o uno tra più blocchi uguali.
* **Soluzione**: Le letture espongono un hash SHA-256. Riscritture esistenti e scritture finali dei replace vengono confrontate di nuovo prima della persistenza; i nuovi file usano creazione esclusiva. I replace richiedono corrispondenza esatta e univoca e i batch vengono preparati integralmente prima del journal, quindi un errore non lascia applicazioni parziali. Il conflitto restituisce una diagnostica utile senza toccare il disco.

### 2.13. Affidabilità runtime Ollama (W2.10)
* **Problema**: percorsi Main indipendenti potevano interrompersi a vicenda; inoltre rifiuti tool non riconosciuti dai marker testuali venivano registrati come successi e una sessione ripresa poteva cambiare profilo.
* **Soluzione**: una coda globale serializza tutte le generazioni e isola l'annullamento delle richieste in attesa. Gli executor dichiarano un esito strutturato. Il checkpoint fissa e rivalida endpoint, modello, digest e opzioni e conserva per turno tempi/token Ollama e split memoria CPU/GPU osservato da `/api/ps`.
* **Verifica**: suite completa 228 file / 1869 test; due esecuzioni complete consecutive non hanno riprodotto il timeout intermittente di `capabilityPolicyAuditRepository.test.ts` (chiusura W2.08 senza aumento del timeout).

### 2.14. Qualifica live CAS-23
* **Evidenza (2026-09-09)**: sei run corrette cold/warm con qwen2.5-coder 1.5B/3B/7B hanno chiuso 0 milestone verificate. Gli stop sono stati sicuri, ma conflitti di versione ripetuti, tool malformati e JSX scritto in file `.js` impediscono l'autonomia multi-file.
* **Correzioni confermate**: gli ID del piano sono canonici lato applicazione; i setup command-only vengono ricondotti allo scaffold; range npm non pubblicati vengono corretti con fatti registry prima dell'installazione.
* **Limite**: un `npm install` riuscito ha promosso una milestone intermedia senza provarne il deliverable; 1.5B/3B hanno inoltre ignorato una richiesta esplicita di intervista. I dati completi sono in [`agent-live-testing.md`](./agent-live-testing.md).

### 2.15. Installazione non equivale a verifica (W2.12)
* **Problema**: `npm install eslint-config-prettier@10.1.8` conteneva la sottostringa `lint`; il vecchio riconoscimento per keyword lo classificava come controllo riuscito e promuoveva milestone con artefatti presenti.
* **Soluzione**: la promozione automatica accetta solo un comando risolto dal profilo del progetto. Il gate dei comandi rifiuta inoltre install/add come prova, proteggendo piani ripristinati o modificati.
* **Verifica**: regressione deterministica sul comando live; nessuna modifica a `hasVerifiedBuild` e nessuna chiamata di promozione.

---

## 3. Gestione Dinamica della Memoria di Contesto

### 3.1. Dimensionamento `num_ctx` per Ollama
* **Evidenza**: L'allocazione statica di contesti ampi (es. 32K) su GPU consumer causa crash CUDA Out of Memory o riversamento pesante su RAM di sistema, abbattendo la velocità di inferenza da 30 token/s a 1 token/s.
* **Soluzione ([`contextWindowCalculator.ts`](../shared/domain/agent/contextWindowCalculator.ts))**: Il calcolo di `num_ctx` è dinamico: conteggio reale dei token BPE con `gpt-tokenizer` (`o200k_base`), dimensionamento della KV-cache sui tier di VRAM disponibili e pre-allocazione calibrata (es. 8192 quando consentito dal tier per prevenire ri-allocazioni KV durante il task).

### 3.2. Compattatore Euristico delle Memorie Episodiche
* **Evidenza**: Conservare l'intero dump dei turni precedenti esaurisce la finestra di contesto entro 10-15 step dell'agente.
* **Soluzione ([`episodicMemoryCompactor.ts`](../electron/core/domain/agent/episodicMemoryCompactor.ts))**: Mantiene una quota fissa per la mappa del workspace (~18% di `maxContextChars`), comprime i turni storici intermedi distillando solo le azioni chiave e gli esiti dei comandi, preservando integrali solo l'ultimo turno e gli errori bloccanti attivi.

### 3.3. Contesto per operazione
* **Problema**: Mappa, RAG, skill, file e cronologia completi nello stesso turno riducono lo spazio di output e rendono meno visibile l'errore corrente.
* **Soluzione**: La direttiva seleziona i blocchi pertinenti e un riepilogo operativo concentra obiettivo, vincoli, percorsi e ultimo errore. Vengono iniettati un file primario e due soli supporti; i file oltre budget mostrano testa, coda e quantità omessa, senza troncamenti invisibili. La cronologia resta persistita nel checkpoint.

---

## 4. Sicurezza nell'Esecuzione dei Comandi Shell

### 4.1. Filtraggio Comandi Distruttivi
* **Soluzione ([`verificationCommandSafety.ts`](../shared/domain/agent/verificationCommandSafety.ts))**: Interdizione assoluta di comandi come `rm -rf`, `clean -fd`, `drop table`, `format`, o comandi con redirect arbitrari che sovrascrivono cartelle di sistema.

### 4.2. Quoting e Falsi Positivi JSX
* **Caso Limite Storico**: Un comando shell contenente un echo con markup JSX (es. `echo "<div className=...>"` o reindirizzamento testuale) veniva intercettato dal parser di sicurezza come tentativo di redirection malevola (`>`).
* **Risoluzione**: Sostituzione delle porzioni racchiuse tra virgolette prima dell'analisi degli operatori di redirezione, eliminando i falsi positivi senza indebolire le guardie di sicurezza.
