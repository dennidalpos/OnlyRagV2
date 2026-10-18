# Archivi sorgente e junction Windows — 18 ottobre 2026

Lotto `TEST-SOURCE-JUNCTION-WINDOWS-01`, autorizzato con «procedi» dopo il piano di analisi. Aggiunta una regressione nativa nel [test degli archivi sorgente](../sidecar/tests/test_source_provenance.py); il [guard applicativo](../sidecar/infrastructure/source_provenance.py) esistente supera la prova senza modifiche.

## Criteri di completamento ed evidenze

| Criterio | Evidenza verificata |
| --- | --- |
| Junction reale verso l'esterno | Due documenti sintetici vengono indicizzati in LanceDB isolato. Uno dei relativi archivi è spostato fuori da `SOURCE_ROOT`, sempre dentro il `tmp_path` della prova; una junction Windows occupa il percorso precedente. Il test verifica `is_junction()`, l'assenza di symlink e la destinazione risolta. |
| Rifiuto dell'accesso | `_archive` e `resolve_source_location`, con una citazione valida acquisita prima della sostituzione, rifiutano con `Source location escapes the document root.`. La route locale restituisce 404 e lo stesso dettaglio. Il secondo documento rimane consultabile: non è un rifiuto indiscriminato. |
| Integrità | Dopo i tentativi, originali forniti dal chiamante, file dell'archivio spostato e del secondo archivio sono identici byte per byte. Le righe delle tabelle `documents` e `chunks` sono identiche allo snapshot precedente. |
| Isolamento e recupero | Il conftest imposta lo store temporaneo prima degli import Sidecar e simula gli embedding. La junction nasce con `New-Item -ItemType Junction`, comando fisso e percorsi passati nell'ambiente. Il `finally` rimuove soltanto il link tramite `Path.rmdir`, senza cancellarne la destinazione. Il test non può passare silenziosamente se la creazione Windows fallisce. |

## Comandi eseguiti

Windows, PowerShell 7.6.7, Node 24.20.0, Python 3.13.15 del venv locale. Prima delle prove è stata verificata l'assenza di `ONLYRAG_TABULAR_TEST_URL`, così la route usa il TestClient locale isolato anziché un server esterno.

| Comando | Esito |
| --- | --- |
| `.venv\Scripts\python.exe -B -m pytest -q -rs -p no:cacheprovider sidecar/tests/test_source_provenance.py::test_source_lookup_refuses_real_junction_and_preserves_archives` | Un passato, 2,66 s. Junction creata ed esercitata realmente. |
| `.venv\Scripts\python.exe -B -m pytest -q -rs -p no:cacheprovider sidecar/tests/test_source_provenance.py` | 19 passati, un saltato, 5,19 s. Rimane saltato soltanto `test_archive_refuses_symlinked_document_directory`: symlink di directory non disponibile sull'host. |
| `npm run docs:check` | Passato su 63 pagine Markdown. |
| `npm run quality:static` | Passato su 850 file e 103 handler IPC; nessuna correzione automatica. |
| `git diff --check` | Passato. |
| Confronto JSON con il tracker copiato prima del lotto | Sola rimozione di `TEST-SOURCE-JUNCTION-WINDOWS-01`; schema e tutte le altre voci invariati: 25 autonome e 18 con decisione utente. |

Lo skip del vecchio symlink non è presentato come una prova superata. Il nuovo test salta soltanto su sistemi diversi da Windows; su Windows creazione fallita, timeout o mancato riconoscimento della junction fanno fallire la prova.

La voce conclusa è rimossa da `PROJECT_STATUS.json`, che conserva solo lavoro aperto; criteri ed esiti restano in questo documento e nell'indice di verifica. Le modifiche locali preesistenti sono conservate. Prima delle modifiche sono stati copiati test, tracker e documenti di verifica in `%TEMP%/onlyrag-junction-backup-651f09c9f4d74205b837eac29e9005bd`, con confronto SHA-256 delle copie.

## Fonti e limiti

Fonti primarie consultate: [PowerShell New-Item e junction](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/new-item?view=powershell-7.5) e [Python Path.is_junction](https://docs.python.org/3.13/library/pathlib.html#pathlib.Path.is_junction). La pagina PowerShell consultata è per 7.5, quella Python corrente mostra 3.13.16: la compatibilità con i runtime locali 7.6.7 e 3.13.15 è verificata dalla prova eseguita, non inferita dalle sole pagine.

La qualifica riguarda una directory documento sostituita da una junction verso un archivio esterno alla radice sorgenti dichiarata. Non certifica ogni reparse point, sostituzioni concorrenti fra controllo e apertura, desktop installato o qualità semantica. Suite complete frontend/backend, build e prove Electron non ripetute: la modifica riguarda soltanto test e documentazione, senza commit richiesto. Nessuna chiamata a modelli reali, installazione, migrazione o modifica ai dati personali; nessun commit o push.
