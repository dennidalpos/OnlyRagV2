# Guardrail e budget di progresso

I guardrail garantiscono la sicurezza dell'ambiente locale, la coerenza delle modifiche concorrenti e l'interruzione rapida di cicli o stati di stallo.

## Politica di progresso (`agentProgressPolicy.ts`)

[`agentProgressPolicy.ts`](../electron/core/domain/agent/agentProgressPolicy.ts) è l'autorità centrale sul non-progresso della sessione. Gestisce una tabella unificata `PROGRESS_BUDGET`, mentre [`loopDetector.ts`](../electron/core/domain/agent/loopDetector.ts) classifica i pattern di esecuzione.

| Evento | Soglia | Esito |
| --- | --- | --- |
| Risposta in sola prosa con lavoro aperto | 2 richieste di tool | Chiusura con `model_silence` |
| Chiamata tool non conforme allo schema | 1 correzione | Chiusura con `schema_budget` |
| Errore di esecuzione del tool | 3 errori identici o 6 consecutivi (azzerati da modifica riuscita o comando andato a buon fine); timeout e prompt interattivi sono errori come gli altri | Chiusura con `execution_budget` |
| `run_command`/`run_tests` fallito riproposto identico senza modifiche nel mezzo | Blocco immediato (non consuma budget esecuzione) | Trattato come blocco di loop (`loop_unchanged_failure`). Dopo una modifica riuscita la stessa verifica non conta come ripetizione |
| Ripetizione di azione già riuscita | 3 avvisi `redundant_success` | Conteggiato come blocco di loop |
| Blocco di loop | 2 avvisi, poi 1 blocco su 2 forza l'avanzamento milestone (`force_advance`) | A 20 blocchi senza budget step: arresto `stagnation_abort` |
| Chiamata bloccata che la direttiva del piano ordina | Il guard cede: il comando di `verification_due`, o una scrittura diversa dalle precedenti sul file in `rewriteTargets` della direttiva ([`agentOrchestratorFinishAndLoopGuards.ts`](../electron/core/application/agentOrchestratorFinishAndLoopGuards.ts)) | Una ripetizione identica (`exact_repeat`) resta bloccata |
| Domanda generica in AUTO | 2 reindirizzamenti (condivisi con blocchi loop) | Chiusura con `ask_redirect` |
| Domanda sulle versioni delle dipendenze in AUTO | Risoluzione automatica da registry npm ([`versionQuestion.ts`](../electron/core/domain/agent/versionQuestion.ts)) | Consuma il budget reindirizzamenti; all'esaurimento: `ask_redirect` |
| `read_file` su directory o file mancante | Restituisce listing directory o `[FILE NOT FOUND: ...]`, non errore di esecuzione | I guard di lettura ripetuta rimangono attivi ([`readFileTool.ts`](../electron/core/domain/agent/tools/fs/readFileTool.ts)) |
| Step eseguiti senza modifiche | 12 step | Chiusura con `no_mutation` |
| Tool negato dalla policy di fase | Contato come step senza mutazioni (`tool_policy`) | Verso chiusura `no_mutation` |
| Conflitto di versione con modello che propone altro | Main esegue automaticamente `read_file` sul file conteso | La lettura sblocca la mutazione successiva |

## Tracciamento eventi e chiusure

- Ogni evento di arresto o forzatura viene registrato come `{ guard, action: advise | force_advance | stop, step }` (`AgentGuardId` in `shared/types`).
- Una chiusura da guard di stop (`request.guard`) imposta sempre lo stato `blocked`: il task interrotto non viene mai contrassegnato come verificato o proposto per la pubblicazione.
- Le verifiche di progetto tracciano il comando canonico (`canonicalCommand`): `npm test`, `npm t` e `npm run test` sono considerati equivalenti.

## Consigli e ordini

Un turno porta al massimo un ordine, quello di [`planDirectiveArbiter.ts`](../electron/core/domain/agent/planDirectiveArbiter.ts) nel contesto del turno. Le diagnostiche restituiscono un `DiagnosticAdvice` ([`diagnosticAdvice.ts`](../electron/core/domain/agent/diagnosticAdvice.ts)): intestazione, fatti osservati, prossima chiamata suggerita e vincoli successivi.

- Nel risultato del tool il consiglio è reso da `renderAdvice` sotto l'etichetta "Suggested fix (advice; ...)", senza la formulazione riservata agli ordini (`ORDER_MARKER`: `Directives:` o `MUST`).
- Solo l'arbitro lo rende come ordine con `renderOrder`, direttamente o dentro la direttiva di verifica fallita (`buildVerificationFailingDirective` in `verificationAttemptTracker.ts`, chiamata solo dall'arbitro); `parseRenderedAdvice` ricostruisce il consiglio dal testo salvato nella trascrizione.
- I guard senza un'unica chiamata successiva (interventi di `loopDetector`, rifiuti di gate, avvisi) usano `renderAdviceSteps`: intestazione, fatti e opzioni numerate sotto la stessa etichetta. Sono consigli tutti gli altri testi per il modello: diagnostiche di compilatore, build e test, realtà delle versioni e manifest in sospeso, risoluzione moduli, `ETARGET`, conflitti npm e downgrade di installazione, scritture ridondanti, gate di integrità dipendenze e dichiarazioni di import, promozione e aggiornamento milestone, `verificationGatePolicy`, `transactionalExecutionGuard`, rifiuto directory di `write_file`, blocchi dev server, tool-as-shell e pacchetto inesistente di `processToolService`, avvisi del circuit breaker su cartelle annidate, guard di finish e di loop e nota di ricerca web.
- Formulano ordini solo i moduli dell'arbitro: `planDirectiveArbiter.ts`, i builder che solo lui chiama (`postVerificationClosure.ts`, `behaviorTestDirective.ts`, `entrypointIntegrity.ts`, `verificationAttemptTracker.ts`), `diagnosticAdvice.ts` (`renderOrder`), il blocco focus di `planAndSolveGraph.ts` che rende la decisione e il system prompt di `promptPresets.ts`. [`orderAuthority.test.ts`](../electron/core/domain/agent/orderAuthority.test.ts) scansiona `electron/` e `shared/` e fallisce se `ORDER_MARKER` compare altrove (commenti esclusi).
- Nessun pattern di loop dedicato ai nomi di tool passati a `run_command`: `processToolService` rifiuta ogni chiamata del genere (`TOOL_AS_SHELL_BLOCK`) e la ripetizione è fermata da `execution_budget`. Il pattern `shell_tool_confusion` di `loopDetector` era ridondante, non è mai scattato in 86 snapshot live ed è stato rimosso il 2026-09-26.
- Il comando iniziale imposto dall'utente ("Run exactly \`<comando>\` first") è la decisione `user_first_command` dell'arbitro, la prima per priorità e solo al turno 1: prima era anteposto al blocco del piano e arrivava al modello accanto a un secondo ordine (per esempio `dependencies_missing` o le direttive del blocco focus).

## Compare-and-swap e integrità file

- Le mutazioni su file esistenti richiedono la versione letta in precedenza (`fileVersionEvidence.ts`, massimo 64 hash per sessione).
- Se un file subisce modifiche concorrenti esterne sul disco, la scrittura viene respinta finché non viene rieseguita una lettura aggiornata.
- Gli script runtime temporanei `.onlyrag` vengono esclusi dall'anteprima diff e dalla pubblicazione.

## Sicurezza comandi e filesystem

- **Git distruttivo bloccato**: comandi quali `reset --hard`, `clean -f`, ripristini globali (`checkout -- .`), force-push e cancellazioni branch sono intercettati e rifiutati alla radice ([`commandSecurity.ts`](../electron/core/domain/agent/commandSecurity.ts)).
- **Confinamento path**: risoluzione rigorosa di realpath; symlink e junction puntanti all'esterno del workspace attivo sono bloccati. I path relativi dei comandi si risolvono nella directory corrente della shell persistente, che conserva i `cd` fra un comando e l'altro e dentro lo stesso comando ([`structuredCommandSafety.ts`](../electron/core/domain/agent/structuredCommandSafety.ts)).
- **Rete e pacchetti**: operazioni di rete, installazione di dipendenze e commit richiedono conferma esplicita dell'utente. `npx` di un comando che non è in `node_modules/.bin` conta come rete, perché npx lo scaricherebbe; così `pnpm dlx`, `yarn dlx` e `bunx` ([`offlineStrictPolicy.ts`](../electron/core/domain/agent/offlineStrictPolicy.ts)).
