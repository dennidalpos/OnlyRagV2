# Verifica corrente per ambito

La [consegna locale UI e strumenti](./verification-local-ui-2026-10-20.md) implementa il ritiro di 24 task, mantiene 11 attività autonome e centralizza gli aiuti in tooltip. Le ricevute precedenti restano storiche.

**Politica corrente — 20 ottobre 2026:** [sviluppo locale e test autonomi](./local-development-policy-2026-10-20.md). Qualifiche dei modelli, campagne live, CI, distribuzione pubblica e migrazioni legacy sono ritirate. I resoconti e i criteri di campagne precedenti sotto conservano valore storico e non sono obblighi operativi. Il tracker corrente contiene 11 task autonomi.

Il [passaggio di sessione Sidecar e verifiche locali](./session-handoff-sidecar-2026-10-20.md) salva la correzione dell'avvio, il runner loopback e il piano lingua offline con 34 attività ancora aperte. Commit e push su `master` autorizzati per questa consegna; verifiche complete ed esito remoto restano attribuiti ai rispettivi sorgenti.

La [correzione dello stato iniziale Sidecar](./verification-sidecar-dev-startup-2026-10-20.md) riproduce il falso `Offline`, passa 26 regressioni e verifica Python/LanceDB reale dentro Electron su profilo isolato. Nessuna inferenza o nuova installazione; 34 attività precedenti preservate. I candidati conservati richiedono una nuova corrispondenza con il runtime modificato.

Il [seguito P1 sulla lingua delle risposte](./plan-chat-language-2026-10-20.md) completa soltanto la preparazione offline del confronto. Corpus e ricevute conservate sono verificati, così come hook chat/citazioni e preset; **zero inferenze**. Il proprietario conferma «solo offline»: il candidato non entra nel runtime, il gate live resta non eseguito e i task aperti restano **34**.

La [ripresa locale del tracker](./verification-tracker-resume-2026-10-20.md) conferma CI `e48c468` completata con successo, aggiunge il runner diagnostico dev-server e passa 25 casi nativi più 24 regressioni mirate. Restano **34 task aperti**: nessuna causa storica dei tre residui CI/loopback è stata dichiarata risolta. Il nuovo runner ha verifica locale; non sono eseguite nuove campagne modello o installazioni.

Il [passaggio di sessione delle correzioni locali](./session-handoff-local-fixes-2026-10-20.md) salva tre completamenti, 34 attività aperte e il residuo audit; commit e push su `master` autorizzati per questa consegna. Le sezioni successive mantengono le rispettive date ed evidenze storiche.

Il [seguito locale](./verification-tracker-local-2026-10-20.md) conclude tre task e registra un nuovo residuo di recupero dell'audit di sviluppo: **34 aperti**. Il [sanitizer Monaco](./verification-monaco-sanitizer-2026-10-20.md) usa la dipendenza 3.4.17, sostituita nel grafo Vite e verificata con rendering nativo e build. La [misura RAG sotto contesa](./verification-retrieval-contention-2026-10-20.md) è locale e sintetica; i [task CI](./verification-ci-boundaries-2026-10-20.md) conservano diagnosi storica incompleta e futura qualifica remota. L'utente ha confermato il perimetro solo locale e p95 RAG di 5 secondi.

Il [seguito delle correzioni di traduzione](./verification-translation-fixes-2026-10-20.md) conclude pubblicazione esclusiva PDF/DOCX e copertura DOCX dichiarata, con 197 regressioni offline passate. Conteggi e limiti degli audit precedenti descrivono le rispettive fasi. App installata, modelli reali e resa Word non sono qualificati da queste fixture.

Il [passaggio di sessione dell'audit](./session-handoff-audit-2026-10-20.md) salva i 36 residui e la richiesta esplicita di commit/push su master; le verifiche pre-commit e la CI della nuova consegna restano distinte dall'audit precedente.

L'[audit corrente dei residui](./repository-residue-audit-2026-10-20.md) registra **36 attivita aperte**, tre nuovi P2 e CI b470387 fallita sul worker dipendenze. Prove DOCX isolate, nessuna correzione applicativa. Il percorso TEMP della sanificazione non e disponibile e resta nel task di conservazione; conteggi/esiti delle ricevute precedenti sono storici.

Il [passaggio attuale di sessione](./session-handoff-tracker-2026-10-20.md) registra la consegna dei sorgenti su `master`, i nuovi controlli pre-commit e la ripresa da 33 attività, incluso il nuovo timeout CI audit verificato. La CI deve essere riletta sul nuovo SHA; i risultati precedenti restano riferiti alla propria revisione.

La [nuova campagna ledger](./verification-ledger-bounded-2026-10-20.md) ha consumato esattamente otto chiamate: estrazione 1/4 semanticamente accettata, quattro candidati di piano non qualificati nel limite disponibile, audit completo riletto per otto operazioni dopo il riavvio installato. Sette richieste ulteriori bloccate prima del modello; marker storici invariati. Il task P1 resta aperto, senza nuovi ID chiusi.

Stato conclusivo del seguito: [cinque task rimossi, 32 residui e candidato finale verificato](./verification-tracker-followup-2026-10-20.md). La [qualifica XLS installata](./verification-installed-xls-2026-10-20.md) passa 14 casi, 31 moduli congelati e otto documenti completi dopo riavvio. Include avvio installato e modelli reali nei soli casi dichiarati; l'accettazione semantica è fallita e rimane aperta. Le sezioni e ricevute dei lotti precedenti mantengono i propri conteggi storici.

Il [chunking strutturale](./verification-structure-chunking-2026-10-20.md) è valutato e il candidato è rifiutato: stessi 9/11 passaggi globali e nessun guadagno, nessuna integrazione. La quarta chiusura lasciava 33 attività; la successiva qualifica XLS porta il conteggio a 32. La qualità reale rimane aperta dopo il gate live fallito.

Le [impostazioni nel desktop installato](./verification-installed-settings-2026-10-20.md) passano chiusura, scrittura fallita, retry, interruzione del processo e readback completo dopo riavvio sul candidato del 20 ottobre. `SETTINGS-CLOSE-DURABILITY-01` concluso e rimosso. Il profilo E2E è isolato e l'avvio automatico Sidecar resta distinto.

La [riconciliazione degli effetti interrotti](./verification-inflight-reconciliation-2026-10-20.md) è implementata e qualificata con tre interruzioni native: ispezione e abbandono esplicito conservano prove e stato senza replay o rollback. Rimosso il task concluso. L'utente ha ora autorizzato candidato Windows, installazione isolata e modelli locali su dati di prova; autorizzazione ed esito delle qualifiche rimangono distinti. I conteggi e i limiti delle sezioni precedenti al seguito sono storici.

Allineamento del **20 ottobre 2026**. Il [`tracker`](../PROJECT_STATUS.json) è la fonte dello stato aperto e delle dipendenze ancora necessarie. Questo riepilogo distingue la verifica meccanica dalla qualità dei risultati e dall'app installata. Le ricevute, i fallimenti e gli hash storici restano in [`verification-history-2026-10-13.md`](./verification-history-2026-10-13.md); i lotti successivi sono indicizzati in [`verification.md`](./verification.md).

Il [passaggio precedente](./session-handoff-2026-10-19.md) conserva la consegna di `a8d0008`; il [nuovo passaggio di sessione](./session-handoff-native-2026-10-19.md) riunisce [verifica nativa](./verification-native-projects-2026-10-19.md), [pulizia log](./verification-log-cleanup-2026-10-19.md) e [inventario release](./verification-release-inventory-2026-10-19.md), con richiesta esplicita di commit/push dei sorgenti su `master`. Il tracker riconcilia il runtime cambiato con la necessità di un nuovo candidato: gli artefatti conservati non sono riclassificati o rimossi.

Il [recupero agente dopo arresto forzato](./verification-agent-crash-recovery-2026-10-20.md) e il [riallineamento del runner Electron](./verification-agent-harness-2026-10-20.md) aggiungono coda persistente, ripresa esplicita, checkpoint incrementali e otto scenari/nove guard qualificati offline. Gli esiti ignoti restano rifiutati alla ripresa; il seguito qualificato offre ispezione e abbandono senza replay.

La [CI precedente](https://github.com/dennidalpos/OnlyRagV2/actions/runs/39380408183) di `70341da` è terminata con due fixture fallite; le [correzioni locali](./verification-ci-fixtures-2026-10-20.md) non costituiscono una nuova qualifica remota. La successiva [CI di 4999d56](https://github.com/dennidalpos/OnlyRagV2/actions/runs/39403270258) e `completed/success`: il task di qualifica remota della consegna runtime e concluso e rimosso. Il nuovo seguito documentale conserva la distinzione tra gli SHA.

La [correzione della provenienza dello storico](./verification-history-provenance-2026-10-20.md) registra encoder e policy, rifiuta spazi incompatibili e preserva i dati legacy; qualifica reale e ricostruzione esplicita restano aperte. Le [nuove sonde loopback](./verification-loopback-probes-2026-10-20.md) non riproducono il rifiuto intermittente: indagine e guardia restano aperte/invariata.

Il [passaggio di sessione del recupero e dello storico](./session-handoff-recovery-2026-10-20.md) documenta la pubblicazione autorizzata su master e i 37 residui dopo il successo CI della consegna runtime. Quella consegna precede implementazione e qualifica della riconciliazione, concluse nel seguito indicato sopra. Restano separati i gate installati/live e le altre decisioni non risposte.

| Ambito | Verificato | Ancora aperto |
| --- | --- | --- |
| Build e sorgenti | Il [candidato finale del 20 ottobre](./verification-candidate-footprint-2026-10-20.md) ha 3.589 file installati corrispondenti, 1.162 sorgenti archiviati e 54 file ASAR verificati. Avvio automatico, otto ingestioni Nomic e riavvio passano. La [qualifica XLS](./verification-installed-xls-2026-10-20.md) aggiunge 31 moduli Python congelati corrispondenti e 14 casi nel desktop installato. Il [candidato 95752a0](./verification-current-source-2026-10-19.md) conserva separatamente le proprie prove storiche. | Restano carichi e flussi non coperti dalla matrice dichiarata, traduzione/cancellazione reali e qualità sullo stesso artefatto; firma, diritti e pubblicazione restano separati. I fallimenti semantici non sono chiusi dai controlli dei byte. |
| Contesto chat | [Dettaglio per risposta](./verification-chat-coverage-2026-10-19.md): corpi di anteprime/passaggi effettivamente inclusi, troncamenti ed esclusioni, checkpoint e recupero Electron verificati offline. `CHAT-DOCUMENT-COVERAGE-01` concluso. | Copertura semantica, allocazione token reale e qualifica installata restano nei rispettivi task; il dettaglio non viene ricostruito per le risposte storiche. |
| Archivi sorgente | [Ciclo completo](./verification-source-archive-lifecycle-2026-10-19.md): originali/estrazioni immutati dopo revisione e cancellazione dall'indice, citazioni superstiti, conservazione dei residui e cleanup posseduto verificati su file e store isolati; nove nuove regressioni, incluse due junction di cleanup Windows. `SOURCE-ARCHIVE-LIFECYCLE-01` concluso. | Smaltimento delle evidenze conservate, race del filesystem, app installata e perdita di alimentazione mantengono le qualifiche separate. |
| Test deterministici | Il [lotto del recupero](./verification-agent-crash-recovery-2026-10-20.json) registra suite TypeScript/Python, coverage, build, otto scenari Electron/nove guard e gate seriali; conserva gli esiti iniziali falliti e gli hash dei sorgenti. Le ricevute precedenti restano datate. | CI della nuova revisione, app installata, modelli reali e perdita di alimentazione restano separati. Un rifiuto intermittente del probe dev-server rimane tracciato anche dopo ripetizioni riuscite. |
| Ingestion e ricerca | Parser e rifiuti isolati, OCR CPU congelato, provenienza vettoriale, filtri, FTS e proiezione dei metadati verificati nei casi dichiarati. XLS installato passa 14 casi e conservazione completa di sorgenti/indice. Ricerca/FTS/lock/I/O misurati su 10.000/100.000 chunk dichiarati; riletture della provenienza eliminate nella stessa ricerca. Soglia UTF-16, recupero Markdown e junction Windows qualificati nei lotti del 18 ottobre. | Ricerca su distribuzioni/dimensioni più ampie e in contesa, encoder reali, qualità multilingue e copertura completa dei documenti. Per la prossima qualifica prestazioni è richiesta la scelta del carico rappresentativo e dell'obiettivo di latenza. |
| Traduzione | Corpus congelato di quattro documenti: 4/4 contenuto e lingua nella configurazione dichiarata. Un modulo italiano: 8/8 lingue con modello 4B e glossario limitato. Replay storico del candidato congelato senza nuove chiamate modello; sul candidato corrente passano meccanica PDF/DOCX e rifiuti con risposte sintetiche, senza nuova qualifica semantica. | Altri documenti e configurazioni, layout visivo DOCX, consegna e prova dell'app installata/riavviata. |
| Agente | Guard, isolamento, verifiche native, recupero di trascrizione/coda/checkpoint e riconciliazione qualificati nei casi dichiarati. Otto operazioni reali di estrazione/candidato hanno audit completo riletto dopo riavvio installato. Quattro ledger umani restano invariati. | Estrazione accettata 1/4; quattro piani non qualificati nel budget disponibile e TaskLab completo non qualificato. L'autorizzazione di otto chiamate ledger è esaurita; marker e fallimenti precedenti restano conservati. |
| Persistenza | Writer con flush del file, rename e 16 tagli isolati; originali preservati. Checkpoint Main di chat e bozze, revisione originale, chiusura rifiutata su scrittura fallita, retry e recupero dopo interruzione del processo isolato verificati anche nel candidato confezionato, con servizi documento/generazione simulati. | Desktop installato, ulteriori finestre di interruzione, metadata directory e perdita di alimentazione. |

## Correzioni del verificatore — 20 ottobre 2026

La [consegna per il cambio di sessione](./session-handoff-verifier-2026-10-20.md) registra il perimetro di commit/push su `master`, i controlli pre-commit e la ripresa dalle 36 attività residue. SHA pubblicato e nuova CI sono riletti nel dossier SecondBrain.

La [qualifica delle regressioni](./verification-project-regressions-2026-10-20.md) chiude le quattro nuove voci dell’audit dopo correzione e test negativi: root effettiva della verifica, discovery Python da INI, esecuzioni vuote distinte dalla prova comportamentale e guide riconciliate. Sedici casi nativi reali senza skip; suite completa 2.926 TypeScript e 598 Python/un symlink saltato; build, smoke Electron isolato e gate seriale passati. Le altre 36 attività e i relativi criteri restano identici. Il runtime cambiato richiede un futuro candidato corrispondente: nessuna nuova installazione, generazione reale o qualifica dei vecchi installer.

## Audit dei residui — 19 ottobre 2026

Il [nuovo audit trasversale](./repository-residue-audit-2026-10-19.md) conserva le 36 attività precedenti e aggiunge quattro rilievi: P1 per verifica nella directory errata dopo `cd`, P2 per progetti Python omessi e classificazione comportamentale di test vuoti, P3 per guide correnti non riconciliate. Sei probe isolati riproducono i tre difetti del verificatore mentre le suite ordinarie passano (2.911 TypeScript, 598 Python/un symlink saltato); 15 casi Python critici e 31+17 casi cleanup passati. Le righe e le ricevute sopra restano datate: non attribuire loro queste nuove verifiche o qualifica installata/live. Nessuna correzione applicativa in questa fase.

## Comandi

Da PowerShell nella radice del repository: `npm run docs:check` per link e comandi; `npm run typecheck` e test mirati solo dopo modifiche comportamentali; `npm run quality:python` per i percorsi critici offline; `npm run test:fast -- --silent=true` e `.venv\Scripts\python.exe -m pytest -q` per le suite complete, obbligatorie prima di ogni commit secondo `AGENTS.md`. L'elenco degli script e degli effetti è in [`operations.md`](./operations.md) e [`package.json`](../package.json). Un test passato non certifica modelli reali, semantica, interazione visiva o perdita di alimentazione.

## Prossimo lavoro offline

Conclusi nel seguito locale verifica nativa, pulizia esplicita dei log e inventario dei tre candidati: rimossi soltanto i tre ID completati, restano 36 attività. La policy log non introduce scadenze automatiche; race e smaltimento delle evidenze sono nel task esistente. Le qualifiche di distribuzione non eseguite e il [riesame degli advisory Monaco](./libraries.md#residui-ricontrollati--19-ottobre-2026) restano aperti. Il registro ufficiale npm non offre ancora un successore del fork braces. L'autorizzazione alle toolchain riguarda gli strumenti di sviluppo, senza estendersi all'installazione dell'app o ai modelli. I paragrafi seguenti conservano lo storico dei conteggi precedenti.

P03 conclude `SOURCE-ARCHIVE-LIFECYCLE-01` con [qualifica offline del ciclo di vita](./verification-source-archive-lifecycle-2026-10-19.md). Rispetto al lotto Python è rimossa soltanto questa voce, lasciando 39 attività; altre voci, priorità e note restano identiche. I conteggi dei lotti seguenti sono storici.

P03 conclude anche `QUALITY-PYTHON-CRITICAL-PATHS-01` con [gate e prove dei difetti](./verification-python-critical-2026-10-19.md). Rispetto al tracker successivo al lotto chat è rimossa soltanto quella voce; note, priorità e altre 40 attività sono conservate. Nel lotto precedente `CHAT-DOCUMENT-COVERAGE-01` era stato concluso con [evidenze dedicate](./verification-chat-coverage-2026-10-19.md), lasciando 41 attività. Le sezioni datate successive mantengono i conteggi storici del rispettivo lotto.

La qualifica CI del [lotto chat/bozze](./verification-chat-drafts-ci-2026-10-18.md#qualifica-remota-conclusa--19-ottobre-2026) è conclusa sul commit `c0cd5a3`. Il prossimo lavoro offline disponibile comprende la verifica dei tool non Node, P2 già presente nel tracker; i controlli Python critici sono ora conclusi nel lotto sopra. Il worker XLS è implementato e qualificato nei sorgenti Windows e nel [candidato frozen corrente](./verification-current-source-2026-10-19.md); il confine desktop installato resta nel task esistente. Il [lotto ricerca/FTS/I/O](./verification-retrieval-efficiency-2026-10-18.md) misura ora 10.000/100.000 chunk dichiarati e rimuove le riletture dell'archivio nella stessa ricerca; il task conserva distribuzioni/dimensioni più ampie, contesa, encoder e desktop installato. I checkpoint già implementati non sono da duplicare: i relativi task conservano soltanto le qualifiche ulteriori dichiarate nel tracker. Nessuna di queste voci autorizza migrazioni personali, pulizia dei dati, installazione, pubblicazione o nuove chiamate ai modelli.

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

## Recupero chat e bozze in CI — 2026-10-18

La [CI di d8e6907](https://github.com/dennidalpos/OnlyRagV2/actions/runs/39144849431) è fallita sul click centrale di Monaco; coverage e Sidecar successivi sono stati saltati. Il [lotto mirato](./verification-chat-drafts-ci-2026-10-18.md) riproduce il canvas che intercetta il click nella finestra nativa minima. Il probe usa ora il focus dell'input tastiera reale, verifica il focus e conserva le asserzioni di checkpoint, interruzione, revisione, rifiuto della chiusura, retry e readback. Entrambi i profili desktop, 1024×720 e 1920×1080, passano localmente; aggiunti diagnostica geometrica e screenshot in caso di fallimento.

Build passata; coverage completa con 2.890 test passati e soglie superate; Python 568 passati e un symlink saltato. Le precedenti prove locali restano valide nei propri limiti, ma non attestano CI verde. `CI-CHAT-DRAFT-RECOVERY-QUALIFICATION-01` resta aperto fino a un run remoto positivo sul commit risultante, inclusi i gate successivi. Nessuna modifica applicativa, modello reale, installazione, migrazione personale, commit o push in questo lotto.

## Ammissione XLS in processo Windows — 2026-10-18

Il [lotto XLS](./verification-xls-admission-2026-10-18.md) sposta materializzazione e stringhe globali in un processo senza database/OCR/modelli. Prima di inviare il workbook, il servizio Python assegna il worker a un Job Windows con limiti di commit e numero di processi; un solo worker, timeout 60 secondi e output limitato. Il budget dichiarato è 512 MiB: soglia Win32 di 496 MiB con 16 MiB di riserva per il conteggio di picco. Il limite resta attivo con l'opt-in formato completo. Il foglio numerico massimo prima accettato dal candidato storico viene ora rifiutato nel caso denso oltre budget; il caso sparso all'ultima coordinata rimane ammesso in formato completo.

Il task XLS resta aperto per worker frozen/desktop installato. Le prove sorgente verificano limite di allocazione reale, timeout, mancata ammissione, arresto del proprietario, coordinate, fogli multipli, stringhe globali e invariabilità di indice e archivi preesistenti sui rifiuti. La copia originale del task fallito resta conservata secondo la politica esistente. Non sono state avviate installazioni, migrazioni personali o nuove chiamate a modelli; nessun commit o push.

Verifiche finali del lotto XLS: suite completa TypeScript 2.890 passati; Python 581 passati e un symlink saltato; build, compilazione sintattica Python, qualità statica, documentazione su 66 pagine e diff passati. I 43 ID del tracker sono conservati: aggiornata soltanto la voce XLS con il residuo frozen/installato e i relativi criteri.

## Ricerca, FTS e I/O degli archivi — 2026-10-18

Il [lotto RAG](./verification-retrieval-efficiency-2026-10-18.md) misura ricerca completa, primo FTS, coda non indicizzata, navigazione, lock e letture su 10.000/100.000 chunk con encoder dichiarato. Per cinque risultati dello stesso documento, archivio e revisione canonica vengono ora verificati una volta nella richiesta: letture logiche dell'archivio ridotte dell'80%, senza cache tra richieste. Sul fixture maggiore la mediana completa passa da 310,47 a 166,11 ms; risultati ordinati, provenienza, archivi e record coincidono. Campioni e hash dei sorgenti sono conservati nei dati collegati al resoconto.

Suite completa Python: 583 passati e un symlink saltato, junction reale eseguita. AST su 65 file, qualità statica su 851 file/103 handler, documentazione su 67 pagine, confronto tracker e diff passati. I 43 ID restano aperti: aggiornata soltanto la voce RAG rispetto all'inizio del lotto, con residui per distribuzioni/dimensioni più ampie, contesa, encoder e desktop installato. Il probe CI e il lavoro XLS preesistenti sono preservati. Nessuna nuova chiamata modello, installazione, migrazione personale, pulizia delle evidenze, commit o push. Build, suite TypeScript completa ed Electron non ripetuti per questo cambiamento Python.

## Consolidamento finale CI, XLS e RAG — 2026-10-18

L'utente ha successivamente richiesto allineamento di tracker e SecondBrain, commit e push finale, consolidamento dei branch sul principale ed eliminazione di quelli obsoleti. Questa richiesta autorizza le operazioni Git del lotto; le precedenti note «nessun commit o push» descrivono le fasi anteriori.

Remoto Git/GitHub verificato: `https://github.com/dennidalpos/OnlyRagV2.git`, pubblico, principale `master`. Prima del commit, HEAD e remoto coincidono su `d8e690717f0e26704127d80b3549d86dceb6f2ef`. Dopo fetch, inventario locale, riferimenti remoti effettivi, worktree e PR aperte confermano soltanto `master`: nessun branch da unire o eliminare. I riferimenti interni degli IDE sono conservati.

Tracker: stesso schema, 43 ID aperti univoci (25 autonomi e 18 con decisione utente). Le qualifiche XLS frozen/installato e RAG più ampie restano aperte; la voce CI registra ora l'autorizzazione Git e conserva il requisito del run remoto positivo sul commit risultante, inclusi coverage e Sidecar. I risultati locali non chiudono la qualifica remota; il run fallito `39144849431` resta conservato.

Gate pre-commit ripetuti sul codice finale:

| Comando | Esito |
| --- | --- |
| `npm run test -- --reporter=dot --silent=true` | 2.890 passati in 320 file, 205,93 s. |
| `.venv\Scripts\python.exe -B -m pytest -q -rs --tb=short -p no:cacheprovider` | 583 passati e un symlink saltato, 186,76 s. Junction reale eseguita. |
| `npm run build` | TypeScript, Renderer, Main e Preload passati. |
| `node scripts/e2e/chatDraftRecovery.mjs` | Passato nei profili nativi 1024×720 e 1920×1080, con interruzione, retry e readback. Nessun modello reale. |
| `npm run quality:static`, `npm run docs:check`, `git diff --check` | Passati: 851 file/103 handler e 67 pagine Markdown. |
| Confronto tracker e ricevute RAG | 43 ID univoci; hash dei report e dei sorgenti finali corrispondenti. |

Diff rivisto; scansione mirata dei 26 file del lotto senza riscontri di chiavi private o formati comuni di token, senza certificazione generale di sicurezza. Backup verificato dei file modificati/non tracciati e del dossier, patch binaria e bundle Git validato in `%TEMP%/onlyrag-publish-046e767737804206bbdae8a9d0fff79f`. SHA del commit e readback remoto vengono registrati nel dossier dopo il push. Nessuna installazione, migrazione personale, nuova chiamata modello, cancellazione di evidenze o pubblicazione di installer.

## Riconciliazione e CI conclusa — 2026-10-19

Verificato direttamente il [run Windows 39162219398](https://github.com/dennidalpos/OnlyRagV2/actions/runs/39162219398) sul commit `c0cd5a3db3d2bb1bc3bdfe79962ff279a4862792`: esito complessivo e singoli gate recupero chat/bozze, coverage e Sidecar tutti `success`. Rimossa soltanto `CI-CHAT-DRAFT-RECOVERY-QUALIFICATION-01`; le altre 42 attività conservano ID, priorità e perimetro. Esplicitati i criteri di completamento mancanti delle voci autonome usando il campo `verify` già previsto. Nessuna qualifica XLS frozen/installato, RAG generale o modello reale dedotta dalla CI. I passaggi precedenti che dichiarano CI aperta descrivono lo stato storico prima di questa verifica.

Il principale effettivo è `master`, sul remoto pubblico `dennidalpos/OnlyRagV2`. Inventario dopo fetch: un solo branch locale/remoto e un solo worktree, nessuna PR aperta, nessun lavoro separato da integrare e nessun branch obsoleto da rimuovere. I riferimenti interni degli IDE non sono branch di sviluppo.

Recepita la migrazione preesistente della memoria dalla radice al dossier SecondBrain: ogni riga non vuota del precedente `memory.md` è presente nel dossier, con backup e bundle Git verificato fuori dal checkout. Le direttive applicabili indicano ora quella sede unica; nessuna modifica ai sorgenti applicativi, ai test o alla CI in questa riconciliazione.

Gate pre-commit ripetuti in questa riconciliazione: `npm run test -- --reporter=dot --silent=true`, 2.890 passati in 320 file (194,43 s); `.venv\Scripts\python.exe -B -m pytest -q -rs --tb=short -p no:cacheprovider`, 583 passati e un symlink saltato (170,34 s), con junction reale eseguita. `npm run docs:check` passa su 67 pagine; `npm run quality:static` su 851 file e 103 handler IPC; confronto JSON del tracker e `git diff --check` passati. Build ed Electron non ripetuti localmente per questo solo cambiamento documentale; la CI citata appartiene al commit applicativo precedente, non certifica automaticamente il nuovo commit.

Dossier SecondBrain aggiornato con sessione Write e readback; sincronizzazione tramite `secondbrain.ps1 -Sync` riuscita, zero segnalazioni. Diff e `git status --ignored` rivisti. I due log generati dai test sono trasferiti fuori dal checkout con readback SHA-256; backup e ricevute restano in `%TEMP%/onlyrag-reconcile-5e939da40c17470db7639bcc5b82b182`. Nessuno scratch, backup di prova o worktree temporaneo creato nel repository. La cancellazione delle cache Python preesistenti (`.pytest_cache` e `__pycache__`) è stata rifiutata dalla revisione automatica delle autorizzazioni con «blocked by policy»: restano ignorate e non incluse nel commit. Dipendenze, build, release e dati preesistenti sono conservati.

## P03: candidato corrente — 2026-10-19

Preso in carico il primo autonomo P2, `DISTRIBUTION-CURRENT-SOURCE-QUALIFICATION-01`. La [ricevuta](./verification-current-source-2026-10-19.md) qualifica corrispondenza dei file, CPU OCR/auth/PDF/ricerca, 29 test HTTP frozen, contenimento/timeout/crash XLS e flussi nativi IPC con risposte sintetiche (17 ingestioni, traduzione PDF/DOCX e riapertura). Il task resta aperto per i gate più ampi già documentati, senza nuove installazioni o campagne modello. Aggiornate quella voce e il residuo XLS collegato: 42 ID, priorità e altre 40 attività preservati. Nessuna modifica applicativa, commit o push. Il candidato conserva lo snapshot pulito 95752a0; questa documentazione è successiva alla build. Anche la [CI del commit 95752a0](https://github.com/dennidalpos/OnlyRagV2/actions/runs/39170618618) è conclusa con successo.

## Consolidamento del lotto P03 — 19 ottobre 2026

Riletti sorgenti effettivi e 29 hash delle evidenze; runtime identico alla build 95752a0. Il [consolidamento autorizzato](./verification-current-source-2026-10-19.md#consolidamento-autorizzato-per-pubblicazione--19-ottobre-2026) mantiene 42 attività aperte e aggiorna cinque descrizioni rispetto a quel commit: distribuzione, XLS, chat, bozze e inventario dei candidati conservati. Nessuna nuova chiusura; priorità, note e schema invariati. Suite complete ripetute: 2.890 TypeScript e 583 Python passati, un symlink saltato; docs/statico/diff passati. Nessuna modifica applicativa o nuova qualifica live/installata. Il solo branch esistente è master, senza integrazioni o rimozioni necessarie. Le dichiarazioni precedenti di assenza di commit/push riguardano la fase P03, prima della richiesta esplicita di pubblicazione.
