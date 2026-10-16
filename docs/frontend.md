# Renderer React

Il Renderer usa solo `window.electronAPI` esposta da [`electron/preload.ts`](../electron/preload.ts). Le viste sono in [`src/components/`](../src/components/) e gli hook in [`src/hooks/`](../src/hooks/). Contratti e validazione sono in [`api-ipc.md`](./api-ipc.md).

## Viste e proprietà dei dati

- Chat: [`useChatEngine.ts`](../src/hooks/useChatEngine.ts) gestisce streaming e contesto; [`useChatHistory.ts`](../src/hooks/useChatHistory.ts) conserva la cronologia nel formato localStorage corrente. Errori di lettura impediscono di sovrascrivere l'originale; la durata dopo crash di un turno attivo resta aperta.
- Ingestion: la lista carica metadati, il Markdown arriva su richiesta e la cache ne verifica la revisione. Le bozze restano per documento con la propria revisione di base durante la vista montata; un salvataggio tardivo non cambia la selezione. Dopo un rifiuto si può esportare la bozza o confermare lo scarto e ricaricare la versione salvata: una lettura fallita mantiene la bozza. Unmount/crash e limite di memoria delle bozze restano aperti.
- Traduzione: [`useTranslation.ts`](../src/hooks/useTranslation.ts) separa la selezione Markdown da PDF/DOCX; un blocco condiviso consente un job alla volta. L'identità PDF/DOCX esiste prima dell'invio; Stop e unmount chiedono la cancellazione e mantengono il blocco fino al risultato IPC. Eventi di altre operazioni sono ignorati; un errore di trasporto non viene presentato come cancellazione confermata.
- Coding Agent: [`useCodingAgent.ts`](../src/hooks/useCodingAgent.ts) compone esecuzione, sessione, allegati, file e terminale. Gli eventi sono legati all'identità della run; i salvataggi rifiutati restano visibili per retry mentre la vista è attiva.

## Interfaccia e accessibilità

I testi sono in [`src/i18n/locales/`](../src/i18n/locales/) per italiano e inglese. I modali condividono uno stack di focus e richiedono pulsanti espliciti per approvazioni non dismissibili. I messaggi chat completati rendono Markdown/GFM senza HTML grezzo o caricamento di immagini remote; lo streaming rimane testo letterale. La verifica con screen reader reale e desktop riavviato è ancora nel tracker.

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

## Segnali di qualificazione dei modelli — 2026-10-02

La UI separa capacità rilevate, risultati storici e qualifica del task. Gli otto scenari isolati del 9B non qualificano TaskLab; nessun badge generico promette autonomia affidabile.

## Model/workload fit — 2026-10-02

La stima espone contesto effettivo, base della misura e incertezza di memoria/offload. Non cambia impostazioni né ammette richieste: [`model-runtime-fit.md`](./model-runtime-fit.md).

## Modal focus and accessibility — 2026-10-02

Lo stack di modali isola il livello attivo; i test Chrome tastiera/tree passano nei casi dichiarati. Screen reader, zoom e Monaco nel desktop riavviato restano da qualificare.

## Chat readable output — 2026-10-11

I riferimenti sorgente restano azionabili fuori da codice e link; URL esterni sono limitati a HTTP(S). Le prove di layout sono fixture, non garanzie di latenza per cronologie arbitrarie.
