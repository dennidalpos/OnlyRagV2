# Verifica e limiti noti

## Ordine rapido

```powershell
npm run docs:check
npm run test:fast
```

Il test rapido gira su ogni sistema: i test sui path usano path nativi dell'host (`path.join` sulla radice di `process.cwd()`, `vi.stubEnv` per `ProgramFiles` e `SystemRoot`) e quelli che dipendono dall'hardware simulano `hardwareProbe`. Solo i casi che avviano un vero `powershell.exe` (`itWithPowerShell`, cioè `it.skipIf(process.platform !== 'win32')`) risultano `skipped` fuori da Windows; gli script E2E Electron avviano `electron.exe` e girano solo su Windows.

Se fallisce il test rapido, usare il target indicato:

```powershell
npx vitest run <path>
```

Per il Sidecar: `npm run test:sidecar`. Per tipi e confini: `npm run typecheck`, `npm run audit:cycles` e `npm run audit:deadcode`.

L'audit dead code esclude `electron-builder`: non e importato dal codice TypeScript, ma viene eseguito con `npx --no-install` dalla pipeline PowerShell `package:win`.

Per gli scenari Agent Coding attraverso il bundle Electron reale:

```powershell
npm run test:e2e:electron
```

## Verifiche native

- `npm run test:smoke` controlla l'avvio del bundle Electron e la registrazione IPC.
- `npm run test:e2e:electron` compila l'app, avvia Electron con profilo temporaneo e attraversa preload, IPC, Main e filesystem. Copre cambio progetto/sessione, coda, annullamento nelle fasi `collect_context`, `propose_action`, `apply_action` e `verify`, ripresa dopo crash, Git sporco, salvataggi editor obsoleti, modello mancante, artefatti standalone, path con spazi e fughe symlink/junction. Nove scenari aggiuntivi pilotano i guard con risposte deterministiche: solo prosa, stessa chiamata rifiutata, stessa scrittura ripetuta e scritture senza modifiche verificano il guard che ferma la run (`model_silence`, `execution_budget`, `step_budget`, `no_mutation`); letture a fette dello stesso file, un file riportato a contenuti precedenti, un loop senza budget di passi e un controllo di progetto che fallisce a ogni `finish` verificano i guard che nei run live non erano mai scattati (`loop_same_target_reads`, `fs_oscillation`, `stagnation_abort`, `verification_fix_cycles`); tool strutturati passati a `run_command` verificano che ogni chiamata sia rifiutata da `TOOL_AS_SHELL_BLOCK` e conti per `execution_budget`; lo script stampa per ogni run i guard scattati e verifica che gli 8 scenari di affidabilità non ne registrino nessuno. Usa un server Ollama locale deterministico; non qualifica un modello reale.
- `npm run test:e2e:settings-bootstrap` verifica con `userData` e `appData` isolati e con l'handler reale che il `settings.json` versionato venga caricato senza wizard, che un file senza versione o illeggibile mostri l'avviso recuperabile senza essere sovrascritto né avviare diagnostica o wizard, e che «Riprova» completi il caricamento. Con un handler rallentato verifica che la diagnostica attenda le impostazioni, e che le scritture ravvicinate vengano accorpate e serializzate.
- `npm run test:e2e:cold-start` avvia il bundle Electron tramite un bootstrap di audit con profilo isolato. Prima del caricamento del Main intercetta e blocca richieste esterne tramite Node HTTP/fetch, Electron net e Chromium; copre la prima finestra e il rimontaggio del Renderer. Verifica anche che l'editor resti caricato su richiesta. La diagnostica con impostazioni locali interroga gli endpoint locali predefiniti; controlli aggiornamenti modello e Skill Hub partono da azioni utente.
- `npm run test:e2e:bundle-ux` compila e apre Electron con profilo isolato. Controlla che HTML iniziale e richieste della vista Ingestion non carichino Monaco o tokenizer, visita cinque schede e apre wizard e configuratore prompt a 1024×700 e 1400×900. Verifica i limiti dei pannelli, la comparsa dell'editor e il caricamento del tokenizer solo dopo l'apertura del configuratore. Le schermate sono temporanee; per conservarle impostare `ONLYRAG_E2E_SCREENSHOT_DIR`.
- `npm run test:e2e:ingest-translate` compila e apre Electron con profilo isolato, avvia il Sidecar di sviluppo (`.venv`) con lo stesso percorso di un avvio normale e, dalla UI, ingerisce e traduce con layout un PDF di 8 pagine generato al volo. Verifica che Main accetti il proprio Sidecar, che gli eventi di progresso arrivino validati con il loro task id (uno per pagina, in ordine), che la barra di traduzione avanzi e che il PDF tradotto venga scritto. Richiede Ollama con i modelli di embedding e traduzione di `settings.json` reale e la porta `:8000` libera.
- `npm run test:e2e:sidecar-ownership` usa processi Windows reali sulla porta 8000: un listener sconosciuto resta intatto, un marker con PID riutilizzato viene respinto e un processo con identità esatta viene recuperato. Ripete il recupero con `sidecar_dist/sidecar/sidecar.exe` e dati temporanei. Richiede la porta libera e il binario già compilato.
- `npm run test:live` usa Ollama reale e workspace isolati; richiede il runtime locale e non fa parte del test rapido. Il report di ogni scenario riporta i guard scattati e quello che ha chiuso la run. Workspace e snapshot stanno in un'unica cartella dedicata, `%USERPROFILE%\OnlyRag-Live` (sovrascrivibile con `ONLYRAG_LIVE_ROOT`; `liveWorkspacePath` in [`agentLiveHarness.ts`](../scripts/live/agentLiveHarness.ts)), mai sparsi sul Desktop; i workspace non più necessari si eliminano dopo la prova. Le run live abilitano i payload del log di audit (`includeCodingAgentDebugPayloads`), così lo snapshot mostra file e prompt e non solo gli hash. Solo nelle run live `CodingAgentLogger.mirrorUnredactedTo` scrive anche `audit\coding_agent_audit.unredacted.log` dentro la cartella live: stesse voci senza credenziali, ma con percorsi, URL e testo degli errori del runner (che il log dell'app sostituisce con `[details redacted]`); ogni snapshot lo sposta in `coding_agent_audit.unredacted.log` e lo riparte vuoto. I log persistiti dall'app restano redatti.
- La prova completa `fullTaskRun.live.ts` usa come riferimento `qwen3.8:27b` sull'hardware Windows disponibile; `ONLYRAG_LIVE_MODEL` permette una diagnosi esplicita con un altro modello. Il timeout della sessione e quello di Vitest sono entrambi di 180 minuti. Il probe si comporta come un utente della policy `network-approved`: approva le richieste motivate da accesso di rete o modifica confinata del workspace (installazioni con qualsiasi flag, ricerca web) e respinge installazioni di tool di sistema e commit. La qualifica richiede la chiusura verificata del task e milestone provate, senza soglia di velocità: l'offload su RAM e CPU è previsto.
- Il tentativo del 2026-09-25 con `qwen3.8:27b` si è interrotto al vecchio timeout Vitest di 60 minuti, al passo 23/50, prima del report finale: non qualifica il modello. Workspace e log sono conservati in `%USERPROFILE%\OnlyRag-Live`; l'esito e la ripresa sono nel tracker. La run del 2026-09-26 (rerun-e) ha confermato il riuso della cache ma si è fermata a 25 step: l'harness leggeva `settings.json` senza decodificarne l'envelope versionato e ricadeva sui default; `loadRealSettings` ora usa `decodeSettingsFile` dell'app. Esito completo in [coding-agent-audit-2026-09-26.md](./coding-agent-audit-2026-09-26.md#run-live).
- I test live qualificano uno scenario e un modello specifici: non implicano autonomia generale del coding agent.
- `gptOssThinking.live.ts` si salta da solo se nessun modello `gpt-oss*` è installato; altrimenti verifica classificazione `level-only`, assenza dell'interruttore Thinking in Settings e separazione del ragionamento con `think: false`.
- Le run Qwen 2.5 e GPT-OSS precedenti sono diagnosi storiche, documentate in [`agent-diagnostics.md`](./agent-diagnostics.md). Non qualificano il nuovo percorso con trascrizione nativa. I relativi workspace restano da pulire; gli snapshot di audit sono conservati.

## Limiti da non nascondere

- Agent Coding parla con Ollama solo via `/api/chat` con tool nativi: non esiste un fallback testuale, e un modello senza capacità `tools` è rifiutato dal preflight.
- L'offload CPU può aumentare la latenza per modelli oltre la VRAM disponibile.
- Le prove su Ollama dipendono da versione, modelli installati, hardware e stato del daemon.
- Una verifica non disponibile non equivale a una verifica superata; il sistema conserva esiti distinti.
- Build, typecheck e lint sono prova strutturale: la chiusura è `verified` solo con un test che passa. Uno script `test` segue gli import dei file di test come un bundler segue quelli dell'entry, quindi è classificato `entry-reachable` (`coverageOfScript` in [`projectVerificationResolver.ts`](../electron/core/domain/agent/projectVerificationResolver.ts)): con `build` e `test` dichiarati il controllo primario resta la build, e `npm test` la segue. Per questo un piano greenfield JavaScript/TypeScript (web React/Vite o Node) termina con una milestone di smoke test comportamentale ([`greenfieldScaffoldResolver.ts`](../electron/core/domain/agent/greenfieldScaffoldResolver.ts), `placement: 'end'`): per React un `src/App.test.jsx`/`.tsx` che rende `App` con `react-dom/server` ed è eseguito una volta dallo script `test` (`vitest run`). Python e Rust restano con controlli strutturali (`compileall`, `cargo check`). Quando il file di test è su disco, l'arbitro delle direttive ([`behaviorTestDirective.ts`](../electron/core/domain/agent/behaviorTestDirective.ts)) ordina nell'ordine: installare il runner mancante (`behavior_test_runner_missing`, `npm install --save-dev vitest`), scrivere lo script `test` in `package.json` (`behavior_test_script_missing`; il segnaposto di `npm init` non conta), e, dopo la build verde, eseguire `npm test` (`verification_due`). Un `npm test`/`npm run test` riuscito vale come verifica anche quando lo script `test` non è il controllo primario, e promuove le milestone comportamentali.
- Al ripristino di una sessione, le prove persistite vengono rivalidate. Un `verificationCommand` che modifica il workspace viene rifiutato senza essere eseguito e la milestone non passa a `verified`.

Per i contratti da verificare consultare [`api-ipc.md`](./api-ipc.md), [`api-rest.md`](./api-rest.md) e [`PROJECT_STATUS.json`](../PROJECT_STATUS.json).
