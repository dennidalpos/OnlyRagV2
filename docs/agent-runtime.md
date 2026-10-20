# Runtime e orchestrazione Agent

La guida breve è [Coding Agent](./coding-agent.md). Il codice di orchestrazione vive in [Application](../electron/core/application/) e le regole di piano/guard in [Domain](../electron/core/domain/agent/). Questo indice conserva gli ancoraggi delle proposte e campagne datate; per lo stato aperto prevale il [tracker](../PROJECT_STATUS.json).

## Funzionamento corrente

Il [recupero offline dopo arresto forzato](./verification-agent-crash-recovery-2026-10-20.md) conserva le richieste accettate e richiede **Riprendi task** nella conversazione originale; non parte lavoro all'avvio. Le ricevute terminali impediscono il replay, i checkpoint mantengono i byte precedenti alla prima modifica e la ripresa conserva trascrizione e mutazioni. Un'azione interrotta senza esito confermato viene rifiutata; **Ispeziona prove**, consenso e **Abbandona esecuzione** conservano richiesta e stato senza ripetere o annullare l'azione. [Qualifica della riconciliazione](./verification-inflight-reconciliation-2026-10-20.md). Modelli reali, app installata e perdita di alimentazione mantengono i gate separati.

- Ask legge; Guided e Auto eseguono secondo la modalità e il profilo acquisiti. Piano e richiesta mantengono identità e revisione; nessun testo del modello diventa prova da solo.
- File esistenti richiedono la versione letta, il journal conserva checkpoint e Stop non ripristina automaticamente. Eventi, approvazioni e annullamenti sono legati alla run.
- La verifica usa i manager Node dichiarati e i contratti osservati per Python/pytest, Go, Rust, Maven, Gradle e Composer. La scoperta riconosce anche progetti Python configurati soltanto tramite `setup.cfg` (`[tool:pytest]`) o `tox.ini` (`[pytest]`), senza inventare suite da sezioni estranee. Ogni comando parte dalla root del proprio progetto e ripristina la directory interattiva precedente. Tool assente, progetto senza controllo o requisito comportamentale senza test osservati restano `unverifiable`. Exit 0 senza test riconoscibili vale solo come evidenza strutturale; Go emette eventi JSON e il successo del solo package non conta come test. [Qualifica iniziale](./verification-native-projects-2026-10-19.md) e [regressioni del verificatore](./verification-project-regressions-2026-10-20.md) distinguono i confini provati da installazione e campagne reali ancora aperte.
- Le campagne live conservate non qualificano TaskLab né autorizzano nuovi tentativi. Le proposte storiche sotto sono evidenza, non configurazione attiva.
- L'estrazione dell'inventario della richiesta invia al modello i numeri originali delle sole righe non vuote. Se `sourceLines` contiene riferimenti invalidi, riprova una volta con l'errore preciso; la validazione resta obbligatoria e la cancellazione impedisce la riprova. Il log operativo registra `REQUEST_LEDGER_SOURCE_LINES_INVALID` e il numero del tentativo senza prompt. Le [risposte strutturate di Ollama](https://docs.ollama.com/capabilities/structured-outputs) e la [validazione Zod](https://zod.dev/basics) vincolano la forma, mentre `validateRequestLedger` verifica i riferimenti alla richiesta originale. I test offline non qualificano l'esito di un nuovo tentativo con modello reale.
- `Log Debug Coding Agent` è l'unico interruttore per il log audit e il bundle diagnostico completi. Quando è attivo, l'audit registra prompt, risposte, tentativi di estrazione e piano, verifiche di copertura, tool e risultati; le credenziali vengono oscurate. Restano applicabili dimensione, rotazione e numero di file impostato per la conservazione. L'audit può contenere testo e percorsi privati: condividerlo solo dopo revisione. Il log operativo generale conserva la redazione più severa.
- Qualifica offline del 2026-10-14: in radici temporanee isolate, la rilettura conserva in ordine gli eventi delle generazioni ancora presenti dopo rotazione e riavvio, inclusi delta dei prompt, risposte, risultati e errori di pianificazione. Ogni generazione che contiene prompt inizia con una baseline completa: la rotazione azzera l'ancora dei delta. Un separatore nel payload non interrompe la voce e il testo che cita un'altra sessione non viene attribuito a quella sessione. `clearAuditLog` svuota tutte le generazioni configurate e richiede un nuovo avvio di sessione per riattivare i payload; la rimozione di una sessione attraversa tutte le generazioni senza cancellare le altre. Un errore di rotazione viene segnalato senza troncare il file corrente. Le generazioni scartate dalla retention non sono ricostruibili; la prova non qualifica ancora l'audit della build installata con modello reale.
- Il 20 ottobre la [campagna limitata a otto chiamate](./verification-ledger-bounded-2026-10-20.md) verifica nell'EXE installato la rilettura audit completa di quattro estrazioni e quattro candidati dopo riavvio, con debug abilitato. La raccolta passa; estrazione 1/4, piani non accettati e revisioni oltre budget mantengono aperta la qualifica P1. Nessuna bozza confermata automaticamente, nessun piano approvato o eseguito; marker e fallimenti precedenti conservati.

## Indice storico

## Modalità operative

[Evidenza datata](./agent-runtime-history-2026-10-13.md#modalità-operative).

## Pianificazione e intervista

[Evidenza datata](./agent-runtime-history-2026-10-13.md#pianificazione-e-intervista).

## Ciclo di esecuzione

[Evidenza datata](./agent-runtime-history-2026-10-13.md#ciclo-di-esecuzione).

## Confinamento e workspace

[Evidenza datata](./agent-runtime-history-2026-10-13.md#confinamento-e-workspace).

## Contesto, token e thinking

[Evidenza datata](./agent-runtime-history-2026-10-13.md#contesto-token-e-thinking).

## Sessione, identità e audit

[Evidenza datata](./agent-runtime-history-2026-10-13.md#sessione-identità-e-audit).

## Request-first coverage ledger — approved implementation, 2026-10-10

[Evidenza datata](./agent-runtime-history-2026-10-13.md#request-first-coverage-ledger--approved-implementation-2026-10-10).

### Extraction qualification proposal — approved 2026-10-10

[Evidenza datata](./agent-runtime-history-2026-10-13.md#extraction-qualification-proposal--approved-2026-10-10).

### Extraction field-role correction proposal — approved 2026-10-10

[Evidenza datata](./agent-runtime-history-2026-10-13.md#extraction-field-role-correction-proposal--approved-2026-10-10).

### Extraction target-invariant schema proposal — approved 2026-10-10

[Evidenza datata](./agent-runtime-history-2026-10-13.md#extraction-target-invariant-schema-proposal--approved-2026-10-10).

### Exact review-reference schema proposal — approved 2026-10-10

[Evidenza datata](./agent-runtime-history-2026-10-13.md#exact-review-reference-schema-proposal--approved-2026-10-10).

### Human-confirmed candidate qualification proposal — approved 2026-10-10

[Evidenza datata](./agent-runtime-history-2026-10-13.md#human-confirmed-candidate-qualification-proposal--approved-2026-10-10).

### Human-confirmed candidate qualification result — 2026-10-10

[Evidenza datata](./agent-runtime-history-2026-10-13.md#human-confirmed-candidate-qualification-result--2026-10-10).

### Private candidate claim binding proposal — approved 2026-10-10

[Evidenza datata](./agent-runtime-history-2026-10-13.md#private-candidate-claim-binding-proposal--approved-2026-10-10).

### Private candidate claim binding result — 2026-10-10

[Evidenza datata](./agent-runtime-history-2026-10-13.md#private-candidate-claim-binding-result--2026-10-10).

### Candidate evidence and inventory clarification proposal — approved 2026-10-10

[Evidenza datata](./agent-runtime-history-2026-10-13.md#candidate-evidence-and-inventory-clarification-proposal--approved-2026-10-10).

### Candidate evidence and inventory clarification result — 2026-10-10

[Evidenza datata](./agent-runtime-history-2026-10-13.md#candidate-evidence-and-inventory-clarification-result--2026-10-10).

### Reviewer proxy evidence clarification proposal — approved 2026-10-10

[Evidenza datata](./agent-runtime-history-2026-10-13.md#reviewer-proxy-evidence-clarification-proposal--approved-2026-10-10).

### Reviewer proxy evidence clarification result — 2026-10-10

[Evidenza datata](./agent-runtime-history-2026-10-13.md#reviewer-proxy-evidence-clarification-result--2026-10-10).

## Native Node verification commands - 2026-10-13

[Evidenza datata](./agent-runtime-history-2026-10-13.md#native-node-verification-commands---2026-10-13).
