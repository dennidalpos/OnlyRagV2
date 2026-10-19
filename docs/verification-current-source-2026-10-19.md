# P03: qualifica del candidato corrente — 19 ottobre 2026

Selezionato il primo task autonomo prioritario, `DISTRIBUTION-CURRENT-SOURCE-QUALIFICATION-01` (P2). Nessun P1 autonomo aperto. Il task rimane **parzialmente verificato e aperto**: la sua documentazione include anche qualifica dei flussi e desktop riavviato sul medesimo artefatto, non soltanto corrispondenza dei file ([gate originali](./distribution-cpu-release.md#remaining-tracker-gates)). Nessun nuovo task o duplicato creato.

## Identità e recupero

- Sorgenti: checkout pulito `95752a01857707f9280ee2192c0598fa17122601`, principale `master`.
- Nuovo candidato: `release/cpu-20261018-220641-87a891b9`; la data nel nome è UTC. Il candidato preesistente `cpu-20261014-205040-fae7d51b` è conservato.
- Installer: `OnlyRag V2 Setup 1.0.0.exe`, 416.382.368 byte, SHA-256 `fd4e5f176cc1f5f8262025f8bff11382130775a172e194c5b61449543b7b708e`.
- Sorgente: `OnlyRag-1.0.0-source.zip`, SHA-256 `6cf5a7ff133c83572689b2e5460a6af80a9e2ce0a3daa9f1c69bec16e6f4e1c3`.
- Sidecar confezionato: SHA-256 `49df4d42498a9eb3723b958b702de42939ffd514b18ab12821a9c6c4ba83bac4`.
- Firma indipendente: `Get-AuthenticodeSignature` restituisce **NotSigned**. Il wrapper aveva riportato `Unverifiable`; il suo log è conservato, senza reinterpretare il messaggio di electron-builder «signing» come firma valida.

La [ricevuta JSON](./verification-current-source-2026-10-19.json) conserva conteggi, hash dei verificatori/log, moduli confrontati e limiti. Evidenze complete ed estrazioni sono in `%TEMP%/onlyrag-p03-source-519e4b2946c648bfb6bca92e06452ec6`. Il probe CPU conserva `qualification-6a079778/result.json` nel candidato. Il sorgente archiviato precede questa ricevuta e gli aggiornamenti del tracker: non viene presentato come contenente documentazione scritta dopo la build.

## Criteri verificati

| Verifica | Esito e limite |
| --- | --- |
| Build fresca `npm run package:win` | Exit 0: typecheck, Sidecar CPU, build Vite, smoke Main/IPC, sorgenti/notice e NSIS. Nessuna installazione o pubblicazione. |
| Rilettura sorgenti | Tutti i 1.111 file tracciati coincidono con manifest e ZIP; 72 file sorgente delle dipendenze, lock Python e manifest componenti riletti. Nessuna voce ZIP duplicata. |
| Estrazione indipendente dell'installer | 7-Zip estrae NSIS e `app-64.7z` senza eseguire il setup. Insieme dei path e SHA-256 di tutti i 3.589 file coincidono con `win-unpacked` e manifesto. |
| Notice | 914 file coincidono fra preparazione e payload estratto. Verificati i digest dichiarati; inventario ambiente di 69 distribuzioni Python e 711 pacchetti Node. È un superset di build, non una certificazione dei diritti. |
| Codice Python congelato | Confronto dei code object di tutti i 30 moduli applicativi presenti nel PYZ e dell'entrypoint `main`, compilati dagli stessi byte archiviati; normalizzati solo i nomi di file. Inclusi worker/reader XLS, Job Windows e provenienza/ricerca RAG. Non è una ricostruzione riproducibile delle dipendenze native. |
| ASAR | 54 file generati Renderer/Main/Preload coincidono con la build; 249 identità di pacchetto presenti nell'ASAR sono riconciliate, senza record componente mancanti per i pacchetti terzi. |
| Probe CPU esistente | Exit 0: OCR reale sorgente e frozen, avvio posseduto, autenticazione, export PDF Unicode, ingestione e ricerca fallback con Ollama volutamente indisponibile. Stato isolato, originali invariati e processo posseduto arrestato. |
| Recupero dell'app confezionata | Exit 0: eseguibile `win-unpacked/OnlyRag V2.exe`, finestre native 1024×720 e 1920×1080; interruzione, risposta incompleta, revisione originale, chiusura rifiutata su errore, retry e riavvio. Main/Preload/Renderer reali; servizi documento/generazione simulati e avvio Sidecar automatico escluso dal profilo E2E. |
| Parser/normalizzazione HTTP frozen | 29 test parametrizzati esistenti passati in 11,18 s: CSV, XLS/XLSX, Parquet, rifiuti avversari e guard di normalizzazione PDF. Server confezionato reale; risposte Ollama sintetiche su loopback, nessun modello reale. |
| Provenienza encoder frozen | Chunk con dimensione dichiarata 768 e digest fixture verificati; cambio digest rifiutato con HTTP 500 senza mutazioni delle tabelle, ripristino e ricerca riusciti. Non misura qualità o latenza di un encoder. |
| XLS frozen | Rifiuto denso al gate 8 MiB e, con opt-in, al budget 512 MiB; caso sparso alla coordinata 65.536×256 accettato, selezione di due fogli su dodici, rifiuto stringhe globali, timeout e ingestione successiva riuscita. Tabelle e archivi preesistenti identici; gli originali dei tentativi falliti restano conservati secondo il comportamento esistente. |
| Arresto del proprietario XLS | Worker figlio vivo identificato tramite PID/percorso e handle Win32; arresto del solo Sidecar posseduto, worker terminato entro 5 s, riavvio con documento confermato identico e nuova ingestione XLS riuscita. |
| Flusso desktop nativo | Main/Preload/Renderer confezionati avviano il proprio Sidecar via IPC di riavvio: 17 ingestioni, traduzione PDF/DOCX e rifiuto di output vuoti, chiusura e riapertura con rilettura esatta di tutti i documenti. Risposte modello sintetiche, profilo isolato E2E; avvio automatico escluso. |
| Full checks | `npm run test -- --reporter=dot --silent=true`: 2.890 passati, 320 file, 215,75 s, exit 0. `.venv\Scripts\python.exe -B -m pytest -q -rs --tb=short -p no:cacheprovider`: 583 passati, un symlink saltato, 186,18 s, exit 0; junction reale eseguita. |

Il probe confezionato deriva da `scripts/e2e/chatDraftRecovery.mjs`: cambiano soltanto risoluzione di Playwright, radice del checkout, eseguibile e argomenti di avvio; nessuna asserzione è eliminata. Gli script diagnostici sono esterni al checkout. Il primo lettore ASAR falliva perché passava separatori POSIX a un'API Windows: risolto con `path.normalize`, senza cambiare il candidato. Il tentativo iniziale è conservato; soltanto la verifica finale riuscita conta come evidenza.

### Misure e portata delle prove aggiuntive

Il controller sorgente, già confrontato con quello congelato, esercita il vero `sidecar.exe --xls-worker`; le prove HTTP esercitano anche il controller congelato. Picchi di commit misurati: 71.385.088 byte (piccolo), 521.142.272 (denso rifiutato), 82.001.920 (sparso), 187.748.352 (dodici fogli con due selezionati), 520.372.224 (stringhe globali rifiutate), tutti sotto 536.870.912 byte. Output massimo osservato 82.664 byte, sotto il limite di 32 MiB. Timeout forzato a 0,01 s con recupero successivo; l'iniezione di errore di assegnazione al Job e di output oltre limite resta verificata solo nei test sorgente.

Il flusso desktop usa gli IPC reali `restartSidecar`, `ingestFile`, `getIngestedDocument` e `translateDocumentInplace`. I 17 input comprendono PDF, DOCX, TSV, JSON e le 13 estensioni del ramo testo. Riletto indipendentemente il testo tradotto nei file PDF/DOCX; originali identici per SHA-256, risposta vuota rifiutata senza nuovi output e documenti identici dopo riapertura. Sono fixture minime per i percorsi dichiarati, non una matrice esaustiva di formati/layout né una prova semantica. La precedente prova CPU copre OCR reale; queste risposte di traduzione sono deterministiche.

Tentativi diagnostici conservati: il primo server fixture non dichiarava `/api/tags` (24 test passati, cinque rifiutati correttamente); il secondo osservatore cercava la provenienza nella tabella `documents` anziché `chunks`, dopo 29 test passati; la prima invocazione IPC ometteva `taskId` ed è stata rifiutata dallo schema runtime. Corretti solo gli helper esterni, senza alterare artefatto o asserzioni applicative. I risultati finali riusciti sono in `frozen-parser-verified`, `frozen-owner-crash` e `packaged-native-flow-verified`; i tentativi precedenti restano leggibili.

La [CI Windows del commit esatto 95752a0](https://github.com/dennidalpos/OnlyRagV2/actions/runs/39170618618) è conclusa con `success`. Qualifica lo snapshot sorgente, non l'installazione locale.

Versioni locali: Node 24.20.0, Python 3.13.15, PyInstaller 6.22.2, Electron 43.7.4, electron-builder 26.15.3, ONNX Runtime CPU 1.29.0. Consultate la [documentazione PyInstaller sugli archivi](https://pyinstaller.org/en/stable/advanced-topics.html) e la [configurazione electron-builder](https://www.electron.build/configuration/); la documentazione PyInstaller corrente dichiara 6.22.3, quindi non prova il comportamento di 6.22.2. Il confronto è eseguito con i lettori effettivamente installati nella build 6.22.2.

## Residui e stato del tracker

Restano avvio automatico di produzione e desktop installato/riavviato, recupero in quel contesto, carichi rappresentativi oltre i fixture dei parser, encoder/embedding e normalizzazione/traduzione con modelli reali sul medesimo artefatto. Il riavvio esplicito via IPC e le risposte sintetiche non certificano tali gate. Installazione e nuove chiamate ai modelli restano fuori dall'autorizzazione corrente; nessuna modifica a profili personali.

Aggiornate la voce selezionata e quella XLS collegata con risultati parziali e criteri residui, conservando ID e priorità P2; le altre 40 attività restano identiche. Restano 42 ID: 24 autonomi e 18 con decisione utente. Nessuna voce rimossa. Diritti/componenti, completezza legale dei sorgenti, pubblicazione, dimensioni prodotto e aggiornamento/rollback mantengono i propri task distinti. Non serve ripetere questa build se i sorgenti runtime da qualificare non sono cambiati.

Controlli finali: `npm run docs:check` passa su 68 pagine; `npm run quality:static` passa su 851 file e 103 handler IPC dopo riallineamento LF del tracker. `git diff --check` e confronto strutturale del tracker passano. La rilettura dopo tutti i probe conferma immutati installer, ZIP sorgente e tutti i 3.589 file del payload. Rivisti diff e `git status --ignored`; helper, fixture, estrazioni e log di qualifica sono fuori dal checkout, candidati ed evidenze precedenti preservati. Cache e dati preesistenti non sono stati rimossi.

I tre helper supplementari sono eseguiti con `.venv\Scripts\python.exe -B` dalla radice, usando i percorsi sotto la directory di evidenze dichiarata: `frozen_parser.py`, `frozen_owner_crash.py`, `packaged_native_flow.py`, tutti exit 0 nella prova finale. L'ultimo avvia anche il verificatore Node/Playwright esterno e rilegge i documenti prodotti. Le directory di output devono essere nuove; non sovrascrivere le prove conservate per ripetere il comando.

Nessuna modifica al codice applicativo, ai test o al workflow; nessun commit o push in questo lotto.

## Consolidamento autorizzato per pubblicazione — 19 ottobre 2026

La richiesta successiva autorizza commit e push della riconciliazione. Il codice applicativo rimane identico allo snapshot 95752a0: confrontati di nuovo i sorgenti con il manifesto della build e verificati tutti i 29 hash delle evidenze referenziate. Non sono ripetute build, installazione o campagne modello per questo aggiornamento documentale.

Tracker riconciliato: stessi 42 ID e priorità (24 autonomi/18 con decisione utente), nessuna attività rimossa o aggiunta. Oltre ai residui distribuzione/XLS, le descrizioni di chat, bozze e inventario delle evidenze recepiscono la qualifica confezionata già ottenuta. Cinque voci aggiornate rispetto al commit precedente, altre 37 identiche; note e schema preservati. Restano installazione/avvio automatico, modelli reali, finestre di guasto non provate e inventario dei candidati storici oltre quello corrente.

Gate pre-commit ripetuti: `npm run test -- --reporter=dot --silent=true`, 2.890 test in 320 file passati (188,73 s), exit 0; `.venv\Scripts\python.exe -B -m pytest -q -rs --tb=short -p no:cacheprovider`, 583 passati e un symlink saltato (152,12 s), exit 0, junction reale eseguita. Controlli documentali (68 pagine), statici (851 file/103 handler), schema del tracker e diff passati. Log, backup e ricevuta di riconciliazione conservati in `%TEMP%/onlyrag-p03-consolidation-6445924fb19644079eefa32f9a314a88`.

Fetch e inventario confermano il solo `master`, allineato a `origin/master`, un worktree e nessuna PR aperta. Nessun branch da integrare o rimuovere. Log delle suite e helper scritti fuori dal checkout; i due log applicativi generati dai test sono trasferiti in quella stessa directory esterna con readback SHA-256; cache e dati preesistenti, candidati e prove fallite conservati. Il dossier SecondBrain registra il consolidamento e il commit effettivamente pubblicato dopo la verifica del remoto; il nuovo run CI va distinto dal successo già verificato di 95752a0.
