# Runtime e orchestrazione Agent

Il flusso operativo è coordinato da [`agentOrchestratorAppService.ts`](../electron/core/application/agentOrchestratorAppService.ts). Il modello propone azioni; Main autorizza, esegue, verifica e stabilisce la chiusura.

```text
complexity check -> [interview -> plan] -> collect_context -> propose_action
                                                     -> apply_action -> verify -> outcome
```

## Modalità operative

- **Ask**: strettamente read-only.
- **Guided** (default): richiede revisione e conferma per ogni mutazione (scrittura, rimozione, comandi shell).
- **Auto**: autorizza l'esecuzione autonoma locale; i gate per commit, installazione pacchetti e accesso di rete restano sempre attivi.
- Richieste colloquiali di creazione (es. "fammi un sito") attivano gli strumenti di scrittura solo dietro approvazione in Guided; richieste di sola consultazione restano read-only.
- Task complessi entrano automaticamente nel flusso di pianificazione (`automaticPlanningPolicy.ts`). In Guided il piano attende revisione; in Auto viene avviato subito. Task brevi e mirati partono direttamente.

## Pianificazione e intervista

- Intervista e generazione piano usano `/api/chat` non-streaming con JSON Schema e `num_predict` calcolato sullo spazio libero residuo.
- `AgentPlan` strutturato (`formatVersion: 2`) è l'unica sorgente eseguibile; la resa Markdown è solo una vista per l'utente.
- Se il modello supporta reasoning a livelli (es. `gpt-oss:20b`), le richieste strutturate inviano `think: 'low'` (`resolveStructuredThinkValue` in [`structuredGenerationRecovery.ts`](../electron/core/application/structuredGenerationRecovery.ts)) per evitare payload vuoti con JSON Schema.
- Risposte strutturate invalide registrano `done_reason`, token impiegati e diagnostica dei delimitatori di testo.

## Confinamento e workspace

- **Run di progetto**: opera in un worktree Git temporaneo o copia isolata (`DisposableAgentWorkspace`). I percorsi utente non vengono mai esposti a shell, download o package manager. La pubblicazione nel workspace sorgente (`publish_workspace`) richiede verifica del baseline e approvazione esplicita.
- **Standalone**: confinato in `userData/agent-scratch`, persistente tra sessioni e gestibile da UI (Mostra, Esporta, Svuota). Le run senza workspace valido sono rifiutate senza ricadere nella cartella di installazione o in `process.cwd()`.

## Contesto, token e thinking

- **Misuratore Ctx**: calcola i token BPE effettivi del prompt composto da Main (`turnContextPolicy.ts`, `contextWindowCalculator.ts`), riservando lo spazio necessario alla risposta.
- **Finestra di contesto**: `num_ctx` rispetta il limite sicuro dell'hardware (`hardwareProfileResolver.ts`) e il massimo dichiarato dal modello.
- **Compattazione**: la modalità `Compact` attiva la riduzione aggressiva dello storico operativo inviato al modello (`heuristicContextCompactor.ts`); la timeline completa di audit rimane intatta.
- **Thinking**: preferenze gestite per singolo modello (`ollamaThinkingPolicy.ts`). Nei modelli con supporto binario, la UI espone il toggle on/off. Nei modelli level-only, la UI mostra una nota informativa e il flusso isola il ragionamento nel canale `thinking` separandolo dall'output finale.

## Sessione, identità e audit

- Ogni comando ed evento trasporta l'identità immutabile `{ runId, conversationId, planRevisionId, workspaceId }`. Il Renderer accetta solo eventi della run attiva.
- Timeout e annullamento condividono un `AbortSignal`; la cancellazione blocca l'elaborazione di eventi successivi.
- Al completamento, la timeline espone evidenze persistite: file modificati, esito dell'ultima verifica ed eventuali effetti esterni.
- **Log di audit**: disattivato per default; salva solo metadati e hash. L'inclusione di prompt e sorgenti completi richiede l'opt-in esplicito (impostazioni conservano da 1 a 5 generazioni con rotazione).
