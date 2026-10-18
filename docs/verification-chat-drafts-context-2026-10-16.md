# Recupero chat, bozze e budget del prompt

Lotto autorizzato con «traccia e procedi», iniziato il 16 ottobre e verificato il 17 ottobre 2026. I punti successivi dell'analisi restano nel tracker esistente: layout responsive, limiti dei documenti grandi, ammissione XLS e qualifica semantica live. Nessun commit, push, installazione, migrazione personale o nuova generazione con modelli reali.

Decisione successiva del 17 ottobre 2026: il target è il solo desktop Windows. Il task per il layout tablet/telefono è stato ritirato dal tracker, non completato; quei viewport restano evidenze storiche fuori dal target attuale. Vedi il [riallineamento del perimetro](./verification-current.md#perimetro-desktop--2026-10-17). Le altre qualifiche residue restano aperte.

## Contratti e criteri di completamento

| Ambito | Comportamento e criterio |
| --- | --- |
| Turno chat attivo | La domanda attende un checkpoint Main prima della generazione. Lo streaming aggiorna lo snapshot a intervalli, senza rinviare indefinitamente la scrittura. Main serializza, valida identità e formato, conserva la copia precedente, scrive con flush/rename e confronta il readback. Un turno recuperato ancora `isStreaming` diventa `interrupted`, con avviso localizzato e senza spinner di generazione. Stop, errori, cambio conversazione e callback tardive conservano la propria identità. |
| Avvio chat | `chat:load-recovery` precede nuove generazioni e modifiche alla cronologia. Il checkpoint Main, se presente e valido, è la copia di recupero riconosciuta; altrimenti si usa il formato localStorage esistente. Un archivio Main invalido blocca l'avvio e non viene riscritto. Un localStorage invalido resta protetto anche se il checkpoint Main è leggibile; il retry richiede una lettura valida prima di scrivere. |
| Bozze documentali | `ingest:load-drafts` e `ingest:save-drafts` trasferiscono snapshot Zod con revisione SHA256. Ogni bozza conserva testo e revisione originale; il recupero non autorizza un rebase. Il bootstrap precede l'editing e una risposta di bootstrap superata non sostituisce una digitazione recente, anche in StrictMode. Un salvataggio canonico o uno scarto esplicito rimuove solo la bozza corrispondente. |
| Chiusura e rifiuto | Main attende impostazioni, storico Coding, chat e bozze. Una scrittura rifiutata conserva la finestra e il testo, espone retry e consente copia/export. Le modifiche arrivate durante una scrittura vengono riconosciute separatamente; il flush continua fino allo snapshot più recente. Nessuna modifica è accettata durante un bootstrap fallito. |
| Prompt completo | Istruzioni, contesto temporale, domanda, wrapper e riserva della risposta vengono conteggiati prima di retrieval e anteprime. I segmenti usano soltanto il residuo disponibile. Lo storico compattato include nel proprio limite anche il messaggio di troncamento. Un input obbligatorio troppo grande viene rifiutato esplicitamente; la domanda non viene troncata. Il controllo finale comprende tutti i separatori e le citazioni vengono generate solo per passaggi inclusi. |

Il limite del prompt è una **stima in caratteri**, basata sul rapporto condiviso di 3,5 caratteri/token. Non certifica il tokenizer di ogni modello. Le prove coprono finestre piccole, domanda lunga, contesto saturo e Unicode; non misurano qualità semantica o token effettivi in Ollama.

## Archivi e recupero

Sotto userData il Main usa `chat-history-recovery.json` e `document-drafts.json`, con envelope versione 1 e copia precedente `.bak`. Il digest rifiuta snapshot obsoleti; la ripetizione di uno snapshot identico è idempotente. Un primario mancante con backup presente richiede recupero esplicito, senza sostituirlo con uno stato vuoto. Non promuovere o cancellare questi file a mano mentre l'app è aperta. Le copie precedenti possono contenere conversazioni o bozze rimosse dallo stato corrente: la rimozione logica non è cancellazione sicura del supporto.

Lo storico localStorage resta nel suo formato; non vengono riscritti profili personali durante queste prove. Il nuovo checkpoint è necessario perché il ritorno sincrono di `localStorage.setItem` non è una conferma del flush su disco di Chromium: la prova di terminazione forzata del processo ha perso il checkpoint del primo approccio basato solo su localStorage. Il Main conferma invece dopo il writer e il readback.

Il contratto delle bozze ammette massimo 100 documenti, 10 milioni di caratteri per testo e 20 milioni complessivi includendo le basi. Oltre il limite la scrittura fallisce lasciando il testo in memoria, con retry/export. Non viene qualificato un limite generale della memoria del Renderer.

## Verifiche

La prova [`chatDraftRecovery.mjs`](../scripts/e2e/chatDraftRecovery.mjs) usa Renderer, Monaco, Main, Preload e archivi reali in userData temporaneo; solo documenti e generazione sono fixture deterministici. Attende il checkpoint Main della risposta parziale, termina esclusivamente l'albero di processi restituito da quel lancio, riavvia e verifica risposta incompleta e bozza con revisione originale. Una directory al posto dell'archivio provoca un rifiuto reale di scrittura: la finestra resta aperta, il retry salva e un altro riavvio rilegge il testo.

| Comando | Esito e limiti |
| --- | --- |
| `npm run test:fast -- --silent=true` | 2.863 passati in 320 file, 198,33 secondi. Dopo l'avvio della suite è stato aggiunto il rifiuto delle citazioni per passaggi vuoti; la verifica finale mirata sotto include anche quel caso. |
| `npx vitest run` sui sette file chat, bozze, budget, compattazione e archivi Main, con `--reporter=dot --silent=true` | 63 passati in 3,26 secondi sulla revisione finale dei comportamenti. Include errori Main e localStorage, bootstrap rifiutato, risposta parziale con localStorage assente, annullamento durante checkpoint, StrictMode, più bozze, versioni obsolete e readback dei due archivi. |
| `.venv\Scripts\python.exe -m pytest -q` | 537 passati, un caso Windows symlink saltato, 149,12 secondi. Nessun file Python modificato e nessun modello reale. |
| `npm run build` | Passato sulla revisione finale: typecheck, Renderer, Main e Preload. |
| `npm run typecheck` | Passato separatamente. |
| `npm run quality:static` | Passato: 103 handler IPC e 849 file. Un passaggio intermedio ha segnalato il formato CRLF del tracker riscritto; normalizzato con Biome, poi controllo passato. |
| `npm run docs:check` e `git diff --check` | Passati: 61 pagine Markdown e nessun errore whitespace. |
| `pwsh -NoProfile -File scripts/test_bundle_smoke.ps1 -Fast -SkipBuild` | Passato con il bundle costruito. |
| `node scripts/e2e/chatDraftRecovery.mjs` | Passato con Main/Preload/writer reali: checkpoint parziale letto dal file prima della terminazione forzata dell'albero isolato, riavvio con risposta incompleta, bozza con base obsoleta, rifiuto reale di scrittura, chiusura rifiutata, retry e rilettura dopo ulteriore riavvio. Aggiunto come gate nella CI; CI remota non eseguita. |
| `node scripts/e2e/settingsCloseDurability.mjs` | Passato: chiusura anticipata, errore reale, retry e rilettura al riavvio. |
| `node scripts/e2e/documentRevisionRecovery.mjs` | Passato: conflitto, conservazione bozza, reload esplicito e salvataggio con revisione corretta. Banner verificato ai tre viewport; non qualifica il layout generale ingestion. |
| `node scripts/e2e/settingsBootstrap.mjs` | Passato: bootstrap, rifiuto di scrittura, retry, reload, lingua, wizard e serializzazione. |

I tentativi iniziali del test hanno evidenziato selezione delle schede tramite ruolo errato e inserimento di caratteri troppo rapido in Monaco sotto carico; il test usa ora il ruolo `tab` e un inserimento unico. Il polling asincrono iniziale via `waitForFunction` non attendeva la condizione nel Playwright 1.62.1 installato: il codice locale `coreBundle.js` tratta la Promise come un valore truthy. La sonda controlla ora il file reale fino al checkpoint parziale, prima di terminare il processo; i fallimenti precedenti non qualificano un checkpoint riconosciuto dal Main. Il tentativo con `forcefullyCrashRenderer` ha confermato che l'app termina dopo la perdita del Renderer: il test deve riavviare l'app, non attendere un reload della vecchia pagina. I fixture falliti rimangono sotto `%TEMP%/onlyrag-chat-drafts-*`; nessuna evidenza di campagne precedenti è stata rimossa.

Fonti primarie confrontate con le versioni locali: [Node 24.20.0 filesystem e flush](https://raw.githubusercontent.com/nodejs/node/v24.20.0/doc/api/fs.md), [Electron 43.7.4 webContents e crash](https://raw.githubusercontent.com/electron/electron/v43.7.4/docs/api/web-contents.md). I test sul runtime reale completano la verifica delle API usate: la documentazione non certifica da sola la durata dei dati.

## Limiti residui

Interruzione controllata e riavvio del desktop di sviluppo non qualificano perdita di alimentazione, metadata directory, tutte le finestre temporali di crash o app installata. Prima di un checkpoint riconosciuto le ultime battute e i token più recenti possono ancora essere solo in memoria. La qualità di retrieval, risposte e citazioni richiede la campagna separata con aspettative congelate, senza sostituire le prove storiche fallite.
