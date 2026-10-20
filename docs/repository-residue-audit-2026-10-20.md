# Audit dei residui del repository - 20 ottobre 2026

Ricognizione su master, commit b4703874caf8adc8fbe0a51ee409275f6752c641: **1.173 file tracciati**, 33 task iniziali e modifica locale preesistente al tracker preservata. Esaminati inventario, requisiti, manifest, principali confini applicativi, test, guide e tutti i record aperti. E un audit trasversale con controlli automatici e approfondimenti mirati: **non e una revisione manuale riga per riga, una qualifica installata o una certificazione generale del prodotto**.

Il [tracker](../PROJECT_STATUS.json) passa a **36 aperti: 18 autonomi / 18 owner-required; 4 P1 / 28 P2 / 4 P3**. Aggiunti tre P2 verificati; nessun precedente ID chiuso, riaperto, riprioritizzato o spostato. I campi originali dei 33 record sono conservati integralmente come prefissi, incluse accettazioni e modifica locale iniziale. Schema invariato: important_notes; todo_autonomous con id/p/task/verify; todo_user_required con id/p/decision. Le nuove note datate distinguono il difetto confermato dal confine ancora da qualificare.

La [ricevuta JSON](./repository-residue-audit-2026-10-20.json) contiene tutti i record, priorita, stato, osservazione, fonti/hash e criteri originali, oltre ai risultati e ai limiti. Nessuna correzione a sorgenti, test o configurazioni applicative. Report, indice, stato corrente e dossier documentano esclusivamente l'audit.

## Nuovi rilievi confermati

### P2 - CI-DEPENDENCY-SCAN-WORKER-DEADLINE-01

La [CI dell'esatto b470387](https://github.com/dennidalpos/OnlyRagV2/actions/runs/39458594764) e completed/failure: il caso coda/deadline di [dependencyScanWorkerClient.test.ts](../electron/core/infrastructure/process/dependencyScanWorkerClient.test.ts), riga 84, fallisce con timeout di 2.000 ms alla riga 39 del [client](../electron/core/infrastructure/process/dependencyScanWorkerClient.ts). Risultato: 2.951 passati, uno fallito, suite completa Sidecar saltata. Non e dimostrato un guasto del runtime produttivo.

Diagnosi richiesta: startup del worker, scadenza in coda, annullamento, attesa della terminazione e nuova ammissione sotto coverage Windows. Conservare deadline comprensiva della coda, esclusione di parser sovrapposti e rifiuto del lavoro scaduto prima del dispatch. Non limitarsi ad aumentare timeout o eliminare asserzioni. Criterio: regressioni native pertinenti e successo remoto dell'esatto successivo SHA pubblicato con autorizzazione specifica. Dieci casi locali mirati e suite ordinaria verde non spiegano il fallimento remoto.

### P2 - TRANSLATION-OUTPUT-PUBLICATION-01

[translator.py](../sidecar/domain/translator.py), righe 979-991, 1188 e 1266-1276: il nome finale viene scelto con exists prima della traduzione, poi il writer salva direttamente nel percorso. Un DOCX estraneo creato dopo l'allocazione e prima del salvataggio viene sostituito, con terminale done. Un errore iniettato dopo due scritture ZIP reali lascia un DOCX invalido di **887 byte nel nome finale**. Il secondo stream segnala correttamente error, senza done. Gli originali restano invariati.

Impatto: sovrascrittura silenziosa di un output comparso nel frattempo e residui parziali ambigui nel percorso scelto. Ambito: scelta/pubblicazione PDF e DOCX; la riproduzione nativa attuale riguarda DOCX. Criterio: output completi pubblicati senza sostituire file esistenti o comparsi dopo il preflight, staging posseduto distinto dal nome finale, rifiuti/cleanup falliti espliciti e recuperabili. Verificare collisioni, fault dopo scritture vere, stop e retry con regressioni native PDF/DOCX; preservare sorgenti e file estranei.

### P2 - TRANSLATION-DOCX-CONTENT-COVERAGE-01

[_collect_docx_runs](../sidecar/domain/translator.py), righe 138-153, percorre corpo e paragrafi diretti delle celle. Omette intestazioni, pie di pagina e celle delle tabelle annidate. La prova con DOCX reale e orchestrazione produttiva traduce corpo e tabella esterna ma conserva tre testi SOURCE in questi contenitori e restituisce comunque done.

Impatto: testo Word ordinario visibile resta nella lingua sorgente, mentre il documento e presentato come tradotto. Criterio: dichiarare i contenitori supportati e visitarli ricorsivamente una volta sola, preservando parti condivise/collegate, formattazione, marker e letterali; testo visibile non supportato va esplicitamente segnalato/rifiutato. Verificare header/footer collegati tra sezioni, tabelle annidate, rifiuti e originali invariati. Non estendere questa prova a ogni funzione OOXML o alla qualita linguistica.

### Confine delle tre prove

Eseguite sei funzioni AST estratte **senza modifica** dal sorgente, SHA256 3156f12b2b02f38382044b32e4dcc3c3fe63ac9fe0a5ffcbbe09b698b3db38a6. Parsing, salvataggio DOCX/ZIP e readback sono reali, con Python 3.13.15 e python-docx 1.2.0. Solo la traduzione dei batch e una fixture dichiarata SOURCE -> TARGET; il fault interviene dopo scritture ZIP effettive. Le prove passano perche riproducono i difetti, non perche li correggono.

Librerie aggiunte esclusivamente nella fixture esterna: python-docx 1.2.0, lxml 6.1.3, typing_extensions 4.16.0. Non e l'ambiente Sidecar completo. Non sono stati avviati endpoint REST, modelli, PDF o app installata. Il collector di qualita installata resta distinto dalle nuove correzioni sorgente.

## Residui esistenti, senza duplicazioni

- Il timeout retention di f1dd1b7 resta nel proprio task: nel run b470387 il caso retention passa, ma fallisce il worker. Quattro casi retention locali passano sotto coverage; nessuno di questi risultati diagnostica l'intermittenza precedente.
- RETAINED-RESIDUE-DISPOSAL-01 registra l'indisponibilita del root dichiarato C:/Users/Utente/AppData/Local/Temp/onlyrag-sanitation-20261020-184059-3a743b83, inclusi preserved, report/manifesti e venv. Lookup diretto fallito; nessun root corrispondente nella ricerca del solo prefisso al primo livello TEMP. **Causa, cancellazione e disponibilita di altre copie non accertate**: non e una dichiarazione di perdita. Individuare/verificare una copia recuperabile prima di fare affidamento sui vecchi percorsi o smaltire prove.
- Esistono i quattro root durevoli sotto C:/Users/Utente/OnlyRag-Live: source-publication-20261020-b617f8d1, tracker-followup-20261020-c9663097, request-ledger-bounded-20261020-v1, installed-xls-20261020-v1. La presenza non ricertifica contenuti completi o hash di tutti gli artefatti.
- Fork braces, compatibilita sessioni e sanitizer incorporato sono residui gia tracciati: upstream braces ancora 3.0.3; Monaco 0.56.0 incorpora DOMPurify 3.4.8; migrazione/fallback sessioni hanno riferimenti attivi. Knip verde non autorizza la rimozione della compatibilita.
- I P1 mantengono i fallimenti conservati: qualita 5/12 congiunte e 9/11 retrieval globale; estrazione ledger 1/4 semantica, zero piani accettati nel budget di otto chiamate esaurito. Nessuna nuova inferenza o review live. Le qualifiche traduzione/marker/installato rimangono aperte.

## Piano degli interventi

1. Diagnosticare CI e correggere i due confini DOCX con fixture native offline indipendenti; verificare concorrenza, conservazione dei byte e rifiuti, senza indebolire asserzioni o accettazioni.
2. Risolvere la localizzazione/verificabilita delle prove della sanificazione nel task di conservazione esistente prima di riutilizzare candidati o smaltire file. Ricostruire dipendenze non recupera prove storiche.
3. Qualificare un candidato corrispondente alle successive correzioni. Per riprendere qualita/ledger mantenere oracoli e marker; ledger richiede un nuovo budget esplicito. Prima delle prestazioni RAG resta da scegliere carico/contesa/dimensioni e latenza: nessuna delle proposte 10k/100k o 2/5 secondi e assunta concordata.
4. Proseguire qualifiche residue secondo dipendenze e priorita, mantenendo separati real-model, installazione, hardware, dati personali, diritti e pubblicazione. Questo audit non implementa il piano, non chiude task e non autorizza commit/push.

## Aree esaminate e limiti

| Area | Esame eseguito | Non qualificato in questo audit |
| --- | --- | --- |
| Repository/requisiti/tracker | Direttive, dossier/PARA attivo, manifest, 1.173 path, tutti i 33 record iniziali e 131 riferimenti esistenti. | Ogni riga di ogni file, ogni vecchio artefatto binario. |
| Renderer/Electron/IPC | Entry point, close gate, mittente/schema, sandbox/navigazione, 107 handler, hook chat/bozze/traduzione e suite DOM/Node. | Desktop installato 1080p, assistive technology, review visiva, penetration test. Smartphone/tablet fuori prodotto. |
| Ingestion/REST/archivi | Route/schema, conservazione originali, ammissione tabulare, cancellazione/recupero, test e sintassi Python. | Pytest/gate critico attuali, parser/OCR frozen e memoria nativa. |
| RAG/storico/rebuild | Query/versioni/lock, reranker lessicale, provenienza storico, attivazione/rollback documentale, ricevute. | Encoder reale nuovo, contesa 100k, migrazione/rebuild personale, scoring live. |
| Traduzione | Ownership Main/REST, collector/writer DOCX e tre probe native. | Semantica modello, PDF nativo, completezza OOXML generale e resa visiva/installata. |
| Coding Agent | Verificatore/profili/cwd, shell/queue/recovery, checkpoint, worker, skill/policy, suite e CI. | TaskLab, rete agente reale, OOM/thinking/modelli reali. |
| Sicurezza/dipendenze | Confini IPC/token REST/URL-DNS, lock/fork/Monaco, Knip/cicli/statico e npm audit. | Certificazione di sicurezza, raggiungibilita di tutti gli advisory, dipendenze Python/native aggiornate. |
| Distribuzione/operazioni | Manifest installer, setup/build/cleanup, ricevute candidato e percorsi esterni, dati ignorati. | Build/install/update, diritti/firma completi, power-loss e cancellazione di residui preesistenti. |

Esclusi prima di tracciare: i marker TODO nelle istruzioni/rilevatori non indicano implementazioni mancanti. Il sospetto unmount da normale cambio tab e smentito dai pannelli visitedTabs mantenuti montati in AppLayout. Il primo errore Git e della copia di audit, non del prodotto. Nessun completamento storico riaperto per somiglianza di nome.

## Verifiche

| Controllo | Risultato e limite |
| --- | --- |
| npm ci --ignore-scripts --offline --no-audit --no-fund nella copia esterna | 710 package dal cache. Nessun runtime Electron scaricato o modifica al checkout. Non e la qualifica npm ci/Electron/ASAR del fork. |
| npm run test nella copia con reporter JSON | **2.952 passati, 323 file, 197,75 s**. Primo tentativo: 2.951/uno fallito per Git mancante nella copia git archive. Dopo git init isolato senza commit, intera suite passata; conservati entrambi i log. |
| Vitest file worker / retention con coverage | **10 + 4 passati**. Soglie aggregate azzerate soltanto nei comandi mirati esterni: non e il gate coverage completo. |
| npm run quality:static | 863 file, 107 handler, layering, lint/formato passano; nessuna correzione automatica. |
| npm run typecheck; npm run audit:deadcode; npm run audit:cycles | Passano; Knip normale/production e nessun ciclo rilevato. Non provano assenza di difetti logici. |
| npm run docs:check; JSON; git diff --check | Prima e dopo l'audit; esiti finali nella ricevuta. |
| AST Python | 82 file sidecar/scripts senza errori, nessun pyc. Non esegue import o comportamento. |
| Pytest / quality:python / build / smoke Electron | Non eseguiti: venv assente e Python globale senza pytest/FastAPI/LanceDB/PyMuPDF; runtime Electron della fixture non installato. Nessun verde storico riportato come attuale. |
| Python translation_probe.py | Tre prove native DOCX riproducono due difetti con modello simulato e fault scrittura dichiarati. |
| npm audit --json --package-lock-only; npm view braces version --json | Zero advisory del lock; upstream 3.0.3 al readback. Non qualifica codice sanitizer incorporato o dipendenze Python/native. |
| gh run view 39458594764 con JSON / log-failed | Esatto SHA corrente completed/failure; log conservato, nessun dispatch/rerun o push. |

## Matrice di tutte le attivita aperte

Problema, impatto, ambito, dipendenze e completamento di ogni riga sono nei campi esistenti del tracker, copiati integralmente nella ricevuta JSON. La classificazione descrive cio che e confermato; una qualifica pendente non e un difetto produttivo automaticamente provato.

| ID | Priorita | Stato dell'evidenza | Fonti correnti |
| --- | --- | --- | --- |
| CI-DEPENDENCY-SCAN-WORKER-DEADLINE-01 | P2 | Nuovo rilievo confermato | electron/core/infrastructure/process/dependencyScanWorkerClient.test.ts |
| TRANSLATION-OUTPUT-PUBLICATION-01 | P2 | Nuovo rilievo confermato | sidecar/domain/translator.py |
| TRANSLATION-DOCX-CONTENT-COVERAGE-01 | P2 | Nuovo rilievo confermato | sidecar/domain/translator.py |
| CI-CAPABILITY-AUDIT-RETENTION-TIMEOUT-01 | P2 | Confermato storico, causa aperta | electron/core/infrastructure/logging/capabilityPolicyAuditRepository.test.ts |
| DISTRIBUTION-CURRENT-SOURCE-QUALIFICATION-01 | P2 | Parziale | scripts/build_package.ps1; docs/verification-installed-xls-2026-10-20.md |
| CHAT-EFFECTIVE-CONTEXT-ALLOCATION-01 | P2 | Qualifica necessaria | src/services/chatContextBudget.ts; src/hooks/useChatEngine.ts |
| RAG-INDEX-METADATA-EFFICIENCY-01 | P2 | Qualifica e scelta carico necessarie | sidecar/services/search_service.py; scripts/e2e/retrievalEfficiency.py |
| HISTORY-EMBEDDING-CORRECTNESS-01 | P2 | Parziale | sidecar/services/prompt_history_service.py; docs/verification-history-provenance-2026-10-20.md |
| CHAT-DURABLE-HISTORY-01 | P2 | Qualifica necessaria | src/hooks/useChatHistory.ts; electron/core/infrastructure/filesystem/chatHistoryRepository.ts |
| DOC-EDITOR-DRAFT-DURABILITY-01 | P2 | Qualifica necessaria | src/hooks/useDocumentDrafts.ts; src/components/layout/AppLayout.tsx |
| TRANSLATION-INPLACE-UNMOUNT-CANCELLATION-01 | P2 | Qualifica necessaria | src/hooks/useTranslation.ts; sidecar/services/task_cancellation.py |
| STATE-WRITER-CRASH-DURABILITY-01 | P2 | Qualifica necessaria | electron/core/infrastructure/filesystem/safeAtomicFileWriter.ts |
| DEPENDENCY-BRACES-UPSTREAM-01 | P2 | Residuo attivo confermato | vendor/braces-3.0.4/package.json; package-lock.json |
| RAG-EMBEDDING-REBUILD-QUALIFICATION-01 | P2 | Qualifica necessaria | sidecar/services/store_rebuild_service.py; scripts/rebuild_embeddings.py |
| LEGACY-SESSION-COMPAT-01 | P3 | Compatibilita attiva confermata | electron/core/infrastructure/filesystem/workspaceMetadataDirectory.ts; electron/core/infrastructure/filesystem/sessionHistoryRepository.ts |
| DISTRIBUTION-UPDATE-PATH-01 | P3 | Qualifica necessaria | installer/installer.nsh; package.json |
| DEPENDENCY-MONACO-VENDORED-SANITIZER-01 | P3 | Versione confermata, esposizione non qualificata | src/components/coding/CodingEditorContent.tsx; package-lock.json |
| DEVSERVER-LOOPBACK-PROBE-STABILITY-01 | P2 | Causa ancora aperta | electron/core/infrastructure/process/managedDevServerRepository.test.ts; docs/verification-loopback-probes-2026-10-20.md |
| QUALITY-CONTENT-LIVE-QUALIFICATION-01 | P1 | Fallimento semantico confermato dalle ricevute | docs/verification-live-content-2026-10-20.json; scripts/live/contentAcceptance.live.ts |
| LOCAL-MODEL-ROLE-QUALIFICATION-01 | P1 | Qualifica necessaria | shared/domain/hardware/modelRuntimeFit.ts; scripts/live/modelRuntimeFit.live.ts |
| LIVE-MODEL-HARDWARE-01 | P1 | Qualifica necessaria | scripts/live/taskLabSequence.live.ts; docs/agent-runtime.md |
| AGENT-REQUEST-LEDGER-LIVE-QUALIFICATION-01 | P1 | Parziale, budget esaurito | docs/verification-ledger-bounded-2026-10-20.json; electron/core/application/planGenerationAppService.ts |
| TRANSLATION-MARKERS-INSTALLED-01 | P2 | Qualifica necessaria | sidecar/tests/test_translator.py; docs/translation.md |
| DISTRIBUTION-COMPONENT-RIGHTS-QUALIFICATION-01 | P2 | Qualifica necessaria | scripts/release_artifacts.py; docs/distribution-licenses.md |
| DISTRIBUTION-PUBLIC-SOURCE-DELIVERY-01 | P2 | Qualifica e pubblicazione pendenti | docs/distribution-agpl-proposal.md; scripts/build_package.ps1 |
| MODAL-ASSISTIVE-TECHNOLOGY-QUALIFICATION-01 | P2 | Qualifica necessaria | src/components/common/Modal.tsx; src/lib/modalFocus.ts |
| QWEN38-FULLTASK-01 | P2 | Decisione ancora necessaria | scripts/live/fullTaskRun.live.ts; docs/reliability-audit-2026-09-30.md |
| RETAINED-RESIDUE-DISPOSAL-01 | P2 | Nuova indisponibilita confermata, causa ignota | scripts/cleanup_policy.ps1; docs/operations.md |
| RAG-SEMANTIC-RERANKER-QUALIFICATION-01 | P2 | Valutazione necessaria | sidecar/infrastructure/reranker.py; docs/retrieval.md |
| OLLAMA-RESOURCE-ADMISSION-01 | P2 | Qualifica necessaria | electron/core/infrastructure/http/ollamaGenerationScheduler.ts; sidecar/config.py |
| AGENT-SESSION-LIVE-01 | P2 | Qualifica necessaria | electron/core/application/taskQueueAppService.ts; electron/core/application/agentOrchestratorSessionSetup.ts |
| AGENT-SKILLS-LIVE-01 | P2 | Qualifica necessaria | electron/core/domain/skills/skillMatcher.ts; electron/core/domain/skills/skillAdherenceValidator.ts |
| AGENT-NETWORK-LIVE-01 | P2 | Qualifica necessaria | electron/core/application/webToolService.ts; electron/core/infrastructure/http/networkAddressPolicy.ts |
| AGENT-OOM-LIVE-01 | P2 | Qualifica necessaria | electron/core/application/agentOrchestratorApplicationClosure.ts |
| AGENT-THINKING-RUNAWAY-01 | P2 | Qualifica necessaria | electron/core/application/agentOrchestratorSessionWatchdog.ts; electron/core/domain/agent/ollamaSessionRuntime.ts |
| I18N-SIDECAR-MIGRATION-LIVE-01 | P3 | Qualifica e perimetro necessari | sidecar/services/store_rebuild_service.py; src/i18n/locales/it.ts |

## Conservazione e fonti primarie

Evidenze ufficiali: C:/Users/Utente/OnlyRag-Live/repository-residue-audit-20261020-64762349. Il manifesto SHA256 evidence-manifest.json vincola 34 file, inclusi log, baseline tracker/hash e prove DOCX originali/output; SHA256 b9bf69b04da987c9ea48ad927d59113b10dcb1df9f8df2e8c4e78bfd53e1bc0a. Il confronto finale di tutti i file iniziali e dei 66 file userdata e l'esito della pulizia dei temporanei propri sono nella ricevuta. Nessuna pulizia dei residui storici.

Fonti primarie: [Document/save, python-docx 1.2.0](https://python-docx.readthedocs.io/en/latest/api/document.html), [header/footer e parti collegate, 1.2.0](https://python-docx.readthedocs.io/en/latest/user/hdrftr.html), [primitive filesystem Python 3.13](https://docs.python.org/3.13/library/os.html#os.open). La pagina corrente della serie Python 3.13 mostra patch 3.13.16: runtime e prove qui sono 3.13.15, senza qualifica della patch successiva. [Advisory DOMPurify con prerequisiti non predefiniti](https://github.com/cure53/DOMPurify/security/advisories/GHSA-c6gr-qvv4-5v3f): versione incorporata confermata, configurazione sfruttabile dell'app non dimostrata. Il registro npm e interrogato direttamente, con risposta conservata.

## Pulizia della fixture rifiutata

La revisione automatica ha rifiutato prima dell'esecuzione la rimozione nativa PowerShell della sola nuova directory C:/Users/Utente/AppData/Local/Temp/onlyrag-residue-audit-64762349881147b8b7e3ba7f46273241. Motivo: blocked by policy, senza ulteriori dettagli. L'intero comando non e stato eseguito; la fixture con copia sorgenti/dipendenze/probe rimane disponibile. Nessuna cancellazione alternativa tentata. Evidenze ufficiali gia conservate con readback SHA256; script aggiuntivi copiati in un passo separato non distruttivo. Residuo aggiunto a RETAINED-RESIDUE-DISPOSAL-01 senza nuovo ID. Il readback e in cleanup-readback.json nel root durevole; pulizia rimasta incompleta.
