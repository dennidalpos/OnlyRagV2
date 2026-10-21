# P1 qualità: confronto della lingua delle risposte — 20 ottobre 2026

**Piano storico non eseguito.** Il successivo ritiro di `QUALITY-CONTENT-LIVE-QUALIFICATION-01` nella [politica locale](./local-development-policy-2026-10-20.md) supera lo stato «aperto» riportato sotto. Il confronto da 24 generazioni non è autorizzato né compatibile con il budget degli smoke correnti. Nessun candidato viene integrato da questo documento.


Stato di `QUALITY-CONTENT-LIVE-QUALIFICATION-01`: **aperto; preparazione offline completata, nuova campagna non autorizzata**. Alla domanda sul confronto di 24 generazioni il proprietario ha risposto **«Mantieni il perimetro solo offline»**. Nessuna modifica al prompt applicativo e nessuna inferenza eseguita; non è in attesa una conferma automatica né è pianificata un'esecuzione.

## Evidenze verificate

Il prompt corrente contiene già la direttiva di rispondere nella lingua della domanda. Le sette risposte inglesi attese ma prodotte in italiano non dimostrano da sole un conflitto nelle istruzioni o una causa specifica. Non si propone una correzione come già provata.

La campagna del 20 ottobre è disponibile nella copia durevole:

`C:/Users/Utente/OnlyRag-Live/tracker-followup-20261020-c9663097/live/content-acceptance-2026-10-20T12-43-56-907Z-f747a4f1`

Gli hash di `corpus.json`, `preparation.json` e `answers.json` coincidono con la [ricevuta pubblicata](./verification-live-content-2026-10-20.json). Il corpus coincide anche con la fixture versionata; hook chat e risoluzione citazioni correnti coincidono con i rispettivi hash della raccolta storica. Tutti i dodici prompt conservati iniziano con il preset chat corrente. Il collector è successivamente cambiato: non si attribuisce al collector corrente l'hash storico né si modifica l'archivio originale.

Lettura di soli metadati Ollama, senza inferenze: runtime **0.40.6**, modello già presente **qwen3.5:9b**, digest `c97eb11d70b1acdc88af01eef566c1fe4f7fbe93eb1afc06871132f293ff425a`. Nessun download o modifica ai modelli.

## Proposta concreta da autorizzare

- **Massimo 24 generazioni locali**: dodici casi congelati, una baseline e un solo candidato per caso; nessuna riprova automatica. Ordine delle coppie alternato fra casi.
- Stesso Qwen 9B/digest, thinking disattivato, contesto 4096, stesso trasporto `/api/generate`, stesso testo delle fonti e stessa domanda; timeout di 120 secondi per singola chiamata. La baseline usa il prompt conservato completo, inclusa la sua data congelata; nessun caso riguarda la data corrente.
- Il candidato aggiunge soltanto il richiamo seguente immediatamente prima dell'ultima domanda, fuori dai blocchi documentali. Lingua attesa e risposta attesa del corpus non entrano nei payload.
- **Zero embedding, zero normalizzazioni, zero installazioni, zero dati personali**: è un confronto di prompt sui passaggi già conservati. Non misura retrieval corrente o desktop riavviato.
- Marker nuovo e riserve persistenti prima dell'invio; le chiamate fallite consumano la propria riserva. Nessun reset o riuso delle otto chiamate ledger precedenti. Conservare tutti i tentativi, risposte parziali e fallimenti; una nuova esecuzione non deve ripetere riserve già spese.

Testo del solo candidato:

```text
[RESPONSE LANGUAGE]
Use the language of the final User question for your answer, unless that question explicitly requests another output language. The language of document excerpts, earlier conversation or date labels does not choose the answer language. Preserve original identifiers and quoted code.
[END RESPONSE LANGUAGE]
```

I 24 payload esatti sono già preparati in `requests.json`, SHA-256 `852a7c39601d6eb6a94ec01f7b7a9f366df851b14d1bb16b6f86646090906a58`. Il file `preflight.json` ne vincola hash, corpus, corrispondenza dei sorgenti e confronto dei prompt. Prima di autorizzare l'esecuzione fa fede l'hash riletto in tale ricevuta; eventuali differenze richiedono una nuova preparazione, non una sostituzione silenziosa.

## Valutazione prima di integrare

Un revisore indipendente dal Qwen valutato confronterà le risposte complete con gli stessi dodici casi e fonti: lingua, contenuto, condizioni/negazioni, codici e citazioni immediatamente supportate. Nessuna aspettativa viene riscritta.

Il candidato è accettabile in questa valutazione soltanto con lingua corretta **12/12**, contenuto e citazioni corretti **12/12**, senza regressioni rispetto alla baseline. In caso contrario resta rifiutato/non qualificato; i risultati negativi sono conservati. Una coppia per caso non dimostra stabilità statistica. Anche un confronto riuscito non chiude il P1: retrieval globale, normalizzazione e desktop riavviato conservano i loro gate. Nessuna integrazione del candidato è eseguita nella preparazione.

## Autorizzazione e preparazione

La voce P1 nel [tracker](../PROJECT_STATUS.json) stabilisce: **“New live campaigns require separate explicit authorization.”** Il proprietario ha confermato il perimetro solo offline: la proposta resta un artefatto consultabile e **non viene eseguita**. Un'eventuale futura campagna richiederà una nuova richiesta esplicita; «procedi con il prossimo» non viene trattato come reset del budget precedente.

Artefatti: `C:/Users/Utente/OnlyRag-Live/chat-language-preflight-20261020-adfbef33`, con script di preparazione, 24 richieste, richiamo candidato, corpus invariato, metadati e ricevuta a **zero inferenze**. I file originali della campagna fallita restano in sede e invariati. Il task resta nello stesso elenco/priorità del tracker, senza nuovo ID.

Verifiche offline passate: sintassi ed esecuzione dello script di preparazione; hash di corpus/ricevute/sorgenti; dodici prefissi e dodici coppie di prompt con differenza limitata al richiamo; 24 ID univoci e payload senza metadati delle aspettative; conservazione di tutti i 34 ID/priorità/criteri/note precedenti e degli hash dei 66 file del profilo. `npm run docs:check` controlla 104 pagine; `git diff --check` passa. Le suite applicative non sono ripetute: questo seguito modifica documentazione/tracker e prepara input esterni, senza cambiare runtime, test o dipendenze.

Riferimenti primari del piano: [Ollama 0.40.6, API generate](https://github.com/ollama/ollama/blob/v0.40.6/docs/api.md), [filesystem Node 24.20.0](https://nodejs.org/download/release/v24.20.0/docs/api/fs.html). La documentazione delle API non prova un miglioramento semantico del candidato.
