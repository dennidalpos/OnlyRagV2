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
├── 1. Context Assembly: Mappa workspace + Memoria episodica compatta + Direttive
├── 2. Inferenza LLM: Generazione tool call strutturato (write_file, replace_chunk, run_command...)
├── 3. Parsing & Validation: `toolParser.ts` convalida parametri contro schema JSON
├── 4. Tool Execution: `agentToolExecutorService.ts` esegue l'azione (con checkpoint e safety gates)
├── 5. Circuit Breakers: Verifica no-op, rilevamento loop e controllo dipendenze mancanti
├── 6. Milestone Watcher: Promozione verificata delle milestone su evidenza tangibile
└── 7. Condizione di Termine: Completamento comprovato, budget esaurito o richiesta utente
```

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

---

## 4. Test e Validazione Live

- **Live Test Harness** ([`scripts/live/agentLiveHarness.ts`](../scripts/live/agentLiveHarness.ts)): Ambiente di test automatizzato che esegue sessioni agentiche complete contro modelli reali su Ollama.
- **Scenari di Regressione**:
  - `agentBenchmark.test.ts`: test di riparazione codice guidata.
  - `fullTaskRun.live.ts`: esecuzione end-to-end con creazione workspace temporaneo, installazione dipendenze, test e commit.
- **Riferimento Razionali**: Per i casi studio dettagliati e i log di run storiche, consultare [`code-rationales.md`](./code-rationales.md).
