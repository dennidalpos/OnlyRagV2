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

Tutte le run hanno usato `num_ctx=16384`, zero CPU offload e il digest registrato. Le etichette warm identificano il secondo processo, ma la prima generazione ha comunque pagato il caricamento; le generazioni successive mostrano 12-57 ms complessivi di load. La tabella separa quindi il caricamento osservato dall'inferenza, senza presumere una cache calda.

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
