# Completamento del tracker locale — 21 ottobre 2026

Seguito successivo: [API FTS e stato aggiornato del tracker](./verification-fts-api-2026-10-21.md). La voce P3 FTS censita qui è stata poi completata e rimossa; restano due P2. I conteggi e le ricevute sotto descrivono questo lotto precedente.

Perimetro: dieci task autonomi presenti all'avvio, con criteri locali del tracker. Profili e documenti sintetici, risposte controllate, arresti dei soli processi posseduti. Nessun modello reale, dato personale, installer pubblico, commit o push. Il tracker mantiene soltanto attività aperte; ogni chiusura sotto richiede prove pertinenti.

Le verifiche usano una copia iniziale di sorgenti riletta SHA-256, aggiornata esplicitamente con le modifiche del task. Node 24.20.0/npm 11.19.0; dipendenze Node installate con `npm ci` nella copia. Python usa il venv di sviluppo preesistente tramite junction dichiarata, senza modificarne i pacchetti. Dati applicativi primari censiti prima delle prove e ricontrollati alla fine.

Evidenze e log: `C:/Users/Utente/OnlyRag-Live/tracker-completion-20261021-f7e270eb`. Fixture di benchmark, crash e profili conservate qui sono prove di verifica, non dati da migrare o residui da smaltire automaticamente.

## Risultati per attività

I risultati sono aggiunti dopo l'esecuzione e prima della rimozione della rispettiva attività dal tracker.

### RAG-INDEX-METADATA-EFFICIENCY-01 — completato

Eseguito `retrievalEfficiency.py --label after --chunks <10000|100000> --dimension <768|1024> --samples 20 --varied --contention --p95-limit-ms 5000`. Quattro root nuove, vettori densi e testo multilingue variati, quattro lettori e venti scritture native per combinazione. p95 dei terminali in contesa: 428/675 ms su 10k, 2336/2951 ms su 100k; writer p95 massimo 2222 ms. Ogni combinazione passa il limite di 5000 ms. Conflitti espliciti rispettivamente 39/37/34/29 su 80 richieste, distinti dai successi.

Tutti i successi preservano risultati ordinati e provenienza; navigazione e coda non indicizzata passano. Confronto completo dei record in ordine canonico e degli archivi dopo ripristino del metadato: identici in tutte le combinazioni. Ricevute `onlyrag-retrieval-after-*/report.json`, `complete=true`. Nessuna modifica al runtime RAG o qualifica encoder/installato. Il warning API FTS deprecata viene conservato come residuo distinto.

### STATE-WRITER-CRASH-DURABILITY-01 — completato

`node scripts/e2e/stateWriterCrashDurability.mjs`: 24 tagli di processi posseduti, Node ed Electron, quattro nomi di stato e tre confini: staging già flushato, sostituzione conclusa prima dell'ack, ack ricevuto. Il runner usa il writer reale traspilato e riapre ogni file in un processo nuovo. Prima della sostituzione il canonico resta esatto e lo staging completo resta recuperabile separatamente; dopo sostituzione il nuovo contenuto è esatto, ma viene dichiarato confermato soltanto nel caso con ack. Nessuna promozione automatica di temporanei non confermati.

Le nove regressioni `safeAtomicFileWriter.test.ts` passano: ordine seriale, flush rifiutato, errori di sostituzione/cleanup, ritentativi Windows e liberazione code. Ricevuta `state-writer-crash-*/result.json`. Questa prova riguarda interruzione di processo e byte leggibili al riavvio; non persistenza dei metadati di directory o perdita di alimentazione.

### RAG-EMBEDDING-REBUILD-QUALIFICATION-01 — completato

`python -m pytest sidecar/tests/test_store_rebuild.py -q --junitxml=../rebuild.xml`: 48 passati, nessuno saltato. Aggiunti sette confini di interruzione dei soli processi posseduti su uno store non vuoto con schema nativo corrente, metadati encoder completi e vettori controllati. Copia backup, manifest prima/dopo pubblicazione, attivazione prima/dopo sostituzione e rollback prima/dopo sostituzione mantengono stato attivo veritiero e backup. Il confronto completo delle tabelle originali dopo recupero/rollback resta identico.

Passano inoltre readback e hash degli archivi, esclusione dei lease, CLI contro encoder loopback controllato, attivazione esplicita, rifiuto di digest/provenienza incoerenti, revisione concorrente, junction reali e puntatori invalidi. Le fixture legacy preesistenti restano regressioni separate: nessuna migrazione applicativa nuova e nessun archivio personale convertito. Ricevute `rebuild.log` e `rebuild.xml`; non è una prova di encoder reale o perdita di alimentazione.

### CHAT-DURABLE-HISTORY-01 — completato

`chatDraftRecovery.mjs` sul bundle corrente, Main/Preload/Renderer reali e risposte IPC controllate, passa a 1024×720 e 1920×1080. Domanda e risposta parziale confermate su disco precedono l'arresto forzato del solo albero Electron posseduto. Al nuovo avvio identità, mittenti, testi e contesto documentale coincidono; la risposta interrotta resta dichiarata incompleta.

Un percorso canonico reso directory causa un errore filesystem reale: la chiusura viene rifiutata, la revisione confermata resta nella copia trattenuta, una nuova domanda rimane in memoria. Riparazione della fixture, azione Riprova e nuovo riavvio confermano la domanda esatta. Passano anche le regressioni repository/hook su conflitti e archivi illeggibili. Ricevute `chat-draft-native-final.log`, `onlyrag-chat-drafts-*/result.json` (`complete=true`) e `recovery-targeted.json` (85 test complessivi di recupero/traduzione). Non vengono assimilati delta non confermati a dati salvati; nessuna perdita di alimentazione o modello reale.

### DOC-EDITOR-DRAFT-DURABILITY-01 — completato

Lo stesso runner nativo conserva la bozza esatta attraverso arresto e nuovo avvio su una revisione canonica concorrente: `expectedRevision=t1` resta invariata davanti al documento `t2`, salvataggio rifiutato senza rebase. Una seconda modifica con archivio non scrivibile rifiuta la chiusura. Export Markdown attraverso Main/Preload reali salva esattamente `# Newer draft`, lasciando irrisolto l'errore canonico; Riprova e riavvio rileggono il contenuto con revisione originale `t1`.

Le regressioni repository e hook verificano inoltre bozze multiple, montaggio nuovo, snapshot concorrenti, write seriali, backup assente/illeggibile, rifiuto di duplicati e preservazione di byte/backup non leggibili. Profili sintetici finali e JSON di readback conservati come evidenze. Nessuna verifica Word, profilo personale, installazione o perdita di alimentazione. Due tentativi iniziali del runner sono conservati: uno attendeva Stop già scomparso, l'altro incontrava la riprova debounced prima del clic. Il runner ora esaurisce il debounce con storage ancora rifiutato prima della riprova esplicita.

### TRANSLATION-INPLACE-UNMOUNT-CANCELLATION-01 — completato

Regressioni degli hook: Stop prima del primo progresso, identità prenotata prima del dispatch, unmount, lock mantenuto fino al terminale, rifiuto dell'annullamento distinto dal terminale. Aggiunti PDF e DOCX con perdita di trasporto: errore esplicito, nessun falso successo/cancelled, lock liberato solo alla conclusione IPC, eventi tardivi della vecchia identità ignorati. Ricevuta `recovery-targeted.json`.

Suite Python di traduzione: `test_translator.py`, `test_translation_output.py`, `test_translation_docx_coverage.py`, 200 passati senza skip, ricevuta `translation.xml`. La cancellazione cooperativa usa entrambi i file sintetici reali PDF/DOCX e risposte di traduzione controllate: terminale cancelled con task ID corretto, nessun done, originale e output precedente byte-identici, nessun output nuovo. Le regressioni di pubblicazione coprono errori e collisioni. Non certifica un modello reale, Word, resa visiva generale o un installer.

### AGENT-NETWORK-LIVE-01 — completato

`network-final2.json`: 67 regressioni passate su WebClient, servizio agente e policy URL/DNS. Il nuovo gruppo usa socket HTTP e filesystem reali; il solo routing di `fixture.invalid` viene diretto al server loopback posseduto, lasciando attive le policy applicative. Risoluzione nativa di localhost rifiutata separatamente. Coperti successo/fetch, redirect, indisponibilità, limiti redirect e rifiuto verso rete privata, MIME/status, traversal, annullamento con staging realmente scritto, cleanup prima dell'esito e provenienza URL/SHA-256.

Difetto emerso e corretto: un MIME incoerente distruggeva il file precedente dopo l'apertura diretta della destinazione. La regressione eseguita sui byte originali di HEAD fallisce perché il file non esiste più (`network-before.json`); sul fix passa. Ora il download usa staging casuale esclusivo con flush, chiusura e nuovo controllo del percorso prima della sostituzione finale. Fallimenti/annullamento eliminano soltanto lo staging posseduto e preservano la destinazione. Un rifiuto nativo di pubblicazione preserva la directory con sentinella. Eventi tardivi non cancellano il file sostitutivo. Nessun servizio pubblico interrogato dalle prove, nessun prompt inviato e nessuna modifica ai confini Full access.

### DEPENDENCY-VITE-WINDOWS-EDITOR-01 — completato

Aggiornati manifest, lock e installazione del checkout da Vite 8.2.2 a **8.2.4**, con intervallo `~8.2.4` per conservare la linea patch verificata. L'[advisory primario del manutentore](https://github.com/vitejs/launch-editor/security/advisories/GHSA-698v-4r3x-3vcv) indica 8.2.0–8.2.3 come interessate e 8.2.4 come corretta. Node 24.20.0 soddisfa i requisiti della release. `npm ci` nella copia nuova passa; `npm audit --json` riporta zero segnalazioni e l'albero risolve Vite 8.2.4 e il fork braces 3.0.4+onlyrag.1.

`viteEditorWindows.mjs` avvia Vite reale su loopback e un editor Windows posseduto: il file ordinario con spazi arriva esattamente al processo; un file con percentuale/ampersand è rifiutato dalla patch prima di una nuova apertura, senza espansione della variabile. Prima due tentativi del runner avevano un helper con newline non escapato e una stringa editor malformata; conservati i diagnostici, corretto il runner con wrapper `.cmd` posseduto. La ricevuta finale `vite-editor-59f313bc-e3d8-4997-a550-6b238fc1cd8f/report.json` è completa. Passano anche 25 casi dev-server, suite frontend/backend finali, build e smoke Main. Nessuna modifica a guardie loopback/proprietario, fork braces, dipendenze Python o impostazioni personali; nessuna chiusura remota di advisory o release installer.

Il confronto finale trova nella root metadati npm/`npm ls` a 8.2.4 ma `require('vite/package.json').version` ancora a 8.2.2, nonostante `npm install` dichiarasse up to date. Conservati entrambi i readback; eseguito `npm ci` nel checkout per ricreare l'albero. La verifica finale confronta la versione del pacchetto effettivo con quella della copia pulita: il solo lock o il riepilogo npm non sono prova dei byte installati. Nessuna modifica manuale ai sorgenti di `node_modules`.

## Attività ancora aperte e residui

- `DEPENDENCY-BRACES-UPSTREAM-01`: il registro primario `https://registry.npmjs.org/braces/latest`, interrogato con `npm view braces version --json`, pubblica ancora 3.0.3. Il fork 3.0.4+onlyrag.1 resta installato; nessuna candidata upstream qualificabile. La chiusura richiede una release disponibile e i gate originali. Ricevute `braces-registry.json`, `dependency-tree.json` e successivo audit locale; non si dichiara corretto upstream.
- `DEVSERVER-LOOPBACK-PROBE-STABILITY-01`: `node scripts/e2e/managedDevServerDiagnostics.mjs 5` passa 25 casi nativi con Vite 8.2.4, socket/listener/PID, rifiuto wildcard IPv4/IPv6, readiness e self-connect controllato. Il rifiuto storico non si riproduce: la causa resta indeterminata e le guardie non cambiano. Ricevute `managed-dev.log` e `managed-dev-diagnostics-*/report.json`; nessun server posseduto resta attivo.
- `RAG-FTS-INDEX-API-01`, nuovo P3: LanceDB 0.37.1 emette un warning per `create_fts_index`, deprecata in favore di `create_index` con configurazione FTS. Il warning era annotato nel task RAG ora concluso; viene mantenuto come attività distinta con parità di configurazione, ranking, coda non indicizzata e indici esistenti da verificare. Nessun malfunzionamento nei benchmark e nessuna migrazione dell'API in questo lotto.

Le prove storiche e i residui di pulizia già rifiutata restano protetti secondo la policy locale. Non vengono riattivati i task ritirati. I nuovi tentativi falliti dei runner sono diagnostici intenzionalmente conservati nella root esterna; non richiedono modifiche ai dati personali.

## Verifiche trasversali

Prima esecuzione TypeScript completa: 2988 passati e un fallimento perché il test Git usava `process.cwd()` in una copia senza `.git`. Corretto il test, che ora crea un repository nella propria directory temporanea e verifica anche il nome del file non tracciato; i suoi 82 casi passano. Nessun Git applicativo modificato e nessun commit nel checkout. La seconda suite completa è registrata nelle ricevute finali.

Python completo: 674 passati e un caso saltato per symlink di directory non disponibile sull'host; gate critico 15 passati, nessuno saltato. Il venv è quello esterno di sviluppo già presente, collegato nella copia; il `.venv` applicativo non contiene pytest. Nessun pacchetto Python installato per questa verifica.

Suite TypeScript finale: **2989 passati, 327 file, nessuno saltato o fallito** (`typescript-final.json`). Typecheck, statico (886 file), Knip normale/produzione, cicli, build e smoke Main passano. Le successive modifiche al runner nativo chat aggiungono readback dell'intera revisione da un processo nuovo e confronto completo dopo bootstrap: passano entrambe le dimensioni (`chat-draft-exact-final2.log`). Sono ammessi soltanto i flag di recupero della risposta interrotta e il timestamp UI della conversazione riaperta; tutti gli altri campi restano identici. Nessun runtime modificato dopo i gate completi.

Esito del tracker: **8 dei 10 task iniziali completati e rimossi; 3 aperti**, inclusa la voce P3 FTS conservata separatamente. Documentazione e dossier aggiornati dopo ogni completamento, Sync senza segnalazioni; nessun commit o push. Riepilogo finale, manifesti sorgenti e confronto dei 147 file protetti in `final-receipt.json` e `final-source-correspondence.json` nella root evidenze. I risultati precedenti falliti restano distinti dai gate finali.
