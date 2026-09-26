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
- Se il modello accetta solo livelli di reasoning (es. `gpt-oss:20b`), le richieste strutturate inviano il livello più basso riportato da `/api/show` (`resolveStructuredThinkValue` in [`ollamaThinkingPolicy.ts`](../shared/domain/agent/ollamaThinkingPolicy.ts)) per evitare payload vuoti con JSON Schema.
- Risposte strutturate invalide registrano `done_reason`, token impiegati e diagnostica dei delimitatori di testo.

## Ciclo di esecuzione

- Agent Coding richiede un modello installato che dichiari `tools` in Ollama. Ogni turno usa `/api/chat` con schemi nativi: Main conserva i messaggi `assistant` (contenuto, thinking e chiamate) e `tool`, esegue tutte le chiamate ricevute in ordine e restituisce ogni esito al modello prima della risposta successiva. Il fallback che interpreta JSON dal testo non è usato in questo percorso.
- Il modello può scegliere letture, modifiche, comandi e verifiche senza che una direttiva del piano restringa artificialmente il catalogo. Main applica comunque i controlli Ask/Guided/Auto, il confinamento del workspace, il consenso per rete e installazioni, le versioni dei file e il gate di chiusura basato su evidenze. `git_commit` viene esposto solo se richiesto nel task e richiede sempre conferma.
- Le risposte con più tool call vengono elaborate una alla volta. Una chiamata `finish` viene esaminata dopo le altre della stessa risposta. Il passo successivo parte solo dopo il risultato del passo precedente.
- Ogni chiamata riceve un messaggio `tool` con l'esito reale: motivo di un rifiuto (sicurezza, utente, policy, modalità), stato del piano dopo `update_plan`, errori di schema. Una risposta di sola prosa riceve il feedback come messaggio `user`, così la trascrizione non termina mai con un messaggio `assistant`. Output troncato (`done_reason=length`) o argomenti non JSON tornano al modello come feedback invece di un nuovo tentativo identico.
- Solo `planDirectiveArbiter.ts` emette ordini, al massimo uno per turno e mai per un tool che la capability policy rifiuta; gli altri controlli restituiscono fatti consultivi nel risultato del tool.

## Confinamento e workspace

- **Run di progetto**: opera direttamente nel workspace dell'utente, con i suoi `node_modules`, il piano approvato e lo stato di sessione. Il journal registra lo stato precedente di ogni file modificato dai tool; a fine run, anche per annullamento o timeout, diventa un checkpoint in `.onlyrag/checkpoints/<id>` ([`agentCheckpointStore.ts`](../electron/core/infrastructure/filesystem/agentCheckpointStore.ts)) e le modifiche restano sul disco. Il ripristino è un'azione esplicita dell'utente (`agent:restore-checkpoint`, pulsante nella scheda di evidenza). La cartella `.onlyrag/` contiene un `.gitignore` che la esclude dal repository. Gli effetti dei comandi shell (installazioni, generatori) non sono nel checkpoint e compaiono tra gli effetti esterni.
- La scoperta dei progetti ignora le cartelle di cache di pytest, oltre a build, dipendenze e ambienti virtuali: una cache non accessibile non interrompe il piano.
- **Standalone**: confinato in `userData/agent-scratch` (`userdata_dev/agent-scratch` senza Electron, mai la cartella home), persistente tra sessioni e gestibile da UI (Mostra, Esporta, Svuota). Le run senza workspace valido sono rifiutate senza ricadere nella cartella di installazione o in `process.cwd()`.

## Contesto, token e thinking

- **Prefisso stabile**: la richiesta è `[system, task, ...trascrizione, contesto del turno]`. Il messaggio `system` viene composto una volta per sessione e il task compare una sola volta come primo messaggio `user`; passo, stato del piano, direttiva ed errori stanno nell'ultimo messaggio `user`, effimero. Ollama riusa la cache KV solo sul prefisso comune fra richieste consecutive, quindi ogni turno rivaluta solo le novità ([`agentChatTranscript.ts`](../electron/core/application/agentChatTranscript.ts)).
- **Follow-up**: una nuova run nella stessa conversazione conserva la trascrizione; il primo messaggio `user` resta il task iniziale della conversazione e la nuova richiesta viene aggiunta una volta in coda. Modello e `num_ctx` fissati da una run valgono solo per la sua ripresa: un follow-up usa le impostazioni correnti ([`agentOrchestratorSessionContext.ts`](../electron/core/application/agentOrchestratorSessionContext.ts)).
- **Misuratore Ctx**: misura i messaggi realmente inviati più gli schemi tool; la stima BPE locale viene corretta al rialzo con il conteggio `prompt_eval_count` riportato da Ollama.
- **Finestra di contesto**: `num_ctx` rispetta il limite dell'hardware (`hardwareProfileResolver.ts`), con 65536 token per l'agente su host con almeno 32 GB di RAM (Ollama raccomanda almeno 64000 token per agenti e coding), e il massimo dichiarato dal modello. `num_predict` occupa lo spazio residuo della finestra; almeno un quarto della finestra (2k-16k token) resta riservato alla risposta.
- **Campionamento**: l'agente non invia `temperature`, `top_p`, `top_k`, `repeat_penalty`, `num_thread` né stop sequence; valgono i default del Modelfile e i core fisici scelti da Ollama. `modelSamplingOverrides` permette un override per modello, modificabile nella scheda del modello in Impostazioni (Campionamento) ([`ollamaSamplingOptions.ts`](../shared/domain/agent/ollamaSamplingOptions.ts)).
- **Compattazione**: quando la trascrizione supera il budget, gli scambi più vecchi vengono rimossi fino al 70% del budget in un solo passo, così la cache resta valida fra un taglio e il successivo. La modalità `Compact` conserva l'ultimo scambio assistente/tool e il task corrente. La timeline di audit rimane intatta.
- **Thinking**: preferenze per singolo modello (`ollamaThinkingPolicy.ts`), con i livelli letti da `/api/show`. Senza preferenza l'agente omette `think` e Ollama applica il default del modello; la UI offre "Predefinito del modello", "Spento" (se il modello lo consente) e i livelli riportati. Chat e traduzione restano senza thinking finché l'utente non lo attiva.

## Sessione, identità e audit

- Ogni comando ed evento trasporta l'identità immutabile `{ runId, conversationId, planRevisionId, workspaceId }`. Il Renderer accetta solo eventi della run attiva.
- Timeout e annullamento condividono un `AbortSignal`; la cancellazione blocca l'elaborazione di eventi successivi. Nessuno dei due annulla le modifiche: entrambi salvano il checkpoint e il timeout notifica la fine della run al Renderer.
- Il timeout predefinito della sessione è 120 minuti, configurabile nelle impostazioni. Il trasporto chat attende fino a 10 minuti la prima risposta di un modello in caricamento. Il silenzio tollerato nello stream segue la velocità misurata nella sessione (il tempo per circa 4096 token, fra 5 e 30 minuti), perché Ollama non trasmette una tool call finché non è completa.
- Stato di sessione e storico stanno in `<workspace>/.onlyrag/sessions`; senza un workspace utilizzabile in `userData/sessions` (`userdata_dev/sessions` senza Electron, quindi anche nei test), mai nella cartella home dell'utente ([`userDataRoot.ts`](../electron/core/infrastructure/filesystem/userDataRoot.ts)).
- La trascrizione nativa viene salvata con lo stato della sessione. Dopo un'interruzione, le chiamate rimaste senza risultato sono marcate come non eseguite prima di riprendere la conversazione.
- Al completamento, la timeline espone evidenze persistite: file modificati, esito dell'ultima verifica ed eventuali effetti esterni.
- I log Main per selezione del contesto, policy del turno e interpretazione delle chiamate tool portano una chiave `localized`; il Renderer li mostra nella lingua attiva e conserva nel messaggio persistito il testo italiano. `Task Finished:` resta invariato perché la timeline lo interpreta come prefisso strutturale.
- Il risultato di un tool può portare `localized.message` nel contratto `ToolExecutionResult`; il processore lo inoltra alla timeline senza interpretare `logMessage`. I risultati di `run_command` e `run_tests` usano questo percorso per gli esiti principali; `outputForHistory` e l'output grezzo restano disponibili al modello.
- **Log di audit**: disattivato per default; salva solo metadati e hash. L'inclusione di prompt e sorgenti completi richiede l'opt-in esplicito (impostazioni conservano da 1 a 5 generazioni con rotazione).
