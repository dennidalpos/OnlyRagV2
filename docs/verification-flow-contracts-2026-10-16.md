# Revisioni e ciclo di vita dei flussi — 2026-10-16

Implementazione dei sei rilievi approvata con «procedi». Il checkout conteneva già correzioni comportamentali e documentazione: sono state conservate, senza commit, push, migrazioni personali, installazioni o chiamate a modelli reali.

## Responsabilità e contratti

Il Renderer possiede selezione, bozza e stato visibile; il Main valida gli IPC e coordina il trasporto e i task; il Sidecar possiede estrazione, codifica e transazioni LanceDB. Il journal e il confronto atomico finale già presenti restano al loro posto. Le correzioni trasferiscono esplicitamente le identità necessarie attraverso questi confini e riusano il flusso di recupero esistente.

| Rilievo | Modifica e criterio verificato |
| --- | --- |
| F1, revisione della bozza | `expectedRevision` IPC e `expected_revision` REST sono obbligatori e provengono dall'`ingestedAt` letto col testo. La bozza conserva questa base durante refresh e cambio di selezione. Il Sidecar rifiuta una base obsoleta prima della codifica e conserva il confronto atomico dopo gli embedding. Il test con LanceDB reale controlla 409, documento, chunk e assenza di journal residuo; il vecchio payload senza revisione restituisce 422. Nessun rebase o retry di scrittura automatico. |
| F1, recupero | Un salvataggio rifiutato conserva testo e avviso. Si può esportare la bozza oppure confermare lo scarto e leggere l'ultima versione. Lettura fallita, cambio di selezione e digitazione successiva non autorizzano lo scarto di un'altra bozza. I test controllano anche la revisione usata dal salvataggio successivo al reload. |
| F2, traduzione | L'identità nasce nel Renderer prima dell'invio ed è richiesta dall'IPC. Progressi di altre operazioni vengono ignorati. Stop funziona prima del primo evento; unmount chiede la cancellazione e conserva il lock fino al risultato IPC. Main mantiene il task cancellabile e attende il terminale HTTP, come per ingestion. Gli ID attivi duplicati vengono rifiutati senza rimuovere il proprietario precedente. Solo il terminale `cancelled` produce `cancelled: true`; un errore o una disconnessione restano errori. Il file tradotto ha un tipo distinto con stato `translated`. |
| F3, risposte HTTP | Schemi Zod verificano lista, documento, aggiornamento, traduzione, anteprima, export e acknowledgement di cancellazione/eliminazione. Le risposte legate a un documento verificano anche l'identità. NDJSON malformato, risultato incompleto, percentuale fuori contratto ed eventi dopo `done`/`cancelled` falliscono; un rifiuto di normalizzazione rimane tale anche se seguito da un falso successo. Restano coperti UTF-8 frammentato e ultima riga senza newline. |
| F4, cache | Prima di servire o memorizzare il testo, la cache controlla ID e `ingestedAt` della risposta. Una versione diversa restituisce indisponibilità e non viene attribuita alla chiave richiesta; una lettura successiva può riprovare. |
| F5, timeout | Il timer totale parte insieme alla richiesta e comprende anche l'attesa del socket; il timeout d'inattività resta separato. Entrambi interrompono il trasporto e rilasciano il timer. Il test con risposta continua verifica che il limite totale scada comunque. Timeout e disconnessione non attestano rollback né autorizzano retry di scrittura. |
| F6, impostazioni | `useSettingsPersistence` serializza debounce, retry e flush; la chiusura Main attende anche lo storico Coding. Bootstrap fallito non scrive i default. La prova Electron usa Main, Preload e writer reali in un profilo temporaneo: debounce sospeso, errore di scrittura, finestra mantenuta aperta, retry, chiusura e readback dopo riavvio. |

## Migrazione dei chiamanti

Renderer, Main e Sidecar devono essere aggiornati insieme. I chiamanti di `ingest:update` aggiungono `expectedRevision`; quelli REST aggiungono `expected_revision`, senza risolverla nuovamente al momento del salvataggio. I chiamanti di `ingest:translate-inplace` assegnano `taskId` prima dell'invio. I vecchi payload vengono rifiutati esplicitamente. I test precedenti sono migrati al contratto, comprese le prove di rollback, mancata disponibilità, provenienza e spazio embedding. I dati persistenti non cambiano formato.

Versioni locali: Node 24.20.0, Python 3.13.15, FastAPI 0.141.1, Starlette 1.7.0, LanceDB 0.37.1, Vitest 4.1.11. Per il comportamento del timeout, fonte primaria della versione usata: [Node 24.20.0 HTTP](https://raw.githubusercontent.com/nodejs/node/v24.20.0/doc/api/http.md#requestsettimeouttimeout-callback). I contratti applicativi sono verificati contro codice e test locali, non inferiti dalla documentazione di versioni diverse.

## Verifiche

| Comando | Esito |
| --- | --- |
| `npm run test:fast -- --silent=true` | 2.842 test passati, 317 file, 193,76 secondi sulla revisione finale del codice applicativo. 24 casi JavaScript aggiunti rispetto al checkout iniziale. |
| `.venv\Scripts\python.exe -m pytest -q` | 537 passati, uno saltato, 130,41 secondi. Il caso Windows di symlink di directory rimane saltato; nessun modello reale. Un caso Python aggiunto. |
| `npm run typecheck` e `npm run build` | Superati; build Renderer, Main e Preload. |
| `node scripts/e2e/settingsBootstrap.mjs` | Superato: bootstrap, mancata scrittura reale, retry, reload e serializzazione. |
| `node scripts/e2e/settingsCloseDurability.mjs` | Superato sulla build finale: chiusura prima del debounce, writer reale rifiutato, finestra conservata, secondo tentativo e lettura del valore dopo riavvio. |
| `node scripts/e2e/documentRevisionRecovery.mjs` | Superato con Renderer, Monaco e Preload reali e servizio documenti deterministico nel Main: base obsoleta rifiutata, bozza preservata, scarto esplicito, reload e nuovo salvataggio con revisione corretta. Backend REST e LanceDB sono qualificati separatamente dalla suite Python. |
| `npm run quality:static` | Superato: 99 handler IPC e 838 file controllati, formattazione conforme. |
| `npm run docs:check` e `git diff --check` | Superati. |
| OpenAPI generato da `scripts/generate_openapi.py` con `ONLYRAG_DATA_DIR` temporaneo | Generato; il confronto con il contratto runtime passa nella suite Python completa. La connessione SQLite teneva aperto un file durante il cleanup: il residuo creato dalla prova è stato rimosso dopo l'uscita del processo. |

Il test del banner salva immagini in `test-results/flow-contracts-1792186275822/` per desktop 1920×1080, tablet 768×1024 e telefono 390×844. Il banner e le sue azioni restano nel viewport; le immagini sono state ispezionate. La vista ingestion preesistente lascia invece pannelli e parte della toolbar fuori vista ai due formati minori: il residuo è specificato nel task esistente `UX-FIRST-USE-SIMPLIFICATION-01`, senza attribuire al test una qualifica responsive dell'intera applicazione.

Decisione successiva del 17 ottobre 2026: il target è il solo desktop Windows. Il task citato sopra è stato ritirato, non completato; prove e rilievi tablet/telefono sono conservati come evidenze storiche fuori dal target attuale. Vedi il [riallineamento del perimetro](./verification-current.md#perimetro-desktop--2026-10-17).

Tre tentativi iniziali della prova UI selezionavano la textarea IME readonly di Monaco anziché la superficie di modifica; il selettore e l'attesa del testo sono stati corretti. I profili falliti sono conservati in `%TEMP%/onlyrag-document-revision-8aeXqh`, `%TEMP%/onlyrag-document-revision-Xv0NgG` e `%TEMP%/onlyrag-document-revision-ukl5MU`. Non sono errori del salvataggio applicativo né prove omesse.

## Limiti e lavoro residuo

Le prove deterministiche qualificano contratti, stati e recupero nei casi dichiarati. Non qualificano modelli reali, qualità semantica, app installata, interruzione forzata o perdita di alimentazione. Un trasporto interrotto può lasciare un esito server ignoto: l'errore non viene trasformato in cancellazione confermata. I task esistenti `SETTINGS-CLOSE-DURABILITY-01` e `TRANSLATION-INPLACE-UNMOUNT-CANCELLATION-01` mantengono queste qualifiche ulteriori; non sono stati duplicati o dichiarati conclusi.
