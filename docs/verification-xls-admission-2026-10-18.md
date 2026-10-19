# Ammissione XLS in processo Windows — 18 ottobre 2026

Lotto `XLS-PARSER-MEMORY-ADMISSION-01`, autorizzato con «procedi» dopo il lotto CI chat/bozze. Implementazione e qualifica nei sorgenti Windows; il task esistente conserva la qualifica frozen/desktop installato. Le modifiche locali del lotto CI sono preservate.

## Comportamento e confini

`ingestion.py` conserva il rifiuto sorgente XLS di 8 MiB in modalità normale. Tutte le letture XLS ammesse, comprese quelle con `allowFullExcelFormat`, passano ora a un processo dedicato. Il worker attende la richiesta su stdin con sole dipendenze standard; il servizio Python crea e configura un Job Windows, assegna il processo tramite il suo handle reale e solo dopo invia il percorso da elaborare. Import del parser, apertura del workbook, stringhe globali e materializzazione dei fogli avvengono nel worker ammesso. Se l'ammissione fallisce, la richiesta non viene inviata: nessun fallback al parser nel Sidecar.

- Budget dichiarato **512 MiB di commit** per worker: limiti Win32 per processo e Job a **496 MiB**, con 16 MiB riservati al conteggio di picco. Una prima prova con soglia Win32 512 MiB riportava un picco di 513 MiB; la riserva mantiene le misure dichiarate entro il budget. Non è un limite della memoria fisica totale dell'applicazione, degli input già ricevuti dal Sidecar o dei mapping condivisi.
- Un solo worker per processo Sidecar; attesa dello slot al massimo 5 secondi, poi errore esplicito con richiesta di riprovare. Un Job ammette un solo processo, non processi discendenti. BLAS e librerie correlate ricevono un solo thread nel worker.
- Timeout 60 secondi dall'invio della richiesta. Alla chiusura del Job vengono terminati i processi posseduti; viene atteso il segnale nativo di terminazione anche quando Python ha già un exit code. Questo evita il ritorno anticipato osservato nella prima prova di timeout.
- Richiesta interna limitata a 16 KiB e validata; risposta JSON UTF-8 limitata a 32 MiB, con errore esplicito su estrazioni oltre budget o risposte invalide. I log del parser non entrano nel protocollo. Non cambiano i contratti IPC/REST o i formati persistenti.
- Il worker non importa runtime FastAPI, database, OCR o modelli. Il token Sidecar non viene ereditato e l'eventuale directory dati è temporanea e isolata anche in caso di futura importazione accidentale. Nessuna nuova dipendenza.

Il launcher Python del virtualenv Windows può avviare un altro processo prima dell'assegnazione al Job. Lo sviluppo usa quindi l'interprete reale della stessa installazione e aggiunge esplicitamente le librerie del virtualenv, senza shell. Il percorso frozen usa l'entrypoint `--xls-worker`, intercettato prima degli import del server; questa modalità è predisposta, ma il binario frozen non è stato ricostruito o qualificato in questo lotto.

Le funzioni di rendering e i limiti tabulari comuni sono estratti in `sidecar/domain/tabular.py`; il lettore XLS usa gli stessi algoritmi precedenti in `xls_reader.py`. Restano coordinate, date native, selezione di righe/fogli, omissioni dichiarate e preservazione dell'originale. Le descrizioni italiane e inglesi dell'opzione formato completo spiegano ora il rifiuto per risorse e il recupero CSV/XLSX.

## Misure native sui casi dichiarati

Misure tramite `QueryInformationJobObject`, `PeakJobMemoryUsed`, processo isolato; includono import e parsing. Le dimensioni geometriche non sono usate come stima del costo.

| Caso | Sorgente | Esito, picco commit e tempo |
| --- | --- | --- |
| Allocazione nativa di 256 MiB con budget di prova 64 MiB | Processo Python minimale | `MemoryError` reale, picco 8.261.632 byte, 0,070 s; processo terminato. |
| XLS numerico, 65.536×256 celle effettive | 101.318.770 byte | Rifiuto per memoria, 521.142.272 byte, 8,185 s, entro il budget dichiarato di 536.870.912 byte. |
| XLS sparso, ultima cella a riga 65.536/colonna 256 | Stream BIFF8 generato | Formato completo ammesso con coordinate originali; 76.222.464 byte, 0,697 s. La selezione normale delle prime 150 righe continua a rifiutare un intervallo privo di celle. |
| Dodici fogli con 2.000 stringhe di 4.000 caratteri ciascuno, selezione di due fogli | 96.312.764 byte | Ammesso, selezione e abbreviazioni dichiarate; 180.998.144 byte, 0,686 s. |
| 45.000 stringhe globali di 4.000 caratteri, SST/CONTINUE e riferimenti reali | 180.945.123 byte | Rifiuto per memoria durante il caricamento del workbook; 520.372.224 byte, 0,796 s. |

Queste sono misure di una singola esecuzione mirata, non soglie prestazionali universali. I nuovi fixture grandi sono stream workbook BIFF8 autonomi validi per xlrd, scritti progressivamente senza dipendenze aggiuntive; il fixture OLE/CFB `ragged.xls` preesistente copre anche il normale percorso container. Non si attesta la lettura dei fixture generati nell'interfaccia Microsoft Excel.

La precedente qualifica del candidato storico accettava il foglio numerico massimo con circa 1 GB di picco Sidecar. Il nuovo fixture denso delle stesse dimensioni viene rifiutato oltre il budget del worker; il supporto delle coordinate massime rimane per i casi che rispettano le risorse. Le evidenze storiche sono conservate in [rag-sidecar-history-2026-10-13.md](./rag-sidecar-history-2026-10-13.md#maximum-dimension-xls-qualification---2026-10-13).

## Verifica dei rifiuti e dei dati

Le regressioni native verificano allocazione negata, timeout con worker realmente terminato, mancata ammissione senza invio della richiesta, slot occupato e morte improvvisa del proprietario. Una prova esegue l'entrypoint `main.py --xls-worker` e vieta gli import del runtime Sidecar: la lettura XLS riesce senza inizializzare il server o lo storage.

Le prove REST, con gli embedding deterministici dichiarati nel conftest, indicizzano prima un documento di controllo, poi rifiutano il XLS denso sia per il limite normale 8 MiB sia per il budget nativo con opt-in. Confrontano tutte le righe LanceDB e gli hash degli archivi preesistenti, verificano il documento ancora leggibile e una nuova estrazione XLS dopo il rifiuto. Il sorgente e la copia originale del task fallito mantengono lo stesso SHA-256. La copia fallita viene **conservata**, senza estrazione né indice, secondo la politica esistente; non si introduce pulizia automatica.

| Comando | Esito |
| --- | --- |
| `.venv\Scripts\python.exe -B -m pytest -q -s --tb=short -p no:cacheprovider sidecar/tests/test_xls_admission.py` | Misura mirata: 12 passati, 26,59 s. La suite finale comprende 13 casi XLS, dopo l'aggiunta della prova di arresto del proprietario. |
| `.venv\Scripts\python.exe -B -m pytest -q --tb=short -p no:cacheprovider sidecar/tests/test_xls_admission.py -k 'entrypoint or owner_crash'` | Due passati; prova dell'entrypoint reale e del proprietario arrestato. |
| `.venv\Scripts\python.exe -B -m pytest -q -rs --tb=short -p no:cacheprovider sidecar/tests/test_tabular_ingestion.py` | 56 passati dopo l'integrazione del worker. |
| `.venv\Scripts\python.exe -B -m pytest -q -rs --tb=short -p no:cacheprovider` | Suite finale: 581 passati, un symlink saltato, 157,99 s. Include i 13 casi XLS e il test junction realmente eseguito. |
| `npm run test -- --reporter=dot --silent=true` | 2.890 passati in 320 file, 187,66 s. |
| `npm run build` | TypeScript, Renderer, Main e Preload passati. |
| `.venv\Scripts\python.exe -m compileall -q sidecar` | Passato, con `PYTHONPYCACHEPREFIX` nello scratch del lotto. Anche AST di tutti i sorgenti verificato senza bytecode. |
| `npm run quality:static` | Passato su 851 file supportati e 103 handler IPC; non è un lint completo Python. |
| `npm run docs:check` | Passato su 66 pagine Markdown. |
| `git diff --check` e confronto JSON con il backup precedente al lotto | Passati; stessi 43 ID, stesso schema, sola descrizione/criteri della voce XLS aggiornati, altre voci e note invariate. |

Il diff è stato rivisto; il probe CI preesistente resta identico al termine del proprio lotto. Nessun gate remoto è attestato da questi risultati locali.

## Fonti e limiti

Consultate le fonti ufficiali: [xlrd on-demand](https://xlrd.readthedocs.io/en/latest/on_demand.html), [limiti Job Windows](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-setinformationjobobject), [struttura estesa e significato della memoria committed](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information), [operazione dei processi Python](https://docs.python.org/3.13/library/subprocess.html#subprocess.Popen.communicate) e [struttura XLS Microsoft](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/cd03cb5f-ca02-4934-a391-bb674cb8aa06). Le pagine xlrd dichiarano 2.0.1 e quelle Python consultate 3.13.16: i runtime realmente provati sono **xlrd 2.0.2, pandas 3.0.5 e Python 3.13.15**. Le API Win32 sono esercitate nativamente, senza attribuire alla sola documentazione la qualifica del runtime.

Backup SHA-256 dei file interessati precedente al lotto in `%TEMP%/onlyrag-xls-admission-skocyovy/backup`, inclusi tracker e documentazione con il lavoro CI preesistente. Le prime prove hanno corretto launcher del venv, pool BLAS, conteggio del picco, attesa della terminazione e aspettative sui residui conservati; nessuna di queste correzioni autorizza cancellazioni di dati personali.

Il task resta aperto finché il worker frozen/desktop installato non ripete, in radici isolate, ammissione al Job, parsing, limiti, errori, timeout, arresto del proprietario e preservazione di sorgenti/indice. Restano distinte qualifica CI remota, semantica, installazione, migrazione e perdita di alimentazione. Nessuna nuova chiamata modello, installazione, migrazione personale, commit o push in questo lotto.

## Aggiornamento frozen — 19 ottobre 2026

Il [candidato corrente](./verification-current-source-2026-10-19.md) ripete con successo parsing e rifiuti HTTP, budget di memoria, caso sparso alla coordinata massima, selezione fogli/stringhe globali, timeout e recupero, arresto forzato del Sidecar proprietario e rilettura dopo riavvio. Il task conserva il confine desktop installato; iniezione di errore di ammissione al Job e overflow forzato dell’output restano sorgente-only. I limiti e i risultati del lotto precedente sopra restano storici.
