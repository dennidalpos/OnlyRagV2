# Guardrail e budget di progresso

I guardrail garantiscono la sicurezza dell'ambiente locale, la coerenza delle modifiche concorrenti e l'interruzione rapida di cicli o stati di stallo.

## Politica di progresso (`agentProgressPolicy.ts`)

[`agentProgressPolicy.ts`](../electron/core/domain/agent/agentProgressPolicy.ts) è l'autorità centrale sul non-progresso della sessione. Gestisce una tabella unificata `PROGRESS_BUDGET`, mentre [`loopDetector.ts`](../electron/core/domain/agent/loopDetector.ts) classifica i pattern di esecuzione.

| Evento | Soglia | Esito |
| --- | --- | --- |
| Risposta in sola prosa con lavoro aperto | 2 richieste di tool | Chiusura con `model_silence` |
| Chiamata tool non conforme allo schema | 1 correzione | Chiusura con `schema_budget` |
| Errore di esecuzione del tool | 1 correzione (azzerata da modifica riuscita o comando andato a buon fine) | Chiusura con `execution_budget` |
| `run_command`/`run_tests` fallito riproposto identico | Blocco immediato (non consuma budget esecuzione) | Trattato come blocco di loop (`loop_unchanged_failure`) |
| Ripetizione di azione già riuscita | 3 avvisi `redundant_success` | Conteggiato come blocco di loop |
| Blocco di loop | 2 avvisi, poi 1 blocco su 2 forza l'avanzamento milestone (`force_advance`) | A 20 blocchi senza budget step: arresto `stagnation_abort` |
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

## Compare-and-swap e integrità file

- Le mutazioni su file esistenti richiedono la versione letta in precedenza (`fileVersionEvidence.ts`, massimo 64 hash per sessione).
- Se un file subisce modifiche concorrenti esterne sul disco, la scrittura viene respinta finché non viene rieseguita una lettura aggiornata.
- Gli script runtime temporanei `.onlyrag` vengono esclusi dall'anteprima diff e dalla pubblicazione.

## Sicurezza comandi e filesystem

- **Git distruttivo bloccato**: comandi quali `reset --hard`, `clean -f`, ripristini globali (`checkout -- .`), force-push e cancellazioni branch sono intercettati e rifiutati alla radice ([`commandSecurity.ts`](../electron/core/domain/agent/commandSecurity.ts)).
- **Confinamento path**: risoluzione rigorosa di realpath; symlink e junction puntanti all'esterno del workspace attivo sono bloccati.
- **Rete e pacchetti**: operazioni di rete, installazione di dipendenze e commit richiedono conferma esplicita dell'utente.
