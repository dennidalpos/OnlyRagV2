# Coding Agent

La [verifica locale di rete del 21 ottobre](./verification-tracker-completion-2026-10-21.md) conclude `AGENT-NETWORK-LIVE-01` con server HTTP posseduti. I download scrivono in staging esclusivo e sostituiscono la destinazione solo dopo validazione, flush e chiusura; errori e annullamento preservano il file precedente. URL, DNS, MIME e percorsi restano verificati secondo il livello di accesso esplicito.

Il modello propone piani e azioni; Main decide cosa eseguire, verifica file/comandi e registra esiti. Il percorso è `intervista/piano → contesto → azione → verifica → risultato`. I contratti e le regole sono in [`shared/ipc/ipcContract.ts`](../shared/ipc/ipcContract.ts), [`electron/core/domain/agent/`](../electron/core/domain/agent/) e [`electron/core/application/`](../electron/core/application/).

## Uso e confini

- Ask legge; Guided e Auto usano il piano JSON e l'identità immutabile di run, conversazione, revisione e workspace. Esegui parte subito; Pianifica richiede la scelta esplicita prevista dalla modalità.
- Una modifica di file esistente richiede la versione letta. Il journal protegge lo step e conserva checkpoint sotto `.onlyrag/checkpoints`; Stop lascia il lavoro e il ripristino è esplicito.
- Comandi, rete, installazioni e commit passano dai controlli della modalità e del profilo acquisito all'avvio. Una verifica è `verified` solo quando le prove richieste passano; il testo del modello non basta.
- La pianificazione lega richiesta originale, condizioni, target e revisione. Risposte incomplete o riferimenti inventati sono rifiutati. La cronologia di prove live e i marker di budget restano separati dal codice corrente.
- La persistenza di sessioni e stato agente rifiuta originali illeggibili e scritture non confermate. Le richieste accettate sopravvivono al riavvio e richiedono **Riprendi task** nella conversazione originale. Il [recupero offline qualificato](./verification-agent-crash-recovery-2026-10-20.md) conserva trascrizione e checkpoint; un'azione interrotta senza esito confermato non viene ripetuta. **Ispeziona prove** e **Abbandona esecuzione**, con consenso e digest verificato, archiviano richiesta e stato senza replay o rollback ([riconciliazione](./verification-inflight-reconciliation-2026-10-20.md)).

## Qualificazione

Le skill salvate usano il serializer YAML di js-yaml con verifica del roundtrip e readback del file. Virgolette, backslash, nuove righe, liste e corpo Markdown vengono conservati; il nome mantiene la normalizzazione locale già prevista. Il matcher normalizza e deduplica i termini solo per il punteggio. L'attivazione pubblica uno staging riletto dopo flush prima di aggiornare la memoria; un errore mantiene lo stato precedente, senza dichiarare attiva una skill che non lo sarà al riavvio. Stato persistito invalido o illeggibile viene rifiutato senza sovrascriverlo. Non è una qualifica di perdita di alimentazione.

I test di `SkillAppService` usano risposte web locali attraverso gli adapter concreti, cache svuotata e metriche modello controllate. Una guardia registra e rifiuta le richieste native HTTP(S) sfuggite alle fixture prima dell'invio, anche se un fallback applicativo ne nasconde l'errore; gli adapter di produzione mantengono il comportamento di scoperta.

I guard e gli scenari isolati dimostrano la meccanica dichiarata. Le campagne storiche `qwen3.5:9b` non hanno qualificato una sequenza TaskLab completa o la pianificazione generale; la [politica locale](./local-development-policy-2026-10-20.md) ha ritirato quei gate live senza convertirli in successi. La [qualifica delle verifiche native](./verification-native-projects-2026-10-19.md) e le [regressioni su root, discovery ed evidenza](./verification-project-regressions-2026-10-20.md) hanno ricevute separate. Il tracker (SecondBrain: `02-areas/products/OnlyRagV2/tracker.json`) contiene il lavoro attualmente aperto; la riconciliazione inflight è implementata e conclusa, non una qualifica residua.

Dettagli implementativi: [`agent-runtime.md`](./agent-runtime.md), [`agent-guards.md`](./agent-guards.md), [`agent-diagnostics.md`](./agent-diagnostics.md). Prove e fallimenti: [`verification-history-2026-10-13.md`](./verification-history-2026-10-13.md), [`request-ledger-human-review-2026-10-10.md`](./request-ledger-human-review-2026-10-10.md).
