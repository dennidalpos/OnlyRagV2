# Qualifica Live Autonomous Coding Agent

Rapporto CAS-23 del 2026-09-09. Le prove usano Ollama 0.33.3, Node.js 24.20.0, npm 11.19.0 e workspace separati. Il task greenfield React/Tailwind è identico tra i modelli; la policy UI salta l'intervista quando la richiesta è chiara.

## Metodo

- Modelli installati: `qwen2.5-coder:1.5b`, `qwen2.5-coder:3b`, `qwen2.5-coder:7b`.
- Due processi per modello, etichettati cold/warm; prima del cold il modello viene scaricato.
- Runtime persistito: digest, opzioni, `num_ctx`, tempi/token e memoria osservata da `/api/ps`.
- Criterio di successo: milestone verificata dall'applicazione e chiusura terminale coerente, non testo del modello.
- Baseline storica CAS-01: 12/13 milestone. Le run CAS-23 usano il flusso e i guardrail correnti.

Comando per una singola matrice:

```powershell
$env:ONLYRAG_LIVE_MODEL = 'qwen2.5-coder:7b'
$env:ONLYRAG_LIVE_RUN = 'cold-2'
npx vitest run --config vitest.live.config.mts -t "full task"
```

Gli snapshot sono salvati fuori dal repository in `%USERPROFILE%\Desktop\onlyrag_live_snapshots\<timestamp>_<sessione>_<label>`; ogni nuova run contiene `metrics.json` insieme ai log di audit.

## Risultati corretti

| Modello/run | Verificate | Chiusura | Tool falliti/totali | Inferenza ms | Load prima/dopo ms | Token prompt/output | GPU MiB |
| :--- | ---: | :--- | ---: | ---: | ---: | ---: | ---: |
| 1.5B cold-2 | 0/11 | mancante | 9/10 | 13289 | 2819/57 | 34683/1080 | 1537.7 |
| 1.5B warm-2 | 0/10 | mancante | 2/2 | 4703 | 3064/12 | 9496/104 | 1537.7 |
| 3B cold-2 | 0/3 | blocked | 2/6 | 18982 | 6814/35 | 18525/825 | 2595.8 |
| 3B warm-2 | 0/9 | blocked | 4/9 | 23396 | 6816/53 | 30417/1005 | 2595.8 |
| 7B cold-2 | 0/7 | blocked | 2/4 | 23432 | 4624/17 | 11596/879 | 5212.1 |
| 7B warm-2 | 0/7 | blocked | 3/8 | 33089 | 4123/38 | 24371/1158 | 5212.1 |

Tutte le run hanno usato `num_ctx=16384`, hanno osservato zero CPU offload e il digest registrato. Le etichette warm identificano il secondo processo, ma la prima generazione ha comunque pagato il caricamento; le generazioni successive mostrano 12-57 ms complessivi di load. La tabella separa quindi il caricamento osservato dall'inferenza, senza presumere una cache calda.

La suite live preesistente, eseguita con `npm run test:live`, ha superato 4 casi su 10: budget exhaustion, ERESOLVE, workspace pre-seeded e un caso di downgrade. Sono falliti full task, il secondo contratto downgrade, tre recuperi TypeScript e uninstallable dependency. Il probe intervista successivo ha fallito allo stesso modo su 1.5B e 3B: zero domande per una scelta esplicita; il 7B non è stato eseguito dopo due fallimenti consecutivi.

## Ambito supportato

- Nessuno dei tre modelli è qualificato per autonomia greenfield multi-file.
- 7B è adatto a Ask/Plan e a modifiche piccole supervisionate; 1.5B e 3B non sono affidabili nell'intervista esplicita.
- Sono qualificati i guardrail deterministici: stop sicuro, profilo runtime fisso, serializzazione, esiti tool strutturati, sanitizzazione del piano e controllo registry sui range non pubblicati.
- L'autorità delle prove è stata corretta in W2.12. W2.13-W2.15 hanno poi qualificato recupero dopo conflitto versione, fallback dell'intervista e persistenza terminale.

Il fallimento più frequente è la ripetizione di `write_file` senza `FILE VERSION`; altri casi includono JSON tool malformato e JSX in `.js`, correttamente respinto dal controllo AST. Una run precedente aveva promosso erroneamente una milestone dopo il solo `npm install`; W2.12 ora richiede un controllo risolto dal profilo e rifiuta install/add come prova. Nessuna run ha dichiarato successo globale falso.

W2.13 ora conserva l'hash dell'ultima `read_file` riuscita e lo applica una sola volta all'edit immediatamente successivo dello stesso file. Il compare finale resta invariato: una modifica esterna tra lettura e scrittura viene ancora rifiutata dal test deterministico. Un nuovo conflitto azzera inoltre soltanto lo storico del target nel loop detector, consentendo la rilettura imposta.

Le prove live TS2305, TS2613 e TS2614 del 9 settembre seguono conflitto → lettura → edit riuscito, correggono l'import e concludono con `npm run build` verde e milestone 1/1. La suite distingue correttamente la consegna strutturale dalla prova comportamentale: `completionStatus=unverifiable` e `success=false`, con esportatore e manifest invariati.

Le regressioni downgrade ed ERESOLVE verificano traiettoria dei comandi, assenza di flag forzati, versioni installate e integrità dei manifest. Un rifiuto preventivo resta un esito tool `FAILURE` confermato: il successo del guard è provato dagli invarianti del workspace, non falsificando l'esito del comando richiesto. Il probe ERESOLVE fissa esplicitamente `qwen2.5-coder:7b`, evitando modelli embedding-only presenti nelle impostazioni utente.

Il fallback per alternative esplicite è qualificato live su `qwen2.5-coder:1.5b`, `3b` e `7b`: dalla richiesta vengono estratte le due opzioni, la risposta libera viene validata e la decisione entra nel piano. Nei piani nuovi vengono eliminati riferimenti inventati a interventi precedenti; sui resume resta obbligatoria la riconciliazione completa. La run greenfield 1.5B resta sotto la soglia funzionale (0/13), ma ora termina con `blocked`, motivo e residui persistiti invece di lasciare `completionStatus` vuoto.

## CAS-29: qwen3-coder 30B native-tool qualification

Il 10 settembre 2026, `qwen3-coder:30b` (digest `06c1097e...e90bca`, `num_ctx=16384`) ha eseguito lo scenario completo su Windows:

| Run | Milestone verificate | Chiusura | Step | Tool falliti/bloccati |
| :--- | ---: | :--- | ---: | ---: |
| cold-1 | 0/7 | `blocked` | 26/999 | 17/27 |
| warm-1 | 0/7 | `blocked` | 11/999 | 8/11 |

La run cold ha alternato `dir` valido con `ls -la` non portabile e poi ha richiesto un file assente; la warm ha fallito `npm create vite` e ha ripetuto la lettura di `src/main.jsx` assente. Entrambe hanno esposto residui e chiuso tramite circuit breaker, senza promuovere milestone né dichiarare successo.

Questo scenario misura il risultato applicativo, ma non prova che ogni chiamata usi `message.tool_calls` strutturato né esercita annullamento e chiusura applicativa.

### Qualifica CAS-29 e CAS-30 del 10 settembre 2026

Il preflight ha osservato Ollama `0.33.3` con il tag installato `qwen3-coder:30b`: digest completo `06c1097efce0431c2045fe7b2e5108366e43bee1b4603a7aded8f21689e90bca`, blob `1194192cf2a187eb02722edcc3f77b11d21f537048ce04b67ccf8ba78863006a`, dimensione indicata `18 GB`, `30.5B` parametri, quantizzazione `Q4_K_M` e capability `tools`. Prima della prova `ollama ps` non riportava modelli attivi. La GPU NVIDIA GeForce RTX 2070 aveva `8192 MiB` totali e `6724 MiB` liberi; la RAM fisica era `31.89 GiB`, di cui `21.75 GiB` liberi; l'unita `D:` aveva `326.42 GiB` liberi.

CPU offload e la maggiore latenza sono ammessi per privilegiare la correttezza. Con una richiesta `/api/chat` una tantum, `num_ctx=4096`, `num_predict=128`, temperatura `0` e schema `read_file`, entrambe le run hanno restituito esclusivamente `message.tool_calls[0].function.name = "read_file"` e `arguments.filePath = "package.json"`:

| Run | Esito tool strutturato | Tempo parete | Durata totale/load | Token prompt/output | Telemetria `/api/ps` |
| :--- | :--- | ---: | ---: | ---: | :--- |
| cold | `read_file(package.json)` | 30.751 s | 29259.780 / 26026.430 ms | 297 / 23 | 19190975034 B totale, 6393618758 B GPU, contesto 4096 |
| warm | `read_file(package.json)` | 1.670 s | 1557.606 / 3.623 ms | 297 / 23 | 19190975034 B totale, 6393618758 B GPU, contesto 4096 |

La telemetria conferma offload CPU implicito (`12797356276 B` non residenti in GPU) e non ha prodotto CUDA OOM. Una richiesta `/api/chat` streaming separata, con `num_ctx=4096` e `num_predict=2048`, ha emesso un primo chunk di `130` byte; il client ha quindi segnalato il token di annullamento e rilasciato la risposta streaming. Il percorso di chiusura Windows e' stato esercitato dal comando repository `npm run test:smoke`: il processo Electron isolato ha inizializzato il bundle e gli handler IPC, ha invocato `app.quit()` in modalita smoke e ha restituito `[PASS]`.

CAS-29 e CAS-30 sono qualificati su questi contratti riproducibili. Il fallback testuale e la continuazione `/api/generate` restano implementati per compatibilita con altri modelli che non popolano `tool_calls`; nessuna protezione contro CUDA OOM, timeout, anomalie, loop o eviction e' stata disabilitata.
