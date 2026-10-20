# Campagna ledger limitata — 20 ottobre 2026

Stato: **campagna conclusa, raccolta e audit installato verificati; qualifica fallita/incompleta**. Il task `AGENT-REQUEST-LEDGER-LIVE-QUALIFICATION-01` rimane aperto. [Ricevuta completa e giudizi indipendenti](./verification-ledger-bounded-2026-10-20.json).

L'utente ha autorizzato una nuova campagna distinta con massimo **otto chiamate effettive**, ripartite in quattro estrazioni e quattro pianificazioni, sui [quattro ledger già confermati](./request-ledger-human-review-2026-10-10.md). Non si riusano né si azzerano i marker storici. Richieste, decisioni e corpus congelato restano invariati.

Il runner [requestLedgerBounded.mjs](../scripts/e2e/requestLedgerBounded.mjs) usa il candidato installato `cpu-20261020-130728-0e85c502`, verificando tutti i file del payload contro il manifesto e i sorgenti correnti contro digest fissi. Profilo e workspace sono isolati. Il debug è abilitato; il programma viene riavviato prima delle chiamate e successivamente per la rilettura dei bundle tramite Preload/IPC/Main reali. La modalità E2E disabilita il Sidecar automatico: questa campagna non ne ripete la qualifica.

Il contatore [LedgerCallBudget](../scripts/e2e/ledgerCallBudget.ts) riserva una chiamata su disco, con creazione esclusiva e flush, prima di inoltrarla a Ollama. Errori e risposte incomplete consumano la riserva. Per ottenere un campione per ogni originale, ciascuna fase dispone di una chiamata per caso. Correzioni, seconde generazioni e revisioni semantiche richieste dal flusso nativo vengono conservate come rifiuti del budget senza raggiungere il modello. I guard di produzione restano attivi: un candidato senza revisione richiesta non diventa un piano accettato. Il limite può quindi impedire il completamento del flusso anche quando un candidato è formalmente valido.

Evidenze locali: `%USERPROFILE%/OnlyRag-Live/request-ledger-bounded-20261020-v1`. Il marker omonimo `-replay.json` resta conservato anche in caso di errore. Runtime verificato prima delle inferenze: Ollama **0.40.6**, Qwen `qwen3.5:9b`, digest `c97eb11d70b1acdc88af01eef566c1fe4f7fbe93eb1afc06871132f293ff425a`, thinking attivo, contesto 16384; sampling 1 / top-p 0.95 / top-k 20 / min-p 0 / presence penalty 1.5 / repeat penalty 1. Non è una replica sul precedente Ollama 0.40.2 e non isola causalmente cambiamenti di prompt o runtime.

Il primo avvio si è fermato prima delle inferenze per un campo operativo non più ammesso dal contratto IPC corrente. Ricevuta completa conservata in `zero-inference-ipc-failure.json`, input originale e sorgenti iniziali conservati. La continuazione esplicita richiede zero riserve precedenti, conserva il medesimo marker e rifiuta il riavvio dopo qualsiasi riserva. Usa `identity.runId` secondo il contratto attuale; non indebolisce lo schema IPC. Anche il precedente arresto di preflight sulla versione Ollama storica è conservato e ha consumato zero chiamate.

La revisione indipendente confronta tutte le risposte complete con i vincoli originali: pulsanti globali/inventario aperto; entrambi gli export CSV/JSON e ordine; entrambe le proprietà CSV sotto il trigger originale; JSON mantenuto senza esclusività, adapter soltanto preparati senza connessioni esterne ed editor CLI senza browser secondo la decisione esplicita. La validità nativa e la somiglianza del testo non sostituiscono questa revisione. Nessuna nuova bozza è confermata automaticamente e la pianificazione riceve soltanto i ledger umani già confermati.

## Estrazione conclusa

Quattro chiamate, quattro risposte complete, quattro risultati nativi `scope_confirmation_required`, **una sola accettazione semantica su quattro**. Nessuna bozza è stata confermata automaticamente. I giudizi indipendenti `review-extraction-0.json` … `review-extraction-3.json` legano i rispettivi input e risposte completi con SHA-256.

| Originale | Revisione indipendente |
| --- | --- |
| Pulsanti 44×44 | Passa: requisito globale, inventario aperto, nessun target o condizione inventati. Il soggetto singolare Button indica la stessa classe. |
| Ordine CSV/JSON | Fallisce: `scope=context` elimina l'obbligo operativo; target CSV/JSON e inventario chiuso sono persi. |
| CSV condizionale | Fallisce: trigger e due proprietà presenti, ma diventano un unico obbligo globale su `Output Response`, senza il target CSV locale/chiuso confermato. Il prefisso If del trigger non è motivo di rifiuto. |
| JSON, adapter, editor | Fallisce: JSON diventa capacità globale/aperta; preparare adapter diventa implementarli; il target dell'editor è una virgola con inventario aperto. Il testo conserva il divieto di connessioni esterne e la scelta CLI/no-browser, ma i metadati non ne rispettano il perimetro. |

## Pianificazione e audit conclusi

Quattro candidati nativi, **una chiamata effettiva per originale**, zero revisioni semantiche inoltrate e zero piani accettati/eseguiti. Sette richieste aggiuntive sono rifiutate prima del trasporto: tre revisioni di copertura e quattro seconde generazioni. Nel quarto caso la validazione dei target rifiuta già il primo candidato (`incomplete target set for OBL-001`), senza arrivare alla revisione. I messaggi nativi `2/2 calls` contano tentativi logici, compresi i rifiuti del proxy: non sono ulteriori inferenze. L'eseguibile del runner termina con exit 1, coerente con l'assenza di piani accettati.

| Candidato | Giudizio indipendente sul contenuto conservato |
| --- | --- |
| Pulsanti | Criterio esplicito sul minimo 44×44 per i pulsanti, ma un file CSS è dichiarato come target della classe Buttons. Esistenza dello stylesheet soltanto assunta; comando letterale `null` normalizzato via. Nessun piano nativo accettato. |
| Ordine CSV/JSON | Target e condizioni dei claim corretti, ma il criterio offre indice originale oppure iterazione Map senza garantire che l'ordine della Map coincida con quello della sorgente. L'obiettivo non sostituisce il criterio assegnato. Comando letterale `],` normalizzato via. |
| CSV condizionale | UTF-8 e quotatura presenti e riferimenti 1/2 coerenti. Il trigger compare nei claim, non nei criteri; servizio esistente soltanto assunto. Annotazioni evidenceId conservate e comando eslint non disponibile normalizzato via. Questi aspetti positivi non completano il gate nativo interrotto dal budget. |
| JSON, adapter, editor | Configurazione e policy README sostituiscono i comportamenti JSON/editor; un solo adapter mock implementato sostituisce la preparazione globale. I file sono usati come target JSON/editor. Il rifiuto nativo del target JSON è corretto. |

Questi flussi sono **limitati dal budget**: non sono quattro prove complete di fallimento del revisore o quattro piani accettati. Il gate di estrazione è invece osservato e fallisce autonomamente (1/4). Non si modifica un oracolo per far passare i risultati.

Dopo il terzo avvio, otto chiamate reali `exportAiDebugBundle` attraverso Preload/IPC/Main rileggono gli otto tracciati persistiti. Il readback offline verifica identità, richiesta originale e **intero output esatto** di ogni risposta dentro il rispettivo bundle; debug ancora abilitato nel profilo. Tutti gli stream hanno terminale `done=true`, `done_reason=stop` e ragionamento catturato. I due eventi socket di metadati non hanno un responseFile di inferenza e non alterano gli otto stream completi. Questa prova qualifica la rilettura audit della build installata nei casi dichiarati; non qualifica TaskLab, esecuzione dei piani, rotazione scartata dalla retention o perdita di alimentazione.

Readback indipendente: 99 artefatti vincolati, marker storici invariati, medesimo installer/payload. I quattro giudizi di estrazione e i quattro di pianificazione legano input e risposte tramite SHA-256. Comandi: preflight zero inferenza; `--run` conserva il tentativo IPC rifiutato a zero chiamate; `--continue-unspent` esegue le otto chiamate senza resettare marker o riserve; `verify-capture.mjs` nella radice di evidenze verifica la raccolta offline con exit 0 e `qualificationPassed=false`. I quattro test del budget e i 98 test mirati complessivi, typecheck, statico e documentazione passano. Nessun nuovo ID chiuso: **33 attività aperte**, con il residuo precisato nel task esistente. Budget esaurito; ulteriori inferenze ledger richiedono una nuova autorizzazione delimitata.

Seguito: la successiva [qualifica XLS](./verification-installed-xls-2026-10-20.md) chiude un altro ID e porta il tracker a 32 aperti, senza chiamate reali aggiuntive. L'installazione temporanea condivisa è rimossa dal proprio uninstaller; entrambi i profili e tutte le evidenze restano conservati.

Riferimenti tecnici: [filesystem Node 24.20.0](https://nodejs.org/download/release/v24.20.0/docs/api/fs.html), [Electron 43.7.4](https://github.com/electron/electron/blob/v43.7.4/shell/browser/api/electron_api_app.cc), [release Ollama 0.40.6](https://github.com/ollama/ollama/releases/tag/v0.40.6). Questi riferimenti spiegano i meccanismi; gli esiti dipendono dalle ricevute locali.
