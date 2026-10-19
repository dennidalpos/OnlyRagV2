# Ciclo di vita degli archivi sorgente — 19 ottobre 2026

## Perimetro P03

Task `SOURCE-ARCHIVE-LIFECYCLE-01`, successivo autonomo P2 completabile offline dopo le qualifiche con gate di installazione/modelli. La verifica riguarda il comportamento corrente di conservazione, navigazione e cleanup degli archivi; non introduce cancellazioni aggiuntive. Sorgenti applicativi, dati personali, evidenze precedenti e modifiche dei lotti chat/Python sono preservati.

La lettura di [source_provenance.py](../sidecar/infrastructure/source_provenance.py), [ingest_service.py](../sidecar/services/ingest_service.py), [search_service.py](../sidecar/services/search_service.py) e [cleanup_policy.ps1](../scripts/cleanup_policy.ps1) conferma che l'archivio è immutabile e protetto dalla manutenzione ordinaria. La cancellazione dall'indice conserva gli originali; gli originali delle ingestioni fallite sono conservati senza promozione automatica; l'annullamento pulisce solo il nuovo archivio rivendicato dopo rollback riuscito. Questa è la policy esistente, ora esplicitata in [retrieval](./retrieval.md#ciclo-di-vita-degli-archivi-originali) e [operazioni](./operations.md#disinstallazione-e-dati).

## Nuove regressioni

[test_source_archive_lifecycle.py](../sidecar/tests/test_source_archive_lifecycle.py) aggiunge **nove casi** con file reali e LanceDB nativo su radici isolate. Gli encoder sono i fixture hash dichiarati da `conftest.py`; non viene chiamato un modello reale. Il client HTTP è il vero FastAPI `TestClient` in-process, senza URL di server frozen o profili installati.

| Caso | Evidenza richiesta e osservata |
| --- | --- |
| Creazione/revisione/cancellazione HTTP | Due documenti con lo stesso nome conservano ID e originali distinti, digest SHA-256 corretti, estrazioni e copie byte per byte. La revisione cambia il Markdown indicizzato e invalida la vecchia citazione; il nuovo testo riscritto è derivato. Due cancellazioni successive rimuovono solo documento/chunk selezionati; originali ed estrazioni restano immutati, senza journal pendente. |
| Citazione superstite | Dopo revisione e cancellazione dell'altro documento, la risposta HTTP della fonte restante è identica; record e chunk corrispondono esattamente ai dati iniziali di quel documento. La provenienza dell'archivio conservato del documento eliminato è indisponibile. |
| Ingestione fallita e annullata | L'errore dichiarato di estrazione conserva l'originale non indicizzato. Un successivo annullamento elimina soltanto il nuovo archivio posseduto e mantiene sia il documento valido sia l'originale fallito, con store e byte invariati. |
| Cleanup posseduto | Rimuove originale, estrazione e staging della sola nuova directory rivendicata; la seconda chiamata è idempotente. Citazione e dati del documento valido restano leggibili e identici. |
| Proprietario e traversal | Due rifiuti preservano file dentro/fuori la radice, archivio posseduto e intere tabelle. |
| Artefatto inatteso | File e directory annidata inattesi bloccano tutta la pulizia prima di qualsiasi unlink; nessuno dei file ammessi viene già rimosso. |
| Junction Windows | Due junction native, sulla directory archivio e su una voce `original.*`, sono riconosciute e rifiutate. I target esterni, l'archivio non coinvolto e lo store restano identici. Nel `finally` si rimuove il solo link di fixture. Entrambi i casi sono eseguiti su Windows. |

## Verifiche eseguite

- `.venv\Scripts\python.exe -B -m pytest -q -p no:cacheprovider sidecar/tests/test_source_archive_lifecycle.py`: **9 passati**, 5,54 s.
- `.venv\Scripts\python.exe -B -m pytest -q -p no:cacheprovider sidecar/tests/test_source_archive_lifecycle.py sidecar/tests/test_source_provenance.py sidecar/tests/test_ingestion_cancel_archive.py sidecar/tests/test_document_recovery.py`: **51 passati, 1 saltato**, 9,53 s. Il solo symlink privo dei privilegi resta saltato; i tre casi junction reali sono eseguiti, inclusa la navigazione HTTP già qualificata.
- `.venv\Scripts\python.exe -B -m pytest -p no:cacheprovider`: **598 passati, 1 saltato**, 156,60 s.
- `npm run quality:python`: **15 passati**, 3,52 s; gate obbligatorio completo, senza skip.
- `npm run quality:static`, `npm run docs:check` e `git diff --check`: **exit 0**; statico su 853 file/103 handler IPC e documentazione su 71 pagine.

Il gruppo comprende anche rollback fallito con journal mantenuto, errore di commit con archivio conservato e inaccessibile, cleanup fallito, revisioni/span corrotti, originali alterati e recupero del database. Le nuove regressioni completano il flusso sequenziale senza duplicare questi controlli.

## Limiti e conservazione

Il task qualifica il ciclo di vita dichiarato nei sorgenti, senza modifiche applicative o nuovi contratti. Non certifica un'app installata, perdita di alimentazione, qualità semantica degli embedding o sicurezza contro tutte le corse concorrenti del filesystem. I collegamenti sono impostati prima della chiamata sotto test; le race di smaltimento conservano la decisione separata nel tracker. I test non trasformano un archivio non indicizzato in un oggetto automaticamente eliminabile.

Backup e log sono in `%TEMP%/onlyrag-p03-archive-lifecycle-abba3eb585524d44a546b8f68ab7f979`. Nessuna installazione, chiamata modello reale, migrazione personale, cancellazione di evidenze protette, commit o push. Suite TypeScript, build ed Electron non ripetuti per questo lotto di soli test Python e documentazione.

Tracker: rimossa soltanto la voce conclusa, altre 39 attività e note/priorità invariate; 21 autonome e 18 con decisione utente. I controlli SHA-256 preservano i file preesistenti non coinvolti e i due log ignorati del lotto precedente. Esecuzione con `-B` e senza cache pytest; nessun nuovo scratch, profilo o worktree nel checkout. Le junction create sono rimosse nel `finally` dei test; dati temporanei e fixture restano sotto le radici gestite dai test.
