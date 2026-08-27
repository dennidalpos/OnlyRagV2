# OnlyRag V2 — Piano implementativo temporaneo

**Stato:** approvato per l'implementazione
**Ambito:** stabilità, sicurezza, Coding Agent e verificabilità
**Durata:** questo documento viene cancellato al completamento verificato di tutti gli step del tracker.

## Principi vincolanti

1. Nessuna compatibilità legacy: una migrazione sostituisce il percorso precedente e rimuove immediatamente codice, contratti e test superati.
2. Ogni confine pubblico o interno coinvolto dalla roadmap usa un unico contratto Zod; non sono ammessi schemi paralleli.
3. Ogni capacità mutante o con accesso esterno passa da un solo gateway di policy.
4. Si preferiscono librerie mature quando riducono codice custom e rischio operativo.
5. Ogni wave ha fixture isolate, prove deterministiche, rollback e un gate prima della wave successiva.
6. Non si implementano funzionalità già presenti, né adapter temporanei, fallback legacy o doppie fonti di verità.

## Protocollo di esecuzione per Luna — ragionamento medio

Le prossime sessioni usano `gpt-5.6-luna` con ragionamento `medium`. Il tracker è organizzato in task atomici: una sessione completa un solo ID, oppure si ferma senza modifiche se discovery o baseline dimostrano che lo scope non è valido.

Per ogni task la sessione deve ricevere soltanto: ID del tracker, obiettivo osservabile, file/moduli in scope, vincoli di sicurezza, test di accettazione e criterio di completamento. Non caricare l'intera roadmap, cronologie estese o strumenti non necessari. Il prompt deve dichiarare una sola volta autorizzazioni e confini; tool, contesto e output diagnostico vanno ridotti al minimo utile.

Ogni task segue questa sequenza fissa:

1. leggere i file in scope, i chiamanti e i test; registrare baseline Git;
2. modificare esclusivamente lo scope del task;
3. aggiungere o aggiornare il test di accettazione richiesto;
4. eseguire test mirato, typecheck/lint se applicabili e verificare il diff;
5. aggiornare il tracker solo se tutti i controlli richiesti passano.

Non combinare estrazioni di tool, cambi di contratto, nuove dipendenze o cambi di policy nella stessa sessione. Se un task richiede un prerequisito non pianificato, fermarsi, non creare compatibilità provvisoria e aggiungere un task atomico prima del task bloccato.

## Wave 1 — Sessione e baseline persistente

Implementare un `SessionManifest` e un `BaselineSnapshot` persistenti, separati da log e stato del planner. Il manifest registra ID sessione, root, commit e stato Git iniziali, hash di manifest/config, timestamp e classificazione del workspace. Il baseline distingue le modifiche preesistenti da quelle della sessione e supporta checkpoint idempotenti.

Implementare log per-run redatti, con retention limitata e nessun dato sensibile nel payload persistito. Rimuovere ogni utilizzo di log o stato planner come sostituto del baseline.

**Gate:** una sessione su working tree dirty viene interrotta e recuperata da checkpoint senza modificare il lavoro preesistente.

## Wave 2 — Gateway di policy e I/O sicuro

Implementare `CapabilityPolicyGateway` come unico punto di controllo per filesystem, shell, HTTP/download, Git e browser. Definire le modalità `offline-strict`, `local-only` e `network-approved`, con consenso esplicito, audit strutturato e limiti centralizzati.

Completare cancellazione tramite `AbortSignal` per HTTP, processi e preview; aggiungere MIME sniffing, limiti byte, policy redirect e provenance/hash per download e installazione skill. Rimuovere le policy duplicate dagli handler e la modalità `auto` per l'installazione skill: restano solo `disabled` e `prompt`.

**Gate:** i test negativi dimostrano assenza di effetti persistenti per path fuori scope, egress offline, installazioni senza consenso, MIME non ammessi e operazioni cancellate.

## Wave 3 — Profilo reale del progetto

Implementare un solo `ProjectProfile`, validato con Zod, costruito da struttura, manifest, lockfile, toolchain, test e build. Classificare esplicitamente workspace `empty`, `existing`, `monorepo` e `multi-project`; risolvere per ciascun progetto i comandi di verifica e l'esito `verified`, `failed` o `unverifiable`.

Sostituire il resolver attuale con il profile builder e rimuovere l'hardcoding dai prompt. Aggiungere fixture per workspace vuoto, esistente, monorepo, multi-progetto e progetto senza manifest/test.

**Gate:** ogni comando deriva dal profilo osservato e nessun progetto esistente viene scaffoldato o riscritto.

## Wave 4 — Refactor completo del dispatcher tool

Ridurre `agentToolExecutorService.ts` a un dispatcher sottile. Estrarre i servizi `FsToolService`, `ProcessToolService`, `WebToolService`, `GitToolService`, `BrowserToolService` e `RecoveryToolService`.

Ogni tool usa il contratto unico `schema → precondizioni → policy → effetto → evidenza → rollback`. Dopo ogni estrazione rimuovere il relativo handler dal servizio originario, senza deleghe permanenti. Introdurre l'esito terminale `MODEL_UNSUITABLE` per capability mancanti, senza loop forzati.

**Gate:** il dispatcher ha contract test completi; cancellazione, rollback e no-loop sono verificati; nessun handler concreto rimane nell'executor.

## Wave 5 — Validazione visuale con Playwright

Adottare `playwright` come unica dipendenza per la validazione visuale headless. Non implementare Electron Offscreen WebContents né un secondo runner browser.

Implementare runner sandboxato per artifact locale, screenshot, DOM snapshot, console error/warn, HTTP 4xx/5xx, timeout, cleanup garantito, redazione e stato `UNAVAILABLE`. Integrare l'esito solo come evidenza aggiuntiva: non sostituisce build, test o typecheck.

**Gate:** fixture positive e negative coprono artifact valido/non valido, path fuori scope, timeout, console error, 404/500 e runtime indisponibile.

## Wave 6 — Suite deterministica e release hardening

Implementare fixture locali per sicurezza, rollback, tool sconosciuti, output malformato, progetto senza test, monorepo e sessione interrotta. Misurare per-run task success, false verified, unsafe action, recovery e tool validity. Rendere bloccante la soglia di zero falsi `verified` negli scenari controllati.

Eseguire clean install riproducibile, verifica lockfile, SBOM e audit supply chain. Promptfoo è valutabile soltanto dopo la suite locale; Langfuse, DeepEval e Ragas restano fuori scope senza un caso d'uso misurabile.

**Gate:** tutti i controlli di rilascio passano e non rimangono attività nel tracker.

## Ordine e chiusura

L'ordine obbligatorio è Wave 1 → Wave 2 → Wave 3 → Wave 4 → Wave 5 → Wave 6. Il tracker in `PROJECT_STATUS.json` è la checklist esecutiva canonica. Al suo completamento, dopo verifica completa e revisione del diff, cancellare questo file di piano e aggiornare la documentazione canonica risultante.
