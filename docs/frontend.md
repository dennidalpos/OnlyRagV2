# Renderer React

Il Renderer usa solo `window.electronAPI` esposta da [`electron/preload.ts`](../electron/preload.ts). Le viste sono in [`src/components/`](../src/components/) e gli hook in [`src/hooks/`](../src/hooks/). Contratti e validazione sono in [`api-ipc.md`](./api-ipc.md).

## Viste e proprietà dei dati

- Chat: [`useChatEngine.ts`](../src/hooks/useChatEngine.ts) gestisce streaming e contesto; [`useChatHistory.ts`](../src/hooks/useChatHistory.ts) conserva il formato localStorage corrente e attende una copia di recupero riconosciuta dal Main. Domanda e risposta attiva vengono checkpointate durante lo streaming; una risposta recuperata in corso è marcata incompleta. Errori di lettura impediscono di sovrascrivere l'originale; un salvataggio rifiutato blocca la chiusura normale. Il formato localStorage esistente resta leggibile.
- Ingestion: la lista carica metadati, il Markdown arriva su richiesta e la cache ne verifica la revisione. Le bozze vengono conservate dal Main con la propria revisione di base e ricaricate al montaggio; un salvataggio tardivo non cambia la selezione. Dopo un rifiuto si può esportare la bozza o confermare lo scarto e ricaricare la versione salvata: una lettura fallita mantiene la bozza. Il bootstrap delle bozze precede la modifica; errori di archivio espongono Riprova ed export. Il recupero non ribasa una bozza su una revisione successiva. Desktop installato, memoria complessiva e perdita di alimentazione restano da qualificare.
- Traduzione: [`useTranslation.ts`](../src/hooks/useTranslation.ts) separa la selezione Markdown da PDF/DOCX; un blocco condiviso consente un job alla volta. L'identità PDF/DOCX esiste prima dell'invio; Stop e unmount chiedono la cancellazione e mantengono il blocco fino al risultato IPC. Eventi di altre operazioni sono ignorati; un errore di trasporto non viene presentato come cancellazione confermata.
- Coding Agent: [`useCodingAgent.ts`](../src/hooks/useCodingAgent.ts) compone esecuzione, sessione, allegati, file e terminale. Gli eventi sono legati all'identità della run; i salvataggi rifiutati restano visibili per retry mentre la vista è attiva.

## Interfaccia e accessibilità

I testi sono in [`src/i18n/locales/`](../src/i18n/locales/) per italiano e inglese. I modali condividono uno stack di focus e richiedono pulsanti espliciti per approvazioni non dismissibili. I messaggi chat completati rendono Markdown/GFM senza HTML grezzo o caricamento di immagini remote; lo streaming rimane testo letterale. La verifica autonoma copre tastiera, albero accessibile, zoom e riavvio su profili sintetici.

## Excel format option — 2026-10-11

L'interruttore salvato abilita `allowFullExcelFormat` solo per la richiesta corrente. Dimensioni, estratto limitato e memoria XLS sono descritti in [`ingestion.md`](./ingestion.md).

## Claim/source navigation — 2026-10-02

La navigazione apre soltanto una posizione originale verificata da ID, revisioni e hash; non certifica l'entailment della risposta. Vedi [`retrieval.md`](./retrieval.md).

## Retrieval scores — 2026-10-02

Il punteggio mostrato ordina i passaggi recuperati e non è una probabilità o una citazione verificata.

## Salvataggio delle impostazioni — 2026-10-02

[`useSettingsPersistence.ts`](../src/hooks/useSettingsPersistence.ts) serializza debounce, retry e flush di chiusura. Main attende impostazioni e storico Coding; una scrittura rifiutata mantiene aperta la finestra e rende disponibile il retry. Unmount invia comunque i valori pendenti. Crash, interruzioni forzate e desktop installato restano nel perimetro di `SETTINGS-CLOSE-DURABILITY-01`.

## Hook e servizi

[`useWorkspaceFiles.ts`](../src/hooks/useWorkspaceFiles.ts) lega letture e salvataggi alla selezione e revisione correnti. [`documentMarkdown.ts`](../src/services/documentMarkdown.ts) carica il testo su richiesta. Le responsabilità di chat, ingestion, traduzione e agente sono nelle guide di ambito.

## Componenti tecnici

Monaco e tokenizer sono caricati quando servono; le chiamate privilegiate restano nel Preload/Main. L'upload risolve il `File` nativo tramite il bridge locale, senza fallback al nome.

## Aiuti e capacità runtime — 2026-10-20

Gli aiuti condividono `Tooltip` e il catalogo tipizzato `help` nelle traduzioni IT/EN. Testi descrittivi e sottotitoli sono disponibili su hover/focus; etichette, errori, progressi e decisioni restano visibili. I tooltip sono ospitati nel layer del modale attivo, fuori dal pannello scorrevole. Escape chiude prima l'aiuto e poi il dialogo. La UI e il preflight non mostrano qualifiche o prove storiche di modelli specifici; mantengono le capacità rilevate e i vincoli runtime.

## Model/workload fit — 2026-10-02

La stima espone contesto effettivo, base della misura e incertezza di memoria/offload. Non cambia impostazioni né ammette richieste: [`model-runtime-fit.md`](./model-runtime-fit.md).

## Modal focus and accessibility — 2026-10-02

Lo stack di modali isola il livello attivo; i test Chrome tastiera/tree passano nei casi dichiarati. Il task autonomo conserva tastiera, zoom, albero accessibile e Monaco nel desktop locale riavviato; la campagna screen reader è ritirata.

## Chat readable output — 2026-10-11

I riferimenti sorgente restano azionabili fuori da codice e link; URL esterni sono limitati a HTTP(S). Le prove di layout sono fixture, non garanzie di latenza per cronologie arbitrarie.

## Recupero e budget chat — 2026-10-16

La chiusura attende anche chat e bozze. Il contesto chat riserva prima istruzioni, data, domanda e risposta; documenti e storico usano soltanto lo spazio residuo. È un limite in caratteri stimati, non una misura esatta dei token del modello. Contratti, prove e limiti sono in [recupero chat e bozze](./verification-chat-drafts-context-2026-10-16.md).
