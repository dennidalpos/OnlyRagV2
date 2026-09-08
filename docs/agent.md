# Autonomous Coding Agent — OnlyRag V2

Il **Coding Agent Studio (CAS)** di OnlyRag V2 è un ambiente agentico autonomo ottimizzato specificamente per operare con modelli open-weights compatti (7B - 14B) in esecuzione locale tramite Ollama su hardware consumer.

---

## 1. Ciclo di Esecuzione (Tool Calling Loop)

L'orchestrazione è governata da [`agentOrchestratorAppService.ts`](../electron/core/application/agentOrchestratorAppService.ts) e si articola in fasi deterministiche:

```
[Prompt Utente] ──> [Intervista Opzionale] ──> [Plan Generation & Seed]
                                                        │
┌─────────────────────── Loop Iterativo ────────────────┘
│
├── 1. collect_context: mappa, frammenti, memoria e direttiva corrente
├── 2. propose_action: una risposta Ollama, interpretata come singola proposta
├── 3. apply_action: autorizzazioni, gate e applicazione tramite executor esistente
├── 4. verify: risultato, circuit breaker, milestone ed eventuale verifica di progetto
└── 5. outcome: chiusura applicativa basata sulle evidenze
```

Le transizioni sono validate da [`agentExecutionPhase.ts`](../electron/core/domain/agent/agentExecutionPhase.ts). `agentOrchestratorTurnDispatch.ts` separa la costruzione del contesto dalla richiesta al modello; una sessione ripresa ricomincia sempre dalla raccolta del contesto, mentre l'ultima fase raggiunta resta nel checkpoint come diagnostica. Il modello propone soltanto l'azione corrente: applicazione, verifica e chiusura appartengono al programma.

### 1.1 Protocollo strutturato Ollama

- Intervista e generazione del piano usano `/api/chat` non streaming con `format` JSON Schema derivato dai contratti Zod in [`ollamaStructuredResponse.ts`](../electron/core/domain/agent/ollamaStructuredResponse.ts).
- Le istruzioni viaggiano come messaggio `system`; richiesta, fatti e residui come dati nel messaggio `user`.
- Una risposta è utilizzabile solo con `done: true`, `done_reason` diverso da `length` e schema valido. Il piano Markdown viene derivato dal JSON validato.
- Il loop di esecuzione usa `/api/chat` con `tools` senza `format`: Ollama 0.33.3 accetta entrambi i campi ma, nella prova locale, `format` sopprime `tool_calls`. Il fallback testuale resta temporaneamente per i modelli senza tool calling nativo.
- Schema valido, correttezza semantica e autorizzazione sono indipendenti: i compilatori di piano e gli executor mantengono gli ultimi due controlli.
- I recuperi hanno budget separati per trasporto, schema ed esecuzione, ma condividono un tetto di due chiamate nella generazione strutturata: dopo il primo errore viene concessa una sola correzione, al secondo il flusso si arresta con firma e motivo diagnostico. Il fallback da tool calling nativo a testo consuma lo stesso budget di trasporto e non attiva retry annidati.
- Un comando interrotto, scaduto o fallito dopo il dispatch produce un esito `uncertain`: l'orchestratore non lo ripete automaticamente, conserva la consegna parziale e chiude attraverso il gate applicativo. Annullamento utente e relativo motivo terminale hanno precedenza sul recupero.
- Il modello coding viene risolto e precaricato una sola volta all'avvio dell'esecuzione; i turni successivi mantengono quel tag e il primo `num_ctx` effettivo. Non esistono cambio modello o crescita del contesto impliciti come strategia di recupero.

### 1.2 Tool per fase

[`turnToolPolicy.ts`](../electron/core/domain/agent/turnToolPolicy.ts) deriva dalla direttiva corrente la superficie minima: sola lettura durante l'esplorazione, un solo edit durante la modifica, comando/verifica solo quando scelti dall'app e `finish` solo in chiusura. Web, Git, recupero, ambiente e visual validation sono aggiunti soltanto quando il lavoro li richiede. La stessa allowlist filtra il catalogo nativo Ollama o il fallback testuale ed è ricontrollata da gate ed executor.

### 1.3 Fatti del progetto prima del piano

[`projectPlanningFacts.ts`](../electron/core/application/projectPlanningFacts.ts) riusa discovery e repo-map per fornire a intervista e planner classificazione del workspace, stack, file pertinenti e decisioni precedenti. I fatti sono riletti a ogni richiesta; domande già risolte dal repository o da una decisione confermata vengono filtrate dall'app.

Le verifiche sono divise tra comandi **eseguibili**, osservati nei manifest correnti e ammessi dal gate, e check **proposti**, validi solo dopo la creazione dello scaffold. Su greenfield [`greenfieldScaffoldResolver.ts`](../electron/core/domain/agent/greenfieldScaffoldResolver.ts) deriva lo scheletro minimo esclusivamente dallo stack esplicito o confermato: Python, Rust e JavaScript non web non ricevono entrypoint HTML/React. Una directory con file esistenti non viene riclassificata come greenfield solo perché manca un manifest.

### 1.4 Intervista selettiva

[`planInterviewPolicy.ts`](../shared/domain/agent/planInterviewPolicy.ts) invia direttamente al planner le richieste operative chiare. L'intervista viene attivata solo per una scelta alternativa esplicita ancora irrisolta o quando l'utente chiede di essere consultato; produce normalmente una domanda e non più di due. Dopo le risposte viene eseguita la sola inferenza necessaria a generare il piano, senza ripetere decisioni già acquisite.

### 1.5 Contratto delle decisioni

Lo schema richiede ID univoci, una motivazione breve, due o tre opzioni distinte e un indice raccomandato valido. [`interviewValidation.ts`](../shared/domain/agent/interviewValidation.ts) controlla la lingua e accetta solo una risposta corrente e non vuota per domanda; testo libero e scelte manuali hanno provenienza esplicita, mentre “usa consigliati” registra l'accettazione della raccomandazione. La sola visualizzazione del consiglio non conferma alcuna scelta.

---

## 2. Guardrail Cognitivi per Modelli Compatti (SLM)

I modelli 7B soffrono di specifici limiti di ragionamento multi-step su cui OnlyRag V2 interviene con guardie deterministiche di dominio:

### 2.1. Arbitro delle Direttive ([`planDirectiveArbiter.ts`](../electron/core/domain/agent/planDirectiveArbiter.ts))
Quando una build fallisce o mancano dipendenze, l'arbitro inietta **un singolo ordine imperativo e non negoziabile**:
1. **Dipendenze non installate (`node_modules` assente)**: ordina tassativamente `run_command: npm install` prima di qualsiasi tentativo di build.
2. **Package non dichiarato**: ordina `run_command: npm install <pkg>`.
3. **Package non installabile**: ordina la riscrittura del singolo file importatore tramite `write_file`.

### 2.2. Direttive di Diagnostica del Compilatore ([`compilerDiagnosticDirective.ts`](../electron/core/domain/agent/compilerDiagnosticDirective.ts))
Isola dal log di compilazione TypeScript/Vite il primo errore bloccante prioritario, fornendo file, riga e codice errore, impedendo al modello di modificare file estranei.

### 2.3. Rilevatore di Loop ([`loopDetector.ts`](../electron/core/domain/agent/loopDetector.ts))
Intercetta pattern ricorsivi patologici:
- Invocazione ripetuta dello stesso tool con gli stessi argomenti.
- Ping-pong tra due file.
- Comandi shell identici falliti consecutivamente.
Al raggiungimento della soglia (tipicamente 3 occorrenze), scatta il blocco con iniezione di un messaggio di correzione forzata.

### 2.4. Autorità sulle Milestone ([`milestoneUpdateAuthority.ts`](../electron/core/domain/agent/milestoneUpdateAuthority.ts))
Il modello non ha l'autorità di dichiarare le milestone "completate". Lo stato `completed` viene attribuito esclusivamente dal backend quando:
- I file previsti dal deliverable esistono su disco e non sono semplici placeholder o commenti ([`milestoneDeliverableResolver.ts`](../shared/domain/agent/milestoneDeliverableResolver.ts)).
- I comandi di verifica dichiarati nel piano vengono eseguiti con exit code 0 ([`milestoneVerificationPromotion.ts`](../electron/core/domain/agent/milestoneVerificationPromotion.ts)).

Le prove restano separate: la presenza dell'artefatto è un prerequisito, build/typecheck sono evidenza di compilazione e i test sono evidenza comportamentale. Il controllo globale dell'app copre le milestone senza prova dedicata; una milestone che dichiara un comando richiede invece proprio quel comando, che non può essere sostituito da altre verifiche del piano.

---

## 3. Gestione del Budget di Contesto

1. **Selezione iniziale `num_ctx`** ([`hardwareProfileResolver.ts`](../electron/core/domain/agent/hardwareProfileResolver.ts)): risolve una volta il limite hardware, la preferenza per modello e il `context_length` dichiarato da Ollama; la finestra resta poi fissa per l'esecuzione.
2. **Compattazione Memoria Episodica** ([`episodicMemoryCompactor.ts`](../electron/core/domain/agent/episodicMemoryCompactor.ts)): Distilla i turni intermedi mantenendo un tetto fisso per il contesto (~18% per la struttura dei file) e preservando intatti gli ultimi scambi e gli errori bloccanti correnti.
3. **Intervento attivo** ([`planPromptWindow.ts`](../shared/domain/agent/planPromptWindow.ts), [`activeInterventionActions.ts`](../shared/domain/agent/activeInterventionActions.ts)): il piano canonico conserva tutto il lavoro, ma ogni turno espone soltanto l'intervento corrente e fino a quattro azioni sequenziali. Edit collegati restano circoscritti al contratto modificato e la verifica avviene dopo il gruppo coerente.
4. **Contesto operativo corrente**: obiettivo attivo, vincoli accettati, tool ammessi, percorsi pertinenti e ultimo errore utile sono raccolti in un blocco breve. Il codice iniettato contiene un file primario e al massimo due frammenti di supporto; ogni omissione è marcata con la dimensione esclusa e l'indicazione di usare `read_file`. La traiettoria completa resta nel checkpoint della sessione, fuori dal payload corrente.

Le richieste agente attraversano la coda a concorrenza 1; il lock globale impedisce agli altri moduli UI di competere per il modello residente. Tutte le fasi coding usano temperatura `0.1` e keep-alive `30m`, con tetti distinti: 768 token per intervista, 2048 per piano e 4096 per edit. La diagnostica modelli espone l'allocazione osservata da `/api/ps`: memoria totale, quota GPU e quota CPU/RAM. Questi valori sono misure del modello caricato, non stime o soglie universali ricavate dal numero di parametri.

### 3.1. Piano strutturato

Il piano persistito usa esclusivamente `formatVersion: 2`: obiettivo, decisioni/assunzioni, evidenze conservate, lavoro superato e interventi sono campi strutturati. Ogni intervento dichiara file, criteri di accettazione e riferimenti di verifica; checklist e Markdown sono viste derivate. Il backend rifiuta una ripianificazione che omette lavoro residuo senza conservarlo tramite `sourceInterventionId` o dichiararlo in `supersededWork`.

Non è prevista migrazione dei vecchi piani testuali: il caricamento mantiene la sessione ma ignora revisioni prive di `formatVersion: 2`. L'esecuzione usa `filePaths` e gli altri campi canonici, non il testo renderizzato.

Alla ripresa, deliverable persistiti vengono riletti dal disco. Una prova file ancora valida resta verificata; file mancanti riaprono l'intervento e i comandi precedentemente riusciti devono essere rieseguiti, perché potrebbero precedere modifiche esterne.

### 3.2. Edit vincolati alla versione letta

`read_file` restituisce una `FILE VERSION` SHA-256. `write_file` la richiede per sovrascrivere un file esistente, mentre la creazione usa scrittura esclusiva; `replace_file_content` e `multi_replace_file_content` applicano solo blocchi esatti e univoci. Subito prima della persistenza [`fileSystemRepository.ts`](../electron/core/infrastructure/filesystem/fileSystemRepository.ts) ricontrolla la versione e registra il journal soltanto per una scrittura accettata. In conflitto nessun contenuto viene scritto: l'agente riceve hash correnti, diff sintetico quando disponibile e l'ordine di rileggere e rigenerare l'edit.

---

## 4. Test e Validazione Live

- **Live Test Harness** ([`scripts/live/agentLiveHarness.ts`](../scripts/live/agentLiveHarness.ts)): Ambiente di test automatizzato che esegue sessioni agentiche complete contro modelli reali su Ollama.
- **Scenari di Regressione**:
  - `agentBenchmark.test.ts`: test di riparazione codice guidata.
  - `fullTaskRun.live.ts`: esecuzione end-to-end con creazione workspace temporaneo, installazione dipendenze, test e commit.
- **Riferimento Razionali**: Per i casi studio dettagliati e i log di run storiche, consultare [`code-rationales.md`](./code-rationales.md).
