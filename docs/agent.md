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

### 1.2 Tool per fase

[`turnToolPolicy.ts`](../electron/core/domain/agent/turnToolPolicy.ts) deriva dalla direttiva corrente la superficie minima: sola lettura durante l'esplorazione, un solo edit durante la modifica, comando/verifica solo quando scelti dall'app e `finish` solo in chiusura. Web, Git, recupero, ambiente e visual validation sono aggiunti soltanto quando il lavoro li richiede. La stessa allowlist filtra il catalogo nativo Ollama o il fallback testuale ed è ricontrollata da gate ed executor.

### 1.3 Fatti del progetto prima del piano

[`projectPlanningFacts.ts`](../electron/core/application/projectPlanningFacts.ts) riusa discovery e repo-map per fornire a intervista e planner classificazione del workspace, stack, file pertinenti, verifiche disponibili e decisioni precedenti. I fatti sono riletti a ogni richiesta; domande già risolte dal repository o da una decisione confermata vengono filtrate dall'app. Una richiesta esplicita può comunque cambiare tali scelte.

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

1. **Calcolo Dinamico `num_ctx`** ([`contextWindowCalculator.ts`](../shared/domain/agent/contextWindowCalculator.ts)): Calcola i token BPE effettivi con tokenizer OpenAI `o200k_base`, allocando il contesto ottimale su Ollama in funzione della VRAM disponibile (da 4096 a 32768).
2. **Compattazione Memoria Episodica** ([`episodicMemoryCompactor.ts`](../electron/core/domain/agent/episodicMemoryCompactor.ts)): Distilla i turni intermedi mantenendo un tetto fisso per il contesto (~18% per la struttura dei file) e preservando intatti gli ultimi scambi e gli errori bloccanti correnti.
3. **Finestra del piano** ([`planPromptWindow.ts`](../shared/domain/agent/planPromptWindow.ts)): Il piano canonico conserva tutte le identità, i criteri e i comandi. Ogni turno mostra al modello al massimo 15 milestone attorno a quella attiva, segnalando quante restano fuori dalla finestra senza fonderle o rinumerarle.
4. **Contesto operativo corrente**: obiettivo attivo, vincoli accettati, tool ammessi, percorsi pertinenti e ultimo errore utile sono raccolti in un blocco breve. Il codice iniettato contiene un file primario e al massimo due frammenti di supporto; ogni omissione è marcata con la dimensione esclusa e l'indicazione di usare `read_file`. La traiettoria completa resta nel checkpoint della sessione, fuori dal payload corrente.

---

## 4. Test e Validazione Live

- **Live Test Harness** ([`scripts/live/agentLiveHarness.ts`](../scripts/live/agentLiveHarness.ts)): Ambiente di test automatizzato che esegue sessioni agentiche complete contro modelli reali su Ollama.
- **Scenari di Regressione**:
  - `agentBenchmark.test.ts`: test di riparazione codice guidata.
  - `fullTaskRun.live.ts`: esecuzione end-to-end con creazione workspace temporaneo, installazione dipendenze, test e commit.
- **Riferimento Razionali**: Per i casi studio dettagliati e i log di run storiche, consultare [`code-rationales.md`](./code-rationales.md).
