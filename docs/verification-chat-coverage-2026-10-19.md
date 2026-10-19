# Contesto documentale della risposta chat — 19 ottobre 2026

## Perimetro P03

Task selezionato: `CHAT-DOCUMENT-COVERAGE-01`, P2. La qualifica di distribuzione precedente conserva gate di installazione/modelli non autorizzati; il confronto del chunking sul corpus congelato richiede una nuova valutazione con gli embedding reali dichiarati in [content-acceptance.md](./content-acceptance.md). Questo lotto implementa il successivo comportamento verificabile offline, senza usare fixture sintetiche come accettazione semantica di quei task.

## Risultato

Ogni nuova risposta con documenti selezionati espone **Contesto documentale inviato per questa risposta**. L'elenco distingue anteprime dei documenti e passaggi restituiti dalla ricerca; conserva identità documentale, riferimento del passaggio incluso, testo esatto del corpo incluso e lunghezza prima del taglio. Mostra inclusione, troncamento o esclusione per budget, testo vuoto o documento fuori selezione. **Testo inviato** permette di leggere l'intero corpo incluso, senza il limite della scheda citazione. Anteprime e passaggi sovrapposti non vengono sommati in una percentuale ingannevole di copertura.

Il dettaglio viene prodotto dagli stessi corpi usati per assemblare il prompt e associato al messaggio immediatamente prima della chiamata di generazione. Un errore di preparazione o uno stop prima del dispatch non creano un dettaglio di invio. Ricerca saltata e ricerca completata senza risultati restano distinte. L'ordine e la numerazione dei riferimenti già usati dal prompt sono preservati; i passaggi esclusi non diventano schede citazione.

`contextCoverage` è un campo opzionale del messaggio, validato dallo schema condiviso anche nei checkpoint Main/IPC. Rifiuta conteggi/stati incoerenti e campi inattesi negli elementi. Le conversazioni precedenti continuano a caricarsi senza migrazione; non viene inventato un riepilogo retroattivo. Il dettaglio resta nel messaggio durante lo streaming, l'interruzione e il recupero; il renderer visualizza il testo come contenuto letterale, senza eseguire markup o creare collegamenti alle fonti per le sole righe del riepilogo.

Implementazione: [hook chat](../src/hooks/useChatEngine.ts), [schema](../shared/domain/chatContextCoverage.ts), [checkpoint](../shared/domain/chatHistory.ts), [vista](../src/components/chat/ChatContextCoveragePanel.tsx). La [guida utente](./guida-utente.md#08-fare-domande-con-o-senza-documenti) e [retrieval](./retrieval.md) descrivono uso e limiti.

## Evidenze

- `npx vitest run src/hooks/useChatEngine.test.tsx src/components/chat/ChatMessageItem.test.tsx src/services/chatHistoryStorage.test.ts`: **59 passati in 3 file**, 2,62 s nell'ultima esecuzione mirata. Casi multipli con budget saturo a 2048, Unicode, passaggio escluso per budget, fuori selezione e vuoto, anteprime complete/troncate, ricerca vuota/saltata, preparazione fallita e stop prima del dispatch. Il prompt catturato contiene i corpi dichiarati inclusi e non contiene le sentinelle dei passaggi esclusi. I riferimenti coincidono con le schede citazione e con il checkpoint. Roundtrip JSON e rifiuto di sei archivi incoerenti; rendering IT/EN e testo HTML letterale.
- `npm run test:e2e:chat-drafts`: **exit 0**, inclusa build TypeScript/Vite/Electron. La prova esistente è estesa con selezione documento, ricerca e generazione simulate: il prompt intercettato nel Main contiene il passaggio e l'anteprima attesi; il file di checkpoint reale conserva esattamente il riepilogo. Dopo l'arresto forzato del solo processo posseduto, Main/Preload rileggono lo stesso dettaglio e il pannello viene aperto nella vera finestra Electron. Verificato a finestre 1024×720 e 1920×1080, con viewport effettivi 1010×683 e 1906×1043. Restano eseguiti anche rifiuto scrittura, retry, conflitto di revisione della bozza e successivo riavvio.
- `npm run test`: **2.902 passati in 320 file**, 183,38 s nell'esecuzione finale, inclusa la regressione aggiuntiva sulla ricerca saltata.
- `.venv\Scripts\python.exe -m pytest`: **583 passati, 1 saltato**, 168,94 s. Il caso symlink resta saltato; il test junction Windows reale è eseguito.
- `npm run typecheck`, `npm run quality:static` e `npm run docs:check`: **exit 0**; statico su 853 file e 103 handler IPC, documentazione su 69 pagine. `git diff --check` passato. Confronto strutturale del tracker: rimossa soltanto la voce conclusa, altre 41 identiche, nessuna modifica a schema, note o priorità.

La prova Electron usa profili temporanei isolati e `ollamaHost` su una porta loopback indisponibile per le diagnostiche; i servizi documento/ricerca/generazione sono fixture IPC dichiarate. I profili delle prove riuscite vengono rimossi dallo script, quelli falliti sarebbero conservati. Non è una prova del Sidecar o di un modello reale.

## Limiti e conservazione

Il dettaglio descrive il solo contesto documentale aggiunto nel turno: non include istruzioni, domanda, wrapper o storico precedente. I conteggi sono unità UTF-16 del Markdown estratto o del singolo candidato, non byte del file originale, token del modello o copertura semantica. I candidati fuori dalla shortlist richiesta non sono valutati; la UI lo dichiara. La presenza nel prompt non certifica che il modello legga, utilizzi o supporti correttamente un passaggio: valutazione semantica, citazioni, qualità encoder e allocazione token conservano i task separati.

L'installer conservato `cpu-20261018-220641-87a891b9` resta un artefatto storico con le sue ricevute immutate e non contiene questa funzionalità. La build di sviluppo verificata qui non è un nuovo installer qualificato. Nessuna installazione, campagna modello, migrazione di dati personali, pubblicazione, commit o push.

La modifica preesistente ad `AGENTS.md` è conservata con identico SHA-256. Backup del tracker/dossier e log delle verifiche sono in `%TEMP%/onlyrag-p03-coverage-de38681f10f04fc1a66e6418a3262ee1`. I due log applicativi prodotti dalle suite sono copiati lì con confronto SHA-256; gli originali `logs/app.log` e `logs/coding_agent_audit.log` restano ignorati nel checkout perché la revisione automatica ha rifiutato il trasferimento e la rimozione della cartella vuota con «blocked by policy». Dipendenze, cache preesistenti, dati, build e candidati protetti sono conservati. Il dossier SecondBrain registra il nuovo comportamento; Sync riuscito su 23 repository, zero segnalazioni. Nessuna memoria privata degli IDE è modificata.
