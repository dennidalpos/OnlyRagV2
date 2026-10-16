# Verifiche offline — 16 ottobre 2026

Completato `TEST-WEB-DOWNLOAD-STREAM-FAILURE-01` nel perimetro offline autorizzato. Le modifiche preesistenti a `AGENTS.md`, `.continue/` e `CLAUDE.md` sono conservate. Il tracker rimuove soltanto questo task; il prossimo P1 autonomo è `TEST-RECOVERY-BANNERS-01`.

## Guasti riprodotti e correzione

Due nuovi test contro il codice precedente hanno riprodotto errori asincroni di apertura (`EACCES`) e scrittura (`ENOSPC`) attraverso veri `fs.WriteStream` con operazioni filesystem iniettate. Entrambi lasciavano il download sospeso: con timeout di prova di un secondo, Vitest riportava due test falliti e due eccezioni non gestite.

`WebClient.downloadFile` gestisce ora gli errori di richiesta, risposta e file con un solo esito terminale. Su errore o cancellazione chiude le risorse e attende la chiusura del descrittore prima di eliminare il file parziale e restituire il risultato. Il successo richiede scrittura completata e file chiuso. Un errore di eliminazione viene riportato nel risultato invece di essere soltanto registrato nel log.

Il file viene aperto dopo i controlli sulla risposta HTTP e sul MIME dichiarato. I redirect chiudono il tentativo precedente e ne rimuovono il listener di cancellazione prima del passaggio al successivo; ogni destinazione mantiene i controlli di protocollo, rete pubblica e numero massimo di redirect. Un URL di redirect malformato produce un risultato di fallimento. Eventi tardivi di tentativi già terminati non possono riaprire o cancellare la destinazione.

## Verifiche

Il file `webClient.test.ts` passa 28 test, di cui 13 nuovi. I nuovi casi comprendono apertura e scrittura fallite, cancellazione durante una scrittura ancora pendente con errore tardivo, risposta successiva alla cancellazione, redirect completati o cancellati, errori tardivi dopo un nuovo salvataggio, risposta interrotta e redirect rifiutati senza modificare un file preesistente. I controlli non richiedono eccezioni alla gestione degli errori di Vitest.

Due casi usano un server HTTP reale su `127.0.0.1` con porta assegnata dal sistema: redirect relativo seguito da download completo oppure disconnessione durante il trasferimento. L'accesso locale esplicito è limitato a questi fixture, con directory temporanee isolate; la policy ordinaria resta verificata separatamente.

| Comando | Esito |
| --- | --- |
| `npx vitest run electron/core/infrastructure/http/webClient.test.ts electron/core/infrastructure/http/networkAddressPolicy.test.ts electron/core/application/webToolService.test.ts electron/core/application/workspaceAppService.test.ts` | Exit 0: 64 test superati in quattro file. |
| `npm run test -- --silent=true` | Exit 0: 2.737 test superati in tutti i 314 file, in 164,91 secondi; nessun errore non gestito segnalato. |
| `npm run typecheck` | Exit 0. |
| `npm run quality:static` | Exit 0: 99 handler IPC, confini architetturali, lint e formato di 831 file. |
| `npm run docs:check` e `git diff --check` | Exit 0: 57 documenti validati e nessun errore di whitespace. |

Il dossier SecondBrain è stato aggiornato con la regola sul ciclo di vita dei download, usando la sessione Write registrata e le primitive di scrittura con guard, backup e readback. Nessuno snapshot o blocco di direttive distribuite è stato modificato manualmente. Il diff finale comprende soltanto implementazione e test WebClient, rimozione del task completato, questa ricevuta e il suo collegamento nell'indice delle evidenze.

## Fonti e limiti

Runtime delle prove: Node 24.20.0 e Vitest 4.1.11. Fonti ufficiali della versione Node effettivamente eseguita: [errori degli stream Writable](https://nodejs.org/download/release/v24.20.0/docs/api/stream.html#event-error), [autoClose, eventi e operazioni filesystem di createWriteStream](https://nodejs.org/download/release/v24.20.0/docs/api/fs.html#fscreatewritestreampath-options), [ciclo di vita HTTP ClientRequest](https://nodejs.org/download/release/v24.20.0/docs/api/http.html#class-httpclientrequest).

Le prove qualificano il codice sorgente con filesystem e HTTP locali. Non qualificano disponibilità di siti pubblici, app installata, interfaccia responsive, perdita di alimentazione o guasti hardware reali. Se il filesystem rifiuta anche l'eliminazione del parziale, il risultato espone il problema; non è possibile garantirne la rimozione in quel caso. La suite Python non è stata ripetuta: il Sidecar non è modificato e non è richiesto un commit. Nessuna chiamata a modelli reali, installazione, modifica di dati personali, commit o push.

## Banner di recupero dello storico e delle cancellazioni

Completato nel passaggio successivo `TEST-RECOVERY-BANNERS-01`, senza modificare i componenti di produzione. Aggiunti 17 test per `CodingHistoryRecoveryBanner` e 27 per `SessionDeletionRecoveryBanner`: montano i componenti e il provider i18n reali in happy-dom, usando mock tipizzati dell'API Preload. Ogni test smonta la root, rimuove il contenitore e ripristina il descrittore originale di `window.electronAPI`.

I casi verificano elenco vuoto o fallito, retry e ripristino riconosciuti, rifiuti con o senza dettaglio, errori IPC e del dialogo, esportazione riuscita/fallita/annullata, disponibilità dei pulsanti e assenza di false conferme. L'export dello storico non richiama `onRecovered`; una copia esportata di una cancellazione ancora pendente non richiama `onResolved`. I callback di risoluzione verificano esattamente gli ID di sessione coinvolti.

Sono coperti anche i quattro stati di cancellazione (`pending`, `restoring`, `complete`, `incomplete`), l'export consentito per una preparazione incompleta, il blocco delle altre azioni e della paginazione durante un'operazione, la selezione asincrona della cartella, gli errori di refresh, la paginazione e i risultati obsoleti dopo un nuovo caricamento. Le Promise controllate verificano i periodi di attesa senza introdurre pause arbitrarie.

Copertura V8 misurata soltanto sui due file di produzione, senza cambiare configurazione o soglie del repository:

| Componente | Righe | Funzioni | Rami |
| --- | --- | --- | --- |
| `CodingHistoryRecoveryBanner.tsx` | 37/37 (100%) | 10/10 (100%) | 35/37 (94,59%) |
| `SessionDeletionRecoveryBanner.tsx` | 57/57 (100%) | 13/13 (100%) | 47/50 (94%) |
| Totale dei due componenti | 94/94 (100%) | 23/23 (100%) | 82/87 (94,25%) |

I cinque rami residui riguardano i ritorni difensivi quando mancano metodi del bridge IPC. La copertura non è presentata come completa per quei casi.

Comandi eseguiti, tutti con exit code 0:

- `npx vitest run src/components/coding/CodingHistoryRecoveryBanner.test.tsx src/components/coding/SessionDeletionRecoveryBanner.test.tsx`: 44 test in due file.
- `npx vitest run src/components/coding/CodingHistoryRecoveryBanner.test.tsx src/components/coding/SessionDeletionRecoveryBanner.test.tsx --coverage --coverage.include=src/components/coding/CodingHistoryRecoveryBanner.tsx --coverage.include=src/components/coding/SessionDeletionRecoveryBanner.tsx --coverage.reportsDirectory=coverage/recovery-banners --coverage.reporter=text --coverage.reporter=json-summary`: 44 test, misure riportate sopra; 108/112 statement (96,42%). Report locale in `coverage/recovery-banners/coverage-summary.json`, ignorato da Git.
- `npx vitest run src/components/coding/CodingHistoryRecoveryBanner.test.tsx src/components/coding/SessionDeletionRecoveryBanner.test.tsx src/components/coding/CodingStorageFailureBanner.test.tsx src/hooks/useSessionHistory.test.tsx electron/core/infrastructure/filesystem/sessionHistoryRecoveryJournal.test.ts electron/core/application/sessionHistoryAppService.test.ts electron/core/application/sessionDeletionRecovery.integration.test.ts`: 90 test superati in sette file.
- `npm run typecheck`: superato.
- `npm run quality:static`: 99 handler IPC, confini architetturali, lint e formato di 833 file verificati.
- `npm run docs:check` e `git diff --check`: documentazione e whitespace verificati.

Versioni da lockfile: React e React DOM 19.2.8, Vitest e provider V8 4.1.11. Fonti ufficiali: [React, uso asincrono di act](https://react.dev/reference/react/act), verificato anche nell'[implementazione del tag 19.2.8](https://github.com/facebook/react/blob/v19.2.8/packages/react/src/ReactAct.js); [Vitest, copertura nel tag 4.1.11](https://github.com/vitest-dev/vitest/blob/v4.1.11/docs/guide/coverage.md). La pagina React corrente si riferisce alla versione 19.3; il tag e l'esecuzione locale forniscono il riscontro per la versione installata.

La prova verifica comportamento renderer e payload al confine IPC, con regressioni esistenti per hook, journal e servizi Main. Non qualifica un dialogo nativo reale, l'app Electron installata, il layout responsive o tecnologie assistive. Essendo un'aggiunta di test e documentazione senza cambiamenti di produzione, le suite applicative complete e Python non sono state ripetute in questo passaggio. I risultati completi della sezione download restano riferiti al passaggio precedente.

Il tracker rimuove soltanto il P1 completato, conserva 48 task aperti con ID unici e propone come prossimo intervento offline `TEST-MANAGED-VITE-LOOPBACK-FLAKE-01`. Aggiornato il dossier SecondBrain con la distinzione verificata tra esportazione e recupero riconosciuto. Le modifiche dei passaggi precedenti e le direttive preesistenti sono preservate; nessun commit, push, modello reale o dato personale interessato.

## Consegna e autorizzazione di commit e push

Nella revisione finale della consegna sono passati `npm run test -- --silent=true` (2.781 test in 316 file, 170,73 secondi), `.venv/Scripts/python.exe -m pytest -q` (518 test superati e uno saltato, 127,85 secondi), `npm run build` (compilazione TypeScript e bundle Renderer/Main/Preload), `npm run quality:static`, `npm run docs:check` (57 documenti) e `git diff --check`, tutti con exit code 0. I sette file pertinenti sono rimasti invariati durante tali verifiche, con confronto SHA-256.

L'utente ha poi richiesto esplicitamente commit e push. Nuovo confronto SHA-256 prima del commit: tutti i sette file corrispondono allo stato verificato; da allora è aggiunta soltanto questa ricevuta documentale, senza ripetere inutilmente le suite applicative. Destinazione verificata: repository pubblico `dennidalpos/OnlyRagV2`, remoto `origin`, ramo locale e remoto `master`. Il fetch conferma un commit locale precedente ancora da pubblicare (`63226f8`), già segnalato all'utente e incluso nel push richiesto insieme al nuovo commit.

Il nuovo commit comprende solo implementazione e test WebClient, i due test renderer dei banner, tracker, indice delle evidenze e questa ricevuta: sette file. Le modifiche preesistenti a `AGENTS.md` e `.continue/` restano escluse. La scansione mirata dei file della consegna e del commit precedente non rileva indicatori di credenziali; non equivale a una certificazione di sicurezza. Gli esiti di commit, push e confronto dell'HEAD remoto sono riportati nella risposta conclusiva, dopo l'esecuzione.

## Preview Vite gestita e sonde TCP

Indagine di `TEST-MANAGED-VITE-LOOPBACK-FLAKE-01`, primo P2 autonomo del tracker. Modifiche circoscritte a `managedDevServerRepository.ts` e ai suoi test, senza dipendenze o configurazioni applicative nuove. Runtime verificati: Windows, Node 24.20.0, Vite 8.2.2 e Vitest 4.1.11.

### Evidenze e correzioni

Il file originale di cinque test passa una volta come baseline e altre otto volte con diagnostica aggiunta, ciascuna in workspace nuovi. Una campagna separata compila il modulo originale senza modificarne la logica ed esegue 30 avvii/probe/stop di Vite: tutti passano e tutte le ricevute `httpServer.address()` riportano `127.0.0.1`. Nessuna di queste ripetizioni riproduce spontaneamente il rifiuto storico su `127.0.0.2`.

Un riproduttore deterministico forza soltanto indirizzo e porta sorgente della connessione TCP a `127.0.0.2` a coincidere con la destinazione. Socket, evento `connect`, processo npm/Vite e tabella TCP sono reali. Il modulo originale rifiuta l'avvio con lo stesso messaggio del caso storico, benché Vite sia confinato correttamente. Rilevazione precedente alla chiusura dei processi:

```text
127.0.0.1:63239 -> 0.0.0.0:0       LISTENING    PID Vite 31820
127.0.0.2:63239 -> 127.0.0.2:63239 ESTABLISHED  PID sonda 25192
```

La sonda originale considera ogni evento `connect` prova di un listener. Ora confronta entrambi gli endpoint prima di chiudere il socket: indirizzo e porta identici indicano un'autoconnessione e producono `false`. Il confronto con il modulo corretto passa: listener Vite `127.0.0.1:63255`, autoconnessione reale a `127.0.0.2:63255` esclusa, risposta HTTP 200. Il riproduttore dimostra un difetto della sonda e la correzione; non dimostra retroattivamente quale tupla fosse presente nel fallimento del 15 ottobre, privo di questa diagnostica.

La prima suite completa, dopo tale correzione, rileva un secondo errore nel caso ordinario: 2.799 test passati e uno fallito, exit 1. Una connessione reale a `127.0.0.1:63351` riesce e Vite registra quel listener; la sonda immediatamente successiva fallisce. `start()` dichiara allora scaduti 15.000 ms dopo soli 702 ms di test. Il codice eseguiva infatti due controlli consecutivi di readiness, scartando il primo successo. La regressione mirata forza una connessione nativa rifiutata solo per l'eventuale controllo ridondante e riproduce il messaggio errato prima della correzione, exit 1. Ora il ciclo conserva il primo successo e distingue l'effettivo esaurimento della deadline; non aumenta timeout né introduce retry sul rifiuto di esposizione.

Il fixture Vite conserva su fallimento il workspace, la ricevuta con indirizzo/PID e la diagnostica delle connessioni. Su un `connect` a `127.0.0.2` cattura subito le righe TCP della sola porta interessata. `netstat.exe` viene risolto da `SystemRoot/System32`, senza ricerca di un binario npm; un errore della raccolta viene riportato come diagnostica indisponibile. Ogni errore di avvio include l'output già limitato a 4.000 caratteri del processo gestito. Rimangono verificati il rifiuto dei bind wildcard IPv4 `0.0.0.0` e IPv6 `::`, la porta assegnata, l'isolamento tra workspace e la chiusura del solo processo posseduto.

### Comandi, ricevute e limiti

Le ricevute locali sono conservate in `.system_generated/managed-vite-loopback-2026-10-16/`, escluso da Git: baseline e otto log diagnostici, `stress.jsonl`, confronto `original-regression.json`/`corrected-regression.json`, primo fallimento completo e regressione negativa della readiness. I workspace falliti e quelli della campagna diagnostica sono conservati; nessuna evidenza preesistente è stata eliminata. I test permanenti contengono i riproduttori nativi ripetibili.

| Comando | Exit code | Esito |
| --- | --- | --- |
| `npx vitest run electron/core/infrastructure/process/managedDevServerRepository.test.ts` — baseline e otto ripetizioni diagnostiche | 0 ciascuno | Cinque test per esecuzione; nessun rifiuto spontaneo su `127.0.0.2`. |
| `node .system_generated/managed-vite-loopback-2026-10-16/stress.mjs` | 0 | 30 workspace nuovi; avvio, HTTP e stop con modulo originale; tutti i bind a `127.0.0.1`. |
| `node .system_generated/managed-vite-loopback-2026-10-16/regression-before-after.mjs` | 0 | Confronto originale/corretto: falso rifiuto con autoconnessione reale, poi HTTP 200; indirizzi verificati tramite ricevuta Vite e tabella TCP. |
| `npm run test -- --silent=true` — primo passaggio | 1 | 2.799 passati, uno fallito in 317 file, 196,62 s; individuata la doppia sonda di readiness. |
| `npx vitest run electron/core/infrastructure/process/managedDevServerRepository.test.ts -t 'single readiness success' --reporter=verbose` — prima della correzione della readiness | 1 atteso | Regressione negativa: un test fallito e otto esclusi dal filtro; falso timeout dopo una readiness già positiva. |
| `npx vitest run electron/core/infrastructure/process/managedDevServerRepository.test.ts --reporter=verbose` — codice finale | 0 | Nove test superati, 27,99 s; entrambi i casi Windows nativi realmente eseguiti, nessun test saltato. |
| `npm run test -- --silent=true` — codice finale | 0 | 2.801 test superati in tutti i 317 file, 191,14 s; nessun test applicativo escluso. |
| `npm run typecheck` | 0 | TypeScript senza emissione sul codice finale. |
| `npm run quality:static` | 0 | 99 handler IPC, confini architetturali e 834 file verificati; nessuna riscrittura. |
| `npm run audit:deadcode` — dopo risoluzione del binario di sistema | 0 | Entrambe le modalità Knip passate, senza esclusioni nuove. |
| `npm run docs:check` e `git diff --check` | 0 | 58 documenti validati e whitespace verificato. |

Il primo `npm run audit:deadcode` segnala il comando nudo `netstat` come binario npm non dichiarato, exit 1. Corretto il riferimento all'eseguibile di sistema assoluto; la successiva esecuzione di entrambe le modalità Knip passa, exit 0, senza aggiungere esclusioni.

Fonti primarie allineate alle versioni effettive: [Node 24.20.0, connessione TCP ed endpoint locali/remoti](https://nodejs.org/download/release/v24.20.0/docs/api/net.html#socketconnectoptions-connectlistener), [Node 24.20.0, timeout e chiusura esplicita del socket](https://nodejs.org/download/release/v24.20.0/docs/api/net.html#socketsettimeouttimeout-callback), [Vite 8.2.2, host e strictPort](https://github.com/vitejs/vite/blob/v8.2.2/docs/config/server-options.md), [Vite 8.2.2, configureServer del plugin diagnostico](https://github.com/vitejs/vite/blob/v8.2.2/docs/guide/api-plugin.md#configureserver). Le fonti descrivono le API; l'autoconnessione e la race di readiness sono evidenze delle prove locali, non garanzie attribuite alla documentazione.

Le prove qualificano workspace isolati e processi locali. La specifica autoconnessione nativa viene esercitata su Windows; su altre piattaforme il relativo caso è esplicitamente saltato. Non qualificano app installata, disponibilità LAN, modelli reali, dati personali o comportamento in ogni condizione di rete. La suite Python non viene ripetuta perché il Sidecar non cambia e non è richiesto un commit. Le modifiche estranee a `AGENTS.md` e `.continue/` restano preservate; nessun commit o push in questo passaggio. Dossier SecondBrain consultato con sessione Read registrata, senza scritture nell'archivio.

Il tracker rimuove soltanto `TEST-MANAGED-VITE-LOOPBACK-FLAKE-01`: indagine, correzioni della sonda, regressioni native e suite completa concluse. Conserva 46 task aperti con ID unici e lo schema originale; il prossimo autonomo è `TEST-SOURCE-PDF-RENDER-BUDGET-01`. La chiusura riguarda i difetti riprodotti e verificati, senza attribuire al singolo evento storico una tupla non registrata. Diff finale rivisto; nessun indicatore comune di credenziali rilevato nei file pertinenti. La sessione SecondBrain Read è stata chiusa.

## Budget di rendering delle pagine PDF originali

L'utente ha autorizzato di salvare il piano e procedere con `TEST-SOURCE-PDF-RENDER-BUDGET-01`. Il piano è stato prima registrato nel campo `verify` del task esistente: PDF reale sovradimensionato in archivio isolato, rifiuto esplicito prima di `Page.get_pixmap`, integrità byte per byte dell'originale del chiamante e dell'archivio conservato, caso PDF ordinario ancora funzionante, ricevuta delle verifiche e rimozione del solo task dopo il completamento dei criteri.

Il limite di produzione era già presente e non è stato modificato. Aggiunti due casi parametrizzati a `sidecar/tests/test_source_provenance.py`: pagine reali di 3.000 × 2.400 e 2.400 × 3.000 punti, equivalenti a 20 milioni di pixel a 120 dpi, oltre il limite di 16 milioni. Ingestione, file originali, estrazione e tabelle LanceDB sono reali e isolati; gli embedding usano il fixture deterministico esistente senza chiamare modelli.

Ogni caso verifica provenienza originale e numero di pagina, quindi sostituisce solo `Page.get_pixmap` con una sonda che fallirebbe immediatamente se chiamata. Il resolver deve sollevare `ValueError` con il messaggio esatto `Original page exceeds its rendering budget.`; l'endpoint REST deve restituire 404 con lo stesso dettaglio. La sonda non viene chiamata: nessuna grande bitmap è allocata durante la prova del rifiuto. I byte dell'originale del chiamante e la mappa completa dei nomi e contenuti dei file nell'archivio devono rimanere identici. Il caso preesistente della seconda pagina PDF continua a produrre un PNG anche dopo la rimozione del file del chiamante.

Verifica mirata: `.venv/Scripts/python.exe -m pytest -q -rs sidecar/tests/test_source_provenance.py`, exit 0, 18 test superati e uno saltato in 4,54 secondi. Il test saltato riguarda i privilegi necessari per creare un symlink di directory; non costituisce qualifica della junction Windows e il relativo task rimane aperto.

Controllo negativo tramite `.venv/Scripts/python.exe -` e `pytest.main(..., -k oversized_pdf_source)`: un plugin di raccolta ricompila soltanto in memoria il resolver con il controllo di budget disabilitato. Entrambi i nuovi casi falliscono con `AssertionError: Oversized page must not be rendered`, exit pytest 1 atteso (due falliti e 17 esclusi, 2,66 secondi). Il comando di controllo restituisce 0 soltanto se osserva quell'exit code. Nessun sorgente su disco viene modificato e la sonda impedisce l'allocazione della bitmap anche nel controllo negativo.

Suite Python completa: `.venv/Scripts/python.exe -m pytest -q -rs`, exit 0, 520 test superati e lo stesso unico test symlink saltato in 121,90 secondi. `npm run docs:check` valida 58 documenti; `git diff --check` passa. La suite JavaScript e la build non vengono ripetute in questo passaggio: cambia soltanto un file di test Python oltre a tracker e documentazione, senza modifiche al codice di produzione o commit richiesto.

Completato `TEST-SOURCE-PDF-RENDER-BUDGET-01`: il tracker rimuove soltanto questa voce rispetto all'inizio del passaggio e conserva 45 task con ID unici (27 autonomi, 18 da decisione utente), mantenendo lo schema. Il prossimo autonomo è `TEST-SOURCE-JUNCTION-WINDOWS-01`; non è stato implementato. Le modifiche preesistenti ad `AGENTS.md`, ai due file della preview gestita e a `memory.md` sono rimaste byte-identiche, con confronto SHA-256; preservati anche `.continue/` e i contenuti preesistenti delle ricevute e del tracker. Piano e criteri del task concluso restano in questa ricevuta, perché il tracker contiene soltanto lavoro aperto.

Fonti primarie della versione installata: [PyMuPDF 1.28.2, Page.get_pixmap e parametro dpi](https://github.com/pymupdf/PyMuPDF/blob/1.28.2/docs/page.rst). La soglia di 16 milioni di pixel è una policy locale, non una garanzia della libreria. Le prove qualificano il rifiuto della visualizzazione della fonte nel Sidecar sorgente, non il consumo di memoria di tutta l'ingestione, l'app installata o PDF arbitrari. Nessun modello reale, dato personale, installazione, commit o push coinvolto. Dossier SecondBrain consultato con sessione Read registrata, senza scritture nell'archivio.
