# Live Agent Testing

Come far girare il Coding Agent per davvero — modello Ollama reale, workspace reale, shell reale — da terminale, senza aprire l'app.

I test unitari dicono se un guard produce il testo giusto. Non dicono **come un modello da 7B reagisce a quel testo**, che è dove stanno i difetti più costosi: una direttiva corretta ma formulata come un menu ha portato il modello a chiamare `ask` in modalità AGENT, dove nessuno può rispondere, e la sessione è finita lì. Nessun test unitario l'avrebbe scoperto.

---

## 1. Prerequisiti

* **Ollama in esecuzione** con il modello indicato in `settings.json` (oggi `qwen2.5-coder:7b`).
* **Le impostazioni reali dell'app**: `%APPDATA%\onlyrag-v2\settings.json`. Se non esiste, apri l'app una volta.
* Niente Electron: l'orchestratore accetta `win: null` e ogni repository che userebbe `app.getPath('userData')` ripiega su `<cwd>/userdata_dev`.

## 2. Comandi

```bash
npm run test:live
```

Esegue tutti gli scenari in `scripts/live/*.live.ts`. Per uno solo:

```bash
npx vitest run --config vitest.live.config.mts -t "eresolve"
```

Ogni run **appende** a `logs/coding_agent_audit.log`: `codingAgentLogger` usa `appendFileSync` e ruota su `coding_agent_audit.1.log` solo al superamento della soglia di dimensione — niente svuota il file all'avvio di un run. Cercando "l'ultimo run" si trova quindi per primo quello **vecchio**: segna la lunghezza del file prima di lanciare (`wc -c logs/coding_agent_audit.log`) e leggi solo la coda oltre quel punto, oppure copia via il file prima del run successivo.

> La stesura precedente diceva "ogni run sovrascrive", e il blueprint diceva l'opposto. Ha ragione il blueprint: verificato il 2026-08-25 in `codingAgentLogger.ts` — l'unica scrittura per-entry è `appendFileSync` (riga 114), e le uniche troncature stanno in `clearAuditLog` e nella rotazione per dimensione, che nessun run invoca.

## 3. Scenari

| File | Cosa fa | Come si legge |
| :--- | :--- | :--- |
| `fullTaskRun.live.ts` | Riesegue il task originale dell'audit (dashboard responsive React+Tailwind) su workspace vuoto | **Asserisce la consegna**: rapporto di milestone `verified` ≥ 12/13 e `finish` che chiude la sessione, le due metriche di Run 9 (blueprint §5.6h). Rosso = l'agente non ha consegnato; il blocco `run metrics` dice di quanto. |
| `eresolveRecovery.live.ts` | Installa davvero `vite@4`, poi chiede un plugin che pretende una vite molto più recente | Deve comparire `[DEPENDENCY VERSION CONFLICT — ERESOLVE]`, il comando successivo deve essere l'upgrade indicato, e `vite installed` deve essersi mosso da 4.5.14 |

Gli scenari scrivono in `~/Desktop/onlyrag_live_*`. Sono directory usa-e-getta, azzerate a ogni run.

Fino al 2026-08-25 `fullTaskRun.live.ts` asseriva solo `expect(result).toBeTruthy()`: due corse che hanno bruciato tutti i 50 step con 0 milestone verificate e senza mai chiamare `finish` sono uscite comunque con codice 0. Una sonda che non può diventare rossa non è evidenza dei numeri che il blueprint pubblica a partire da essa. `reportRun()` restituisce ora un oggetto `LiveRunMetrics` (step usati e tetto, milestone verified/failed/pending, `finish` invocato/accettato, comandi eseguiti, tool call fallite) letto dallo stato di sessione che l'orchestratore già persiste in `.onlyrag/sessions/.agent_state_<id>.json`: è quello, non il log condiviso, il canale di osservazione su cui si asserisce.

## 4. Le tre trappole

Ognuna produce un run che sembra funzionare e non prova nulla.

**Le impostazioni non vengono lette dal disco.** L'orchestratore usa `buildDefaultAgentSettings()` quando il payload non ne porta, e il suo modello predefinito è `llama3.2` — che non è un tag installato. Risultato: ogni turno risponde HTTP 404, la sessione brucia tutti i passi e non scrive niente. Usa sempre `loadRealSettings()`.

**Il piano non nasce da solo, e la sequenza è di quattro passi.** La UI fa: intervista di chiarimento (`agent:plan-interview`), arricchimento del prompt con le risposte (`agent:plan-enrich-prompt`), generazione (`agent:plan-generate`), semina in stato di sessione (`agent:plan-seed`), poi avvia l'agente sullo **stesso** `sessionId`. Saltare la semina significa eseguire senza piano — e senza piano metà dei guard non ha nulla su cui operare.

Saltare invece i **primi due** passi è più insidioso, perché il run sembra funzionare: il piano c'è, i guard operano, e nessuno si accorge che il planner ha ricevuto il prompt grezzo. È quello che l'harness ha fatto fino al 2026-08-24, e nei run osservati il modello si è inventato router, setup postcss e struttura delle cartelle — esattamente le scelte che l'intervista esiste per fissare prima che venga redatta una milestone. `seedGeneratedPlan()` ora replica tutti e quattro i passi, rispondendo a ogni domanda con l'opzione che il modello stesso ha marcato come consigliata (`interviewPolicy: 'recommended'`, il default). `interviewPolicy: 'skip'` riproduce il vecchio comportamento, e serve solo a isolare la differenza fra i due.

**Un file live sotto `electron/**` viene raccolto dalla suite normale.** Il pattern `include` di `vitest.config.mts` è `electron/**/*.test.{ts,tsx}`. Un harness lasciato lì gira dentro `npm run lint`, dura minuti, e con `isolate: false` smonta le directory temporanee che altri test stanno ancora usando: 29 fallimenti fantasma, tutti attribuiti — sul momento — alla modifica in esame. Per questo gli scenari stanno in `scripts/live/`, si chiamano `*.live.ts` e hanno una config dedicata.

## 5. Progettare uno scenario che prova qualcosa

Due tentativi di sonda sull'ERESOLVE non hanno testato nulla, per lo stesso motivo: **il modello ha aggirato la condizione prima che si manifestasse.**

* Primo tentativo: `package.json` dichiarava una coppia in conflitto. Il modello ha riscritto `package.json` e installato una versione compatibile. Nessun conflitto, nessuna direttiva.
* Secondo tentativo: stessa cosa con istruzioni più stringenti. Il modello ha riscritto comunque il manifest, introducendo per conto suo un pacchetto inesistente: l'errore è diventato `ETARGET`, non `ERESOLVE`.
* Terzo: `vite@4` **realmente installato in `node_modules`** e una versione di plugin esplicita nel prompt. Il manifest resta riscrivibile quanto vuole, il conflitto no.

La regola: la condizione da testare deve stare dove il modello non può toccarla. Se vive solo in un file che il modello è libero di riscrivere, la sonda misura la sua creatività, non il tuo guard.

## 6. Cosa cercare nel log

`logs/coding_agent_audit.log` contiene prompt, risposta, tool call e risultato di ogni passo.

```bash
# quali tool ha usato e quante volte
grep -h "TOOL EXECUTION INITIATED" logs/coding_agent_audit.log | sed 's/.*INITIATED\] //' | sort | uniq -c

# i comandi eseguiti, in ordine
grep -hA 12 "TOOL EXECUTION INITIATED" logs/coding_agent_audit.log | grep '"command"' | grep -v '^  "'

# quante volte i guard hanno bloccato senza produrre avanzamento
grep -c "LOOP INTERVENTION PREVENTED" logs/coding_agent_audit.log

# se un guard specifico è scattato
grep -c "UNDECLARED IMPORT IN\|DELIVERABLES MISSING\|DEPENDENCY VERSION CONFLICT" logs/coding_agent_audit.log
```

Un conteggio alto per una di queste stringhe non significa che sia scattata altrettante volte: il log ripete i blocchi nella tabella di traiettoria di ogni turno successivo. Conta le occorrenze in `TOOL RESULT COMPLETED`, o guarda i timestamp.
