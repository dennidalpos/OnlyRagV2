# Audit del Coding Agent (2026-09-26)

Audit critico dell'agente di coding (Electron Main + Ollama `/api/chat` con tool nativi), condotto su codice, log delle run live, telemetria Ollama e documentazione ufficiale. Obiettivo: un orchestratore indipendente dal modello che chiuda task reali con qwen3-coder:30b (MoE) e qwen3.8:27b (denso).

## Sintesi

Prima dell'audit l'agente non chiudeva i task reali. Nell'ultima run live con qwen3.8:27b si è fermato allo step 23/50 dopo 60 minuti, con 0/8 milestone verificate. La causa principale non era il modello ma l'harness:

- il prompt cambiava a ogni turno, quindi Ollama rivalutava tutto il contesto (circa 20 dei 50 minuti);
- il modello non riceveva il motivo di rifiuti ed esiti;
- direttive "MUST" in conflitto fra loro e con la policy di rete;
- una copia temporanea del workspace senza `node_modules` né piano approvato;
- difetti nei tool (sostituzioni con `$`, hash di versione affidato al modello, controllo dei comandi).

## Evidenze e correzioni

| # | Difetto | Evidenza | Correzione |
|---|---|---|---|
| E1 | Prompt di sistema diverso a ogni turno | Step, piano e mappa dentro `messages[0]`; 91 s di prompt eval per 13.343 token allo step 22 | Messaggio `system` fisso per sessione, task come primo `user`, contesto del turno in un `user` finale effimero ([`agentChatTranscript.ts`](../electron/core/application/agentChatTranscript.ts)) |
| E2 | Campionamento forzato (temp 0.1, top_p 0.9, repeat 1.1) | `hardwareProfileResolver.ts` | Default del Modelfile; override facoltativo per modello (`modelSamplingOverrides`) |
| E3 | `num_thread` = thread logici − 1 (15 su 8 core) | idem | Non inviato: Ollama usa i core fisici |
| E4 | Stop sequence del protocollo testuale sul percorso nativo | idem | Rimosse |
| E5 | Thinking solo booleano, livelli dedotti dalla famiglia | `ollamaThinkingPolicy.ts` | Livelli da `/api/show`; default del modello; selettore di livello nella UI |
| E6 | Rifiuti restituiti come "Tool call denied by policy or user." | Run live: web_search e due `npm install` | Ogni rifiuto e ogni esito arrivano come messaggio `tool` con il motivo |
| E7 | Istruzioni "emetti un blocco JSON" in modalità nativa | `agentPromptAssembler.ts`, `ollamaToolSchemaCatalog.ts`, `loopDetector.ts` | Correzioni native; il JSON nella prosa non conta più come tentativo fallito |
| E8 | Direttive in conflitto | "NON installare" e "INSTALLA ORA" nello stesso turno; la guardia milestone puniva la modifica ordinata | Avvisi consultivi; l'arbitro conosce la policy; catalogo tool filtrato dalla policy |
| E9 | Hash di versione affidato al modello | Hash inventato `sha256:9e7b0d…`; lettura parziale autorizzava la riscrittura | Versioni gestite solo dall'app; `write_file` richiede una lettura completa |
| E10 | `String.replace` interpretava `$&`, `$'`, `$$` | `versionedFileMutation.ts` | Sostituzione letterale |
| E11 | Copia temporanea senza `node_modules` e `.onlyrag` | `disposableAgentWorkspace.ts` | Esecuzione in place con checkpoint ripristinabili |
| E12 | Policy predefinita `offline-strict` in conflitto con prompt e piano | `appSettingsDefaults.ts` | Default `network-approved` (consenso per azione); in offline i tool di rete spariscono e le regole del prompt si adeguano |
| E13 | Timeout e annullamento annullavano tutto il lavoro; il timeout non notificava la UI | `agentOrchestratorSessionWatchdog.ts` | Lavoro conservato, checkpoint, notifica corretta |
| E14 | Controllo comandi: rifiutava `&&`, `2>&1`, `$env:`; lasciava passare redirect, alias, `cmd /c`, `git -C` | `structuredCommandSafety.ts` | Parser riscritto: separatori e redirect gestiti, alias di scrittura, codice inline con approvazione, `git -C` e `cd` confinati |
| E15 | Shell in codepage OEM | `persistentPowerShellSession.ts` | Output UTF-8, `StringDecoder`, comandi non ASCII trasportati in base64 |
| E16 | Un timeout o un falso prompt chiudeva la run | `agentOrchestratorToolResultProcessor.ts` | Errore restituito al modello; prompt riconosciuto solo sull'ultima riga dopo 1,5 s di silenzio |
| E17 | Skill interne di OnlyRag nel prompt dei progetti utente | `skillRepository.ts` leggeva `process.cwd()/skills` senza Electron | Store headless in `userdata_dev/skills` |
| E18 | Budget di output ridotto a ~1k token; `done_reason=length` come errore di trasporto | `agentOrchestratorTurnDispatch.ts` | Riserva di output reale; troncamento restituito al modello |
| E19 | Limite fisso di 5 minuti di silenzio sullo stream | Ollama non trasmette una tool call finché non è completa: a 3,95 token/s una scrittura di 1193 token è stata interrotta due volte (run del 2026-09-26) | Limite proporzionale alla velocità misurata nella sessione (5-30 minuti) |
| E20 | `num_ctx` dipendente da GPU in cache e RAM nominale | 31,9 GB riportati su un host da 32 GB e cache GPU vuota prima della diagnostica: 16384 token | Soglia a 30 GB e rilevamento GPU prima del primo turno |

Altre correzioni:

- Budget di esecuzione: 3 errori identici o 6 consecutivi (prima 2 qualsiasi).
- Loop detector: una verifica ripetuta dopo una modifica riuscita non è una ripetizione.
- Domande bloccanti reali in AUTO (rete, credenziali, dopo un rifiuto) passano all'utente.
- Letture: numero di righe sempre dichiarato; confinamento realpath su tutti i tool di lettura.
- `grep_search`: niente file segreti, errori di regex dichiarati.
- JSONC accettato per `tsconfig`/`.vscode`/devcontainer.
- Errori di `replace` con la riga più vicina.
- Rilevamento dei dev server e dei watcher corretto (`--watch=false`, `tsc -w`, `vite --port`, `uvicorn`, `dotnet run`).
- `.onlyrag/` si auto-esclude da Git.

## Hardware e modelli

L'host ha una RTX 2070 con 8 GB di VRAM e 32 GB di RAM. qwen3.8:27b è denso (Q4_K_M, 17 GB) e gira per circa il 75% su CPU: 2,4 token/s misurati in generazione. qwen3-coder:30b è MoE con circa 3B parametri attivi, quindi in offload la generazione è molto più rapida. L'orchestratore resta indipendente dal modello; per questo hardware qwen3-coder:30b è il riferimento pratico.

## Fonti

- Ollama: [Chat API](https://docs.ollama.com/api/chat), [Tool calling](https://docs.ollama.com/capabilities/tool-calling), [Thinking](https://docs.ollama.com/capabilities/thinking), [Context length](https://docs.ollama.com/context-length), [FAQ](https://docs.ollama.com/faq), [`server/prompt.go`](https://github.com/ollama/ollama/blob/main/server/prompt.go), [runner cache](https://pkg.go.dev/github.com/ollama/ollama/runner/ollamarunner).
- Qwen: [Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B), [Qwen3-32B best practices](https://huggingface.co/Qwen/Qwen3-32B), [function calling](https://qwen.readthedocs.io/en/latest/framework/function_call.html), [Unsloth Qwen3.8](https://unsloth.ai/docs/models/qwen3.8).
- Anthropic Engineering: [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents), [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents), [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).
- [SWE-agent](https://arxiv.org/abs/2405.15793), [mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent), [Aider edit formats](https://aider.chat/docs/more/edit-formats.html), [llama.cpp `--threads`](https://github.com/ggml-org/llama.cpp/blob/master/tools/completion/README.md).

## Verifica

- `npm run typecheck`, `npm run quality:static`, `npm run audit:deadcode`, `npm run audit:cycles`, `npm run docs:check`: superati.
- `npm run test:fast`: 276 file, 2239 test superati.
- `npm run test:e2e:electron`: 8 scenari di affidabilità e 9 guardie superati.
- Run live: vedi la sezione successiva.

## Run live

Task `fullTaskRun.live.ts` (React + Tailwind "Project Dashboard Task"), stesso host.

| Run | Modello | Esito | Step | Tempo | Prompt eval mediano per turno | Step mediano |
|---|---|---|---|---|---|---|
| 2026-09-25 (prima dell'audit) | qwen3.8:27b | fermata dal limite di Vitest, 0/8 verificate | 23/50 | 60 min | 57,9 s | 128 s |
| 2026-09-26 b | qwen3-coder:30b | `transport_budget` (stallo di 5 min, vedi E19), 0/8 | 29/50 | 28 min | 4,6 s | 15 s |
| 2026-09-26 c | qwen3-coder:30b | **`verified`, 8/8 milestone** | 37/50 | 53 min | 5,0 s | 21 s |
| 2026-09-26 rerun-e | qwen3.8:27b | `step_budget` a 25 step (harness sui default, vedi sotto), 0/7 | 25/25 | 128 min | 9,1 s | circa 5 min (media) |
| 2026-09-26 thinklow-g | qwen3.8:27b, thinking `low` | limite di sessione di 180 min, 0/8 | 10/50 | 180 min | 10,4 s | un turno da 159 min (vedi sotto) |
| 2026-09-27 tracker-20260927 | qwen3.8:27b, thinking disattivato | 8/8 milestone, build e test superati; chiusura `blocked` per due timeout iniziali da 10 min al turno finale | 42/50 | 135 min | da snapshot | singole generazioni fino a circa 22 min |
| 2026-09-27 closure-20260927 | qwen3.8:27b, thinking disattivato | `transport_budget`, 0/8 milestone; build fallita durante la run, poi due timeout iniziali da 10 min | 26/50 | 70 min | da snapshot | un turno da circa 8,5 min prima dei timeout |

Nella run c le installazioni sono state approvate ed eseguite, e il ciclo modifica → build (tre build fallite, poi riuscita) si è svolto senza blocchi del loop detector. Le guardie scattate sono solo avvisi `execution_budget`.

Snapshot: `%USERPROFILE%\OnlyRag-Live\snapshots\*audit-20260926c*`.

La run qwen3.8:27b rerun-e (snapshot `*rerun-20260926e*`, con `session_state.json` e telemetria per turno) conferma il riuso della cache con la trascrizione append-only: dopo il primo turno a freddo (5244 token in 42,7 s) ogni turno valuta solo i token aggiunti, 8–12 s anche con 21704 token di prompt. Il collo di bottiglia è la generazione: circa 2 token/s all'83% su CPU (3,8 GB su 22 GB in VRAM con `num_ctx` 65536), fino a 32 minuti per un turno da 3874 token, 7 generazioni in 128 minuti. La run si è fermata a 25 step perché `loadRealSettings` spargeva l'envelope `{ version, settings }` di `settings.json` invece di decodificarlo e usava quindi i default: corretto con `decodeSettingsFile`.

La run thinklow-g (snapshot `*thinklow-20260926g*`) usa le impostazioni dell'utente: thinking `low`, 50 step, `num_ctx` 65536. Il piano (8 milestone) arriva in circa 6 minuti, senza il timeout della generazione strutturata, perché ora riceve il livello scelto e non `true`. Nei turni 1-4 il livello basso tiene corto il ragionamento: fra 124 e 2320 caratteri di thinking, fra 94 e 745 token generati. Il turno 5, però, scrive sei file in una sola risposta e genera 16915 token a 1,77 token/s, quasi tutti ragionamento (47683 caratteri), in 159 minuti. Quel solo turno occupa l'88% della sessione, che si chiude al limite di 180 minuti allo step 10/50 con i soli file di scaffold. Né `num_predict` né il limite di silenzio dello stream fermano un ragionamento così lungo, perché i token di thinking mantengono vivo lo stream. Il seguito è in `PROJECT_STATUS.json` (QWEN38-FULLTASK-01, AGENT-THINKING-RUNAWAY-01).

La run tracker-20260927 ha prodotto un'app che supera `npx tsc --noEmit`, `npm run build` e `npm test` (2 test); tutte le 8 milestone sono state verificate. La chiusura è fallita perché il ciclo ha chiesto al modello un altro turno dopo l'ultima verifica. Due attese della prima risposta di 10 minuti hanno esaurito il budget di recupero del trasporto. L'applicazione ora chiude direttamente dal gate di evidenza quando il piano è verificato e non ci sono chiamate tool pendenti. Il test di regressione dell'orchestratore conferma che non viene richiesta un'altra generazione; una nuova run completa resta necessaria per qualificare qwen3.8:27b. La stessa prova ha mostrato che `SESSION_TRACKER.md` veniva scritto ma, dopo il primo turno, non entrava nel prompt perché il messaggio di sistema era congelato. Il tracker dei turni `focus` è stato spostato nel contesto variabile e coperto da un test di integrazione; la conferma live resta aperta.

La run closure-20260927 ha esercitato il codice aggiornato ma non la chiusura automatica: nessuna delle 8 milestone è arrivata a `verified`. Dopo un fallimento di `npm run build`, al passo 26 due richieste consecutive sono scadute prima della prima risposta di Ollama (10 minuti ciascuna), chiudendo la sessione su `transport_budget`. Il modello aveva comunque scritto 14 file nel workspace isolato. Il tracker formato 2 risultava aggiornato, ma `completed_tasks` era vuoto: questa prova non dimostra ancora l'uso di sezioni mutate nei turni successivi. Lo snapshot `*closure-20260927*` conserva metriche, audit e workspace.

L'analisi del log locale di Ollama del 2026-09-27 mostra che le richieste finite alle 15:09, 15:19, 18:14 e 18:24 (ora locale) erano in generazione attiva fino alla cancellazione del client: Ollama segnava circa 0,9-1,7 token/s, non un caricamento bloccato. Nel secondo run una richiesta aveva già generato 1008 token prima del timeout iniziale di 10 minuti, senza inviare gli header della tool call. Il limite iniziale fisso era più corto del limite adattivo di silenzio (30 minuti su questa macchina). `agentStreamTransport` ora usa almeno 10 minuti e il limite adattivo, se maggiore, anche prima degli header; il messaggio di errore non attribuisce più il ritardo al caricamento. Test mirato del trasporto e dell'orchestratore: 52/52. La correzione richiede ancora una prova live completa per la qualifica del modello.
