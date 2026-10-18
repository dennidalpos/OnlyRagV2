# Verifica corrente per ambito

Allineamento del **18 ottobre 2026**. Il [`tracker`](../PROJECT_STATUS.json) è la fonte dello stato aperto: 42 attività, 24 autonome e 18 con decisione utente. Questo riepilogo distingue la verifica meccanica dalla qualità dei risultati e dall'app installata. Le ricevute, i fallimenti e gli hash storici restano in [`verification-history-2026-10-13.md`](./verification-history-2026-10-13.md); i lotti successivi sono indicizzati in [`verification.md`](./verification.md).

| Ambito | Verificato | Ancora aperto |
| --- | --- | --- |
| Build e sorgenti | Build corrente Renderer/Main/Preload passata. Candidato CPU storico: installer e archivio sorgente con hash, 998 record sorgente, 3.598 file installati e corrispondenza dei sei moduli Sidecar congelati; probe CPU OCR/auth/PDF/ricerca fallback passati. | Il candidato storico non qualifica il codice dei lotti successivi: corrispondenza installer/sorgenti correnti, installazione e riavvio sul profilo reale, firma, diritti, pubblicazione e consegna del sorgente restano aperti. |
| Test deterministici | Ultimo passaggio completo: 2.890 test TypeScript e 568 Python passati, un symlink saltato; build e qualità statica passate. I risultati PowerShell restano nelle ricevute storiche. | CI remota e condizioni non rappresentate dai fixture. |
| Ingestion e ricerca | Parser e rifiuti isolati, OCR CPU congelato, provenienza vettoriale, filtri, FTS e proiezione dei metadati verificati nei casi dichiarati. Soglia UTF-16 coerente, rifiuto prima di chunk/embedding, recupero Markdown oltre soglia e junction Windows qualificati nei lotti del 18 ottobre. | Memoria XLS avversaria, ricerca/FTS/I/O su corpus più ampi, qualità multilingue e copertura completa dei documenti. |
| Traduzione | Corpus congelato di quattro documenti: 4/4 contenuto e lingua nella configurazione dichiarata. Un modulo italiano: 8/8 lingue con modello 4B e glossario limitato. Replay del candidato congelato senza nuove chiamate modello. | Altri documenti e configurazioni, layout visivo DOCX, consegna e prova dell'app installata/riavviata. |
| Agente | Guard, isolamento, recupero e verifiche native su fixture; quattro richieste umanamente confermate conservate con esiti e rifiuti. | Estrazione/planning live e TaskLab completi: 0 sequenze/stadi qualificati. Nuove campagne modello restano sospese. |
| Persistenza | Writer con flush del file, rename e 16 tagli isolati; originali preservati. Checkpoint Main di chat e bozze, revisione originale, chiusura rifiutata su scrittura fallita, retry e recupero dopo interruzione del processo isolato verificati. | Desktop installato, ulteriori finestre di interruzione, metadata directory e perdita di alimentazione. |

## Comandi

Da PowerShell nella radice del repository: `npm run docs:check` per link e comandi; `npm run typecheck` e test mirati solo dopo modifiche comportamentali; `npm run test:fast -- --silent=true` e `.venv\Scripts\python.exe -m pytest -q` per le suite complete quando un problema lo richiede. L'elenco degli script e degli effetti è in [`operations.md`](./operations.md) e [`package.json`](../package.json). Un test passato non certifica modelli reali, semantica, interazione visiva o perdita di alimentazione.

## Prossimo lavoro offline

Proposta successiva: ammissione XLS prima della materializzazione; seguono misure di ricerca/FTS/archivi e verifica per i tool non Node. I checkpoint già implementati non sono da duplicare: i relativi task conservano soltanto le qualifiche ulteriori dichiarate nel tracker. Nessuna di queste voci autorizza migrazioni personali, pulizia dei dati, installazione, pubblicazione o nuove chiamate ai modelli.

## Passaggio di sessione sulla documentazione · 2026-10-13

La documentazione tecnica è stata confrontata con i punti di ingresso e i contratti del codice, suddivisa per ambito e indicizzata in [`README.md`](./README.md). I resoconti estesi precedenti restano negli archivi datati; i duplicati `agent.md` e `decisions.md` sono stati rimossi. Corretti anche i riferimenti non aggiornati nelle skill locali.

Verifica di questa modifica: `npm run docs:check` (48 file), sei test mirati del validatore, Biome sui due file del validatore e `git diff --check`, tutti superati. Suite applicative complete non ripetute perché la modifica non cambia il comportamento dell'app. Le attività aperte restano nel [`tracker`](../PROJECT_STATUS.json); nessuna campagna modello, installazione o migrazione personale è stata avviata.


## Aggiornamento mirato — 2026-10-17

Il [lotto chat, bozze e contesto](./verification-chat-drafts-context-2026-10-16.md), iniziato il 16 ottobre, aggiunge checkpoint chat nel Main, recupero delle bozze con revisione originale e limite complessivo del prompt stimato. Le prove Electron isolate qualificano interruzione forzata del processo, recupero della risposta parziale come incompleta, rifiuto della chiusura, retry e readback al riavvio. Suite completa frontend 2.863 passati, regressioni finali mirate 63 passati, Python 537 passati e un caso symlink saltato; build, statico e smoke passati. Non sono qualificati desktop installato, perdita di alimentazione o qualità semantica; le attività residue restano nel tracker.

## Perimetro desktop — 2026-10-17

L'utente ha chiarito che il prodotto è destinato al solo desktop Windows. Tablet e smartphone sono fuori dal target: `UX-FIRST-USE-SIMPLIFICATION-01` è stato ritirato dal tracker, non completato. Non è stato creato un task sostitutivo di semplificazione del primo uso, in assenza di un problema desktop verificato. Le immagini e gli esiti dei viewport tablet/telefono restano evidenze storiche, senza costituire requisiti di accettazione attuali. Le direttive in `AGENTS.md` e il dossier SecondBrain sono riallineati a questa decisione; il comportamento applicativo e i test esistenti non cambiano.

Criteri di completamento del riallineamento: assenza della voce ritirata negli elenchi aperti, conservazione delle altre attività e dello schema del tracker, direttive desktop coerenti, riferimenti storici esplicitamente qualificati e controlli documentali/statici superati. La qualifica `TEST-SOURCE-JUNCTION-WINDOWS-01` resta aperta e proposta separatamente; questo aggiornamento non ne attesta l'esecuzione.

Verifiche del riallineamento: `npm run docs:check` passato su 61 pagine Markdown; `npm run quality:static` passato su 849 file e 103 handler IPC; `git diff --check` passato. Un confronto JSON con il tracker in HEAD conferma lo stesso schema, la sola rimozione della voce mobile, tutte le altre attività invariate e la qualifica junction ancora aperta. Suite applicative, build e prove Electron non ripetute per questa modifica documentale; nessun commit o push.

## Junction Windows degli archivi sorgente — 2026-10-18

La [regressione nativa](./verification-source-junction-2026-10-18.md) ha creato ed eseguito una junction di directory Windows verso un archivio esterno alla radice sorgenti isolata. Il guard esistente rifiuta lettura dell'archivio, risoluzione della citazione e route HTTP (404); originali, estrazioni e righe LanceDB restano invariati, mentre un secondo documento rimane consultabile. Non è stata necessaria una modifica al codice applicativo. Test singolo: un passato; suite sorgenti: 19 passati e un symlink saltato. Il caso junction è passato realmente, non saltato.

`TEST-SOURCE-JUNCTION-WINDOWS-01` è quindi rimosso dal tracker degli aperti; le precedenti indicazioni sulla junction ancora da qualificare restano storiche. Schema e altre attività sono conservati. La prova non qualifica sostituzioni concorrenti dei path, ogni possibile reparse point o l'app installata; nessuna installazione, migrazione personale, chiamata modello reale, commit o push.

## Limiti documentali e recupero — 2026-10-18

Il [lotto documentale](./verification-document-limits-2026-10-18.md) allinea nuova ingestion, aggiornamento, revisione, bozze e conversioni alla soglia esistente di 10 milioni di unità UTF-16. Testo completo con intestazioni, risultato sanitizzato e archivio originale sono controllati prima di chunk ed embedding. I record preesistenti restano leggibili e l'export Markdown locale recupera integralmente testi oltre soglia; un banner spiega come esportare o ridurre esplicitamente il testo. Nessun troncamento o migrazione automatica.

Suite completa TypeScript: 2.890 passati in 320 file; Python: 568 passati e un symlink saltato. Build e prova Electron con export Unicode oltre 20 MB, rilettura SHA-256 e conversioni rifiutate prima del Sidecar passate. `DOC-LARGE-EXTRACTION-REVIEW-01` è rimosso dagli aperti; schema e tutte le altre attività sono conservati. Restano fuori dalla qualifica memoria generale dei parser/editor, corpus enormi, desktop installato e qualità semantica. Nessun modello reale, installazione, migrazione personale, commit o push.

## Consolidamento finale autorizzato — 2026-10-18

Richiesta successiva dell'utente: allineare tracker e dossier, eseguire commit e push e consolidare eventuali branch sul principale. Le precedenti note «nessun commit o push» descrivono le fasi concluse prima di questa richiesta.

Remoto verificato con Git e GitHub CLI: `https://github.com/dennidalpos/OnlyRagV2.git`, visibilità pubblica, principale `master`. Prima del consolidamento HEAD e `origin/master` sono entrambi `fb49f60908fcf24a275de8938d27df1b14295ad4`. L'inventario locale, i riferimenti remoti effettivi, i worktree e le PR aperte confermano il solo branch `master`: nessun branch da unire o eliminare.

Tracker verificato: stesso schema e 42 ID aperti univoci; task junction e limiti documentali conclusi, task mobile ritirato. Riallineato il riferimento XLS alla funzione corrente, senza modificare il lavoro residuo. Il riepilogo iniziale ora distingue risultati aggiornati, candidato installer storico e qualifiche ancora aperte; il riferimento ai diritti di distribuzione usa l'ID esistente nel tracker.

Gate completi ripetuti prima del commit: `npm run test -- --reporter=dot --silent=true`, 2.890 passati in 320 file, 200,47 s; `.venv\Scripts\python.exe -B -m pytest -q -rs --tb=short -p no:cacheprovider`, 568 passati e un symlink saltato, 130,19 s. `npm run docs:check`, `npm run quality:static` e `git diff --check` passati. I sorgenti applicativi coincidono con quelli della build e delle prove Electron già registrate nel lotto documentale. Diff rivisto; la scansione mirata dei file modificati non rileva chiavi private o formati comuni di token, senza costituire una certificazione generale di sicurezza.

Backup verificato di file modificati/non tracciati, patch binaria e bundle Git precedente al commit in `%TEMP%/onlyrag-final-consolidation-a7abcdfa84df4e04af2a8dd6d103d926`. SHA del commit e conferma del push sono registrati nel dossier SecondBrain dopo la verifica sul remoto; la CI remota resta distinta dai gate locali.
