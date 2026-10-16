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
