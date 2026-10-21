# Documentazione OnlyRag V2

La [consegna del tracker per il cambio sessione](./session-handoff-tracker-2026-10-21.md) raccoglie il lavoro completato, i due P2 mantenuti aperti per decisione del proprietario, le verifiche pre-commit e i riferimenti di ripresa; commit e push su `master` autorizzati.

Il [seguito FTS del 21 ottobre](./verification-fts-api-2026-10-21.md) conclude l'aggiornamento all'API supportata di LanceDB con parità verificata; restano due P2 aperti, senza candidata upstream braces né prova TCP attribuibile per il dev-server.

La [ripresa e il completamento dei task locali del 21 ottobre](./verification-tracker-completion-2026-10-21.md) registrano le nuove verifiche, le chiusure effettive e i residui. Per il lavoro ancora aperto prevale [PROJECT_STATUS.json](../PROJECT_STATUS.json).

Il [passaggio di sessione UX del 21 ottobre](./session-handoff-ux-2026-10-21.md) salva le correzioni verificate, dieci task autonomi residui e l’autorizzazione al commit/push sul principale.

Le [correzioni UX/UI mirate del 21 ottobre](./verification-ux-targeted-2026-10-21.md) distinguono osservazioni e rilievi statici, riportano prove Electron isolate, tastiera/zoom, scelta esplicita dei modelli e limiti dei servizi controllati.


**Stato operativo corrente:** [sviluppo locale e test autonomi](./local-development-policy-2026-10-20.md); attività ancora aperte in [PROJECT_STATUS.json](../PROJECT_STATUS.json), completamenti e residui nel [resoconto del 21 ottobre](./verification-tracker-completion-2026-10-21.md). Restano ritirati i 24 task decisi dal proprietario, gli obblighi CI e le qualifiche dei modelli. I conteggi dei resoconti precedenti sotto sono storici.

[Consegna per il cambio sessione del 21 ottobre](./session-handoff-local-ui-2026-10-21.md): tracker aggiornato, verifiche locali e riferimenti per riprendere gli 11 task; commit e push su `master` autorizzati dal proprietario.

[Passaggio di sessione Sidecar e verifiche locali](./session-handoff-sidecar-2026-10-20.md): lavoro e 34 task salvati, commit/push su `master` richiesti esplicitamente; scelta solo offline dei modelli conservata. La CI della consegna richiede il proprio readback.

Corretto lo [stato iniziale del Sidecar in sviluppo](./verification-sidecar-dev-startup-2026-10-20.md): `Verifica...` durante la preparazione, errore offline visibile a fine avvio. Prove Python/Electron isolate e regressioni passate; riavviare il dev per caricare il Main aggiornato.

Il [piano offline per la lingua delle risposte](./plan-chat-language-2026-10-20.md) verifica e congela il prossimo confronto P1 senza inferenze. Il proprietario ha confermato il perimetro solo offline: nessun candidato integrato e nessun task chiuso.

La [ripresa del tracker](./verification-tracker-resume-2026-10-20.md) completa il readback CI di `e48c468` e aggiunge la diagnosi nativa ripetibile del dev-server: 34 attività ancora aperte, con i motivi delle qualifiche parziali conservati.

Il [passaggio di sessione delle correzioni locali](./session-handoff-local-fixes-2026-10-20.md) salva tre completamenti, 34 attività aperte e il residuo audit; commit e push su `master` autorizzati per questa consegna. Le sezioni successive mantengono le rispettive date ed evidenze storiche.

Il [seguito locale del tracker](./verification-tracker-local-2026-10-20.md) conclude tre task e registra un nuovo residuo di recupero dell'audit di sviluppo: **34 aperti**. Il [sanitizer Monaco](./verification-monaco-sanitizer-2026-10-20.md) usa DOMPurify 3.4.17 verificato nativamente; le [misure RAG 768/1024D con contesa](./verification-retrieval-contention-2026-10-20.md) passano il p95 locale di 5 secondi. I [due task CI](./verification-ci-boundaries-2026-10-20.md) mantengono la qualifica remota pendente.

Il [seguito delle correzioni di traduzione](./verification-translation-fixes-2026-10-20.md) conclude pubblicazione esclusiva PDF/DOCX e copertura DOCX dichiarata. I conteggi degli audit precedenti sono storici; le qualifiche con modelli reali e app installata rimangono distinte.

Il [passaggio di sessione dell'audit](./session-handoff-audit-2026-10-20.md) salva i 36 residui e la richiesta esplicita di commit/push su master; le verifiche pre-commit e la CI della nuova consegna restano distinte dall'audit precedente.

L'[audit corrente dei residui](./repository-residue-audit-2026-10-20.md) registra **36 attivita aperte**, tre nuovi P2 e CI b470387 fallita sul worker dipendenze. Prove DOCX isolate, nessuna correzione applicativa. Il percorso TEMP della sanificazione non e disponibile e resta nel task di conservazione; conteggi/esiti delle ricevute precedenti sono storici.

Il [passaggio di sessione del seguito tracker](./session-handoff-tracker-2026-10-20.md) salva cinque completamenti e 33 residui, incluso il nuovo timeout CI verificato, limiti delle campagne e prossime decisioni; commit/push dei sorgenti su `master` richiesti esplicitamente.

La [campagna live del 20 ottobre](./verification-live-content-2026-10-20.md) e i giudizi sono conservati: raccolta completa, accettazione fallita e qualifica P1 aperta.

Le guide descrivono il comportamento verificato nel codice al **13 ottobre 2026**. Per API e comandi prevalgono [`shared/ipc/ipcContract.ts`](../shared/ipc/ipcContract.ts), [`sidecar/main.py`](../sidecar/main.py), [`sidecar/schemas.py`](../sidecar/schemas.py) e [`package.json`](../package.json). Il lavoro aperto è nel [`tracker`](../PROJECT_STATUS.json).

## Guide per ambito

| Ambito | Guida |
| --- | --- |
| Guida visiva per l’utente finale (15 ottobre 2026) | [Scelte e flussi per ogni funzione](./guida-utente.md) |
| Architettura e confini | [`architecture.md`](./architecture.md) |
| Renderer, Main e contratti | [`frontend.md`](./frontend.md), [`electron-main.md`](./electron-main.md), [`api-ipc.md`](./api-ipc.md), [`api-rest.md`](./api-rest.md) |
| Ingestion, OCR e originali | [`ingestion.md`](./ingestion.md) |
| Embedding e ricerca | [`retrieval.md`](./retrieval.md) |
| Traduzione | [`translation.md`](./translation.md) |
| Coding Agent | [`coding-agent.md`](./coding-agent.md) |
| Setup, comandi e dati protetti | [`operations.md`](./operations.md) |
| Dipendenze | [`libraries.md`](./libraries.md) |
| Distribuzione locale | [`distribution.md`](./distribution.md) |
| Verifica attuale e limiti | [`verification-current.md`](./verification-current.md) |

## Specifiche e prove conservate

Il [passaggio di sessione dell’audit critico](./session-handoff-critical-audit-2026-10-21.md) salva correzioni, inventario delle versioni e tracker sul branch principale; conserva i due P2 aperti e i residui operativi protetti.

L'[audit critico del 21 ottobre](./critical-application-audit-2026-10-21.md) corregge fetch/download, streaming UTF-8 e versioni Informazioni, aggiorna Pillow 13.0.0 ed Electron 43.8.3 e distingue audit locali, alert remoti, residui e proposte di aggiornamento. Include un [inventario delle dipendenze](./evidence/critical-audit-dependencies-2026-10-21.json).

Il [seguito del tracker del 20 ottobre](./verification-tracker-followup-2026-10-20.md) riunisce cinque completamenti e 32 residui. È conclusa anche la [qualifica XLS installata](./verification-installed-xls-2026-10-20.md), con 14 casi nativi e corrispondenza dei 31 moduli Python congelati. La [campagna ledger di otto chiamate](./verification-ledger-bounded-2026-10-20.md) ha esaurito il budget: audit installato riletto, qualifica semantica ancora aperta.

Le [dimensioni del candidato del 20 ottobre](./verification-candidate-footprint-2026-10-20.md) sono misurate sullo stesso installer estratto e installato: CPU OCR e avvio automatico passano, qualità e altri gate rimangono separati. Il conteggio storico di quel lotto è 32 attività aperte dopo cinque chiusure; le ricevute datate mantengono i propri conteggi.

Il [passaggio di sessione del recupero e dello storico](./session-handoff-recovery-2026-10-20.md) documenta la pubblicazione su master, il successo CI della consegna runtime e i 37 residui. La [riconciliazione inflight](./verification-inflight-reconciliation-2026-10-20.md) è ora implementata e qualificata; sono concluse anche impostazioni installate, misure del candidato e valutazione del chunking. Candidato, installazione isolata e modelli locali su dati di prova sono autorizzati; gli esiti sono distinti nelle ricevute del seguito. Restano separati i gate installati/live e le altre decisioni non risposte.

La [provenienza degli embedding dello storico](./verification-history-provenance-2026-10-20.md) corregge il difetto sorgente e distingue i residui live/migrazione. L'[indagine sulle sonde loopback](./verification-loopback-probes-2026-10-20.md) conserva 50.000 misure senza dichiarare risolta l'intermittenza.

Il [recupero agente del 20 ottobre](./verification-agent-crash-recovery-2026-10-20.md) qualifica arresto forzato del processo posseduto, conservazione della coda, ripresa esplicita, trascrizione e checkpoint dei file. Distingue gli esiti confermati dagli effetti ignoti, ora gestiti dal successivo flusso di ispezione e abbandono.

Il [riallineamento della suite Electron](./verification-agent-harness-2026-10-20.md) completa il residuo delle fixture di cancellazione e riesegue otto scenari di affidabilità e nove guard con HTTP e generazione isolati.

La [verifica delle fixture CI Windows](./verification-ci-fixtures-2026-10-20.md) distingue il run remoto fallito, le due correzioni locali e la futura qualifica remota dell'esatto commit autorizzato.

La [consegna del 20 ottobre](./session-handoff-verifier-2026-10-20.md) riunisce audit, quattro rilievi conclusi, 36 attività residue e verifiche per la pubblicazione dei sorgenti su `master`.

Checkpoint chat, archivio delle bozze e budget complessivo del prompt del 16 ottobre sono descritti in [recupero e contesto](./verification-chat-drafts-context-2026-10-16.md).

Le [correzioni del verificatore del 20 ottobre 2026](./verification-project-regressions-2026-10-20.md) qualificano le quattro attività emerse nell’audit, con 16 casi nativi e distinzione fra successo strutturale e test eseguiti.

L’[audit dei residui del 19 ottobre 2026](./repository-residue-audit-2026-10-19.md) confronta codice, guide, test e tracker; conserva quattro nuovi rilievi confermati e i limiti della ricognizione offline, con [ricevuta JSON](./repository-residue-audit-2026-10-19.json).

La verifica del repository del 14 ottobre 2026 è in [`repository-audit-2026-10-14.md`](./repository-audit-2026-10-14.md).

Le regressioni del 16 ottobre su UTF-8, aggiornamenti concorrenti, export, pulizia dell'ingestion annullata e lock della ricerca sono in [`verification-behavior-contracts-2026-10-16.md`](./verification-behavior-contracts-2026-10-16.md).

[`model-task-baselines.md`](./model-task-baselines.md), [`model-runtime-fit.md`](./model-runtime-fit.md) e [`content-acceptance.md`](./content-acceptance.md) definiscono profili e corpus con i loro limiti. [`agent-runtime.md`](./agent-runtime.md), [`agent-guards.md`](./agent-guards.md) e [`agent-diagnostics.md`](./agent-diagnostics.md) contengono dettagli del Coding Agent. [`distribution-licenses.md`](./distribution-licenses.md), [`distribution-cpu-release.md`](./distribution-cpu-release.md) e [`distribution-agpl-proposal.md`](./distribution-agpl-proposal.md) conservano inventari, decisioni e hash dei candidati.

[`verification.md`](./verification.md), [`rag-sidecar.md`](./rag-sidecar.md), [`agent-runtime.md`](./agent-runtime.md) e [`libraries.md`](./libraries.md) mantengono gli ancoraggi dei link precedenti e rinviano agli archivi datati. Audit e revisioni di corpus sono **evidenze**, non descrizioni correnti: [`repository-residue-audit-2026-10-05.md`](./repository-residue-audit-2026-10-05.md), [`critical-app-audit-2026-10-01.md`](./critical-app-audit-2026-10-01.md), [`reliability-audit-2026-09-30.md`](./reliability-audit-2026-09-30.md), [`reliability-audit-2026-10-01.md`](./reliability-audit-2026-10-01.md), [`coding-agent-audit-2026-09-26.md`](./coding-agent-audit-2026-09-26.md), [`request-ledger-human-review-2026-10-10.md`](./request-ledger-human-review-2026-10-10.md), [`translation-language-audit-2026-10-13.md`](./translation-language-audit-2026-10-13.md) e [`translation-fidelity-2026-10-01.md`](./translation-fidelity-2026-10-01.md).

[`prompt_test_sequenza.txt`](./prompt_test_sequenza.txt) è un input di prova congelato. [`licenses/`](./licenses/) conserva testi, attribuzioni e inventari di licenza; [`DISTRIBUTION-LICENSE.md`](../DISTRIBUTION-LICENSE.md) è la nota destinata al pacchetto. Le skill locali in [`skills/`](../skills/) sono istruzioni eseguibili, controllate con la documentazione.

`npm run docs:check` controlla link locali, ancoraggi Markdown e comandi `npm run`. Una prova offline, un PDF esportato o un build riuscito non equivalgono a qualifica semantica o dell'app installata.

Le vecchie panoramiche `agent.md` e `decisions.md`, duplicate rispetto alle guide per ambito, sono state ritirate; l'audit datato conserva il riferimento alla seconda.

Le [impostazioni installate](./verification-installed-settings-2026-10-20.md) passano chiusura, retry e interruzione con readback completo. Avvio automatico Sidecar e perdita di alimentazione mantengono i rispettivi task.
