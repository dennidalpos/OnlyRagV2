# Verifica e limiti noti

## Ordine rapido

```powershell
npm run docs:check
npm run test:fast
```

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
- `npm run test:e2e:electron` compila l'app, avvia Electron con profilo temporaneo e attraversa preload, IPC, Main e filesystem. Copre cambio progetto/sessione, coda, annullamento nelle fasi `collect_context`, `propose_action`, `apply_action` e `verify`, ripresa dopo crash, Git sporco, salvataggi editor obsoleti, modello mancante, artefatti standalone, path con spazi e fughe symlink/junction. Quattro scenari aggiuntivi pilotano i guard con risposte deterministiche (solo prosa, stessa chiamata rifiutata, stessa scrittura ripetuta, scritture senza modifiche) e verificano il guard che ferma la run (`model_silence`, `execution_budget`, `step_budget`, `no_mutation`); lo script stampa per ogni run i guard scattati e verifica che gli 8 scenari di affidabilità non ne registrino nessuno. Usa un server Ollama locale deterministico; non qualifica un modello reale.
- `npm run test:e2e:settings-bootstrap` verifica con `userData` e `appData` isolati e con l'handler reale che `settings.json` prevalga sulle chiavi legacy, che un file illeggibile mostri l'avviso recuperabile senza essere sovrascritto né avviare diagnostica o wizard, e che «Riprova» completi il caricamento. Con un handler rallentato verifica che la diagnostica attenda le impostazioni; verifica inoltre la migrazione one-shot di modello, lingua e wizard e che le scritture ravvicinate vengano accorpate e serializzate.
- `npm run test:e2e:cold-start` avvia il bundle Electron tramite un bootstrap di audit con profilo isolato. Prima del caricamento del Main intercetta e blocca richieste esterne tramite Node HTTP/fetch, Electron net e Chromium; copre la prima finestra e il rimontaggio del Renderer. Verifica anche che l'editor resti caricato su richiesta. La diagnostica con impostazioni locali interroga gli endpoint locali predefiniti; controlli aggiornamenti modello e Skill Hub partono da azioni utente.
- `npm run test:e2e:bundle-ux` compila e apre Electron con profilo isolato. Controlla che HTML iniziale e richieste della vista Ingestion non carichino Monaco o tokenizer, visita cinque schede e apre wizard e configuratore prompt a 1024×700 e 1400×900. Verifica i limiti dei pannelli, la comparsa dell'editor e il caricamento del tokenizer solo dopo l'apertura del configuratore. Le schermate sono temporanee; per conservarle impostare `ONLYRAG_E2E_SCREENSHOT_DIR`.
- `npm run test:e2e:sidecar-ownership` usa processi Windows reali sulla porta 8000: un listener sconosciuto resta intatto, un marker con PID riutilizzato viene respinto e un processo con identità esatta viene recuperato. Ripete il recupero con `sidecar_dist/sidecar/sidecar.exe` e dati temporanei. Richiede la porta libera e il binario già compilato.
- `npm run test:live` usa Ollama reale e workspace isolati; richiede il runtime locale e non fa parte del test rapido. Il report di ogni scenario riporta i guard scattati e quello che ha chiuso la run.
- I test live qualificano uno scenario e un modello specifici: non implicano autonomia generale del coding agent.

## Limiti da non nascondere

- Il fallback testuale dei tool e `/api/generate` restano compatibilità per modelli che non emettono `tool_calls`.
- L'offload CPU può aumentare la latenza per modelli oltre la VRAM disponibile.
- Le prove su Ollama dipendono da versione, modelli installati, hardware e stato del daemon.
- Una verifica non disponibile non equivale a una verifica superata; il sistema conserva esiti distinti.
- Al ripristino di una sessione, le prove persistite vengono rivalidate. Un `verificationCommand` che modifica il workspace viene rifiutato senza essere eseguito e la milestone non passa a `verified`.

Per i contratti da verificare consultare [`api-ipc.md`](./api-ipc.md), [`api-rest.md`](./api-rest.md) e [`PROJECT_STATUS.json`](../PROJECT_STATUS.json).
