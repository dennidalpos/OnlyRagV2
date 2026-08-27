# OnlyRag V2 — Piano evolutivo

**Stato:** proposta di roadmap, da valutare prima di ogni wave  
**Ultima verifica del repository:** 27 agosto 2026  
**Ambito:** stabilità, sicurezza, Coding Agent, verificabilità e manutenzione

## 1. Scopo e regole decisionali

Questo documento è il piano evolutivo unico per le attività trasversali di OnlyRag V2. Non sostituisce:

- [`architecture.md`](../architecture.md) per topologia e confini;
- [`modules.md`](../modules.md) per responsabilità e percorsi;
- [`api.md`](../api.md) per i contratti IPC/REST;
- [`setup-and-env.md`](../setup-and-env.md) per ambiente e procedure;
- [`coding-agent-studio-blueprint.md`](../coding-agent-studio-blueprint.md) per il comportamento dettagliato dell’agente;
- [`PROJECT_STATUS.json`](../../PROJECT_STATUS.json) per il debito tecnico pendente.

Ogni intervento futuro deve rispettare queste regole:

1. prima discovery e baseline, poi modifica;
2. una milestone deve avere una prova di accettazione concreta;
3. la presenza di un file non equivale a implementazione verificata;
4. le prove deterministiche prevalgono sul giudizio di un LLM;
5. le feature con rete, installazione o sovrascrittura devono avere consenso, limiti, audit e rollback;
6. il codice esistente va preservato: niente riscritture generali o nuove architetture senza evidenza;
7. ogni cambiamento ad API, dipendenze, manifest o dati richiede valutazione separata.

## 2. Stato verificato

Il repository è un progetto Electron/React con sidecar Python, Ollama e LanceDB. Il working tree è pulito e il typecheck e la validazione documentale risultano superati.

Sono già presenti:

- riconoscimento dello stack e lettura dei manifest;
- repo map compatta con estrazione dei simboli;
- planner con microtask, stati dei milestone e riconciliazione del residuo;
- parser tollerante delle tool call con validazione e riparazione JSON;
- journal del workspace con rollback completo e rollback dell’ultimo step;
- policy sui comandi di verifica, path safety, circuit breaker e DoD gate;
- supporto a Ollama locale/remoto e fallback tra tool calling nativo e prompt engineering;
- tool web con mitigazione SSRF, limiti e contenuto remoto marcato come non attendibile;
- contratti Zod già utilizzati per diversi confini IPC/domain.

Gap verificati o ancora pendenti:

- `agentToolExecutorService.ts` concentra ancora numerosi handler; il refactoring P1 è pendente;
- non esiste un `ProjectProfile` esplicito come contratto unificato;
- non esistono i contratti espliciti `baseline_snapshot`, `offline-strict` e `MODEL_UNSUITABLE`;
- non esiste il tool di validazione visuale headless per screenshot, DOM e console/HTTP errors;
- Promptfoo, Langfuse, DeepEval e Ragas non sono dipendenze del progetto;
- [`PROJECT_STATUS.json`](../../PROJECT_STATUS.json) contiene attività pendenti, non un backlog funzionale autorizzato.

## 3. Roadmap proposta

Le wave sono ordinate per rischio e dipendenze. Una wave non va avviata se il gate della precedente non è verificabile.

### Wave 0 — Baseline e contratti

**Da implementare**

- manifest di sessione con session ID, commit, stato Git e hash dei manifest/config;
- snapshot persistente del baseline, separato dai log e dallo stato del piano;
- classificazione esplicita del workspace: vuoto, esistente, monorepo o multi-progetto;
- inventario dei contratti tool/IPC e identificazione delle fonti duplicate;
- log per-run isolati e minimizzati.

**Non implementare in questa wave**

- nuove feature agentiche;
- tracing remoto;
- riscrittura dell’orchestratore;
- installazioni o modifiche automatiche dell’ambiente.

**Gate:** una sessione dirty può distinguere modifiche preesistenti da quelle proprie e può essere recuperata da un checkpoint.

### Wave 1 — Sicurezza e affidabilità

**Da implementare o completare**

- path containment uniforme per ogni tool che legge o scrive;
- timeout e cancellazione effettivi per shell, rete, sidecar e preview;
- policy esplicita per egress/offline, con audit delle chiamate remote;
- limiti di dimensione e MIME per download/upload;
- provenance, hash e consenso per installazione di skill;
- test negativi per autorizzazioni, rollback, tool sconosciuti, path fuori scope e output malformato.

**Da mantenere con guardrail**

- ricerca web, download e Ollama remoto;
- `ensure_tool`, solo con separazione detect/propose/approve/install;
- aggiornamento modelli e vocabolari fuori dal loop della sessione;
- traduzione PDF in-place solo con backup obbligatorio e sostituzione atomica;
- preview automatica solo in sandbox.

**Default obbligatorio:** `autoInstallHubSkills = "disabled"`.

**Gate:** nessuna azione unsafe nei test negativi; un errore di rete o tracing non blocca il loop; ogni mutazione è recuperabile.

### Wave 2 — Discovery e planning riconciliato

**Da implementare**

- `ProjectProfile` costruito dai manifest, configurazioni, test, build e struttura reale;
- resolver dei comandi di verifica per stack, senza hardcoding nei prompt principali;
- distinzione tra file presenti, milestone in corso e milestone verificate;
- supporto esplicito a workspace senza test con stato `unverifiable`;
- fixture per workspace vuoto, esistente, monorepo e progetto senza manifest.

**Da non fare**

- promuovere un deliverable a `verified` solo perché esiste;
- applicare un comando della root a tutti i sottoprogetti;
- usare `PROJECT_STATUS.json` come autorizzazione ad ampliare lo scope.

**Gate:** un progetto preesistente non viene riscritto da zero e ogni comando di verifica deriva dal profilo del progetto.

### Wave 3 — Refactoring del Coding Agent

**Da implementare gradualmente**

- estrazione degli handler di `agentToolExecutorService.ts` per domini: filesystem, execution, web, git, browser e recovery;
- contratto unico per schema, policy, precondizioni, effetto, evidenza e rollback;
- capability probe osservato per tool calling, structured output, contesto, vision e coding;
- microtask brevi, una mutazione per turno e riduzione del contesto sugli errori;
- esito esplicito per modello non adatto, senza loop forzato;
- contract test del dispatcher prima e dopo ogni estrazione.

**Da non implementare**

- una riscrittura completa dell’orchestratore;
- un planner LLM esterno che sostituisca il planner canonico;
- una nuova astrazione se non elimina una duplicazione o abilita un test concreto.

**Gate:** comportamento invariato dei tool esistenti, test di cancellazione/no-loop/rollback superati, build invariata.

### Wave 4 — Verifica hardware e setup

**Da implementare solo se supportato da evidenza**

- test parametrizzati per profili VRAM e costi di pesi, KV-cache e overhead;
- distinzione tra capability dichiarata e capability osservata;
- verifica health e contesto allocato dopo l’avvio Ollama;
- setup riproducibile e script derivato dal profilo reale.

**Da non fare**

- raccomandare un modello solo in base al nome;
- confondere `num_ctx` richiesto con memoria effettivamente disponibile;
- aggiornare il modello durante una sessione agentica attiva.

**Gate:** nessun modello raccomandato supera il profilo hardware verificato.

### Wave 5 — Audit dei prompt e validazione visuale

**Da implementare dopo le wave precedenti**

- suite deterministica di invarianti e scenari su fixture isolate;
- runner esterno opzionale per confrontare modelli e prompt;
- validazione visuale sandboxata con screenshot, DOM, console errors e 404/500;
- metriche per-run: task success, false verified, unsafe action, recovery e tool validity;
- giudice semantico solo `advisory`.

**Da non fare**

- dichiarare successo sulla base di Answer Relevancy o Faithfulness soltanto;
- usare screenshot come sostituto di build, test o typecheck;
- rendere obbligatori Promptfoo, Langfuse, DeepEval o Ragas prima di avere fixture locali affidabili.

**Gate:** falsi `verified` pari a zero negli scenari controllati e metriche isolate tra sessioni.

### Wave 6 — Release hardening

**Da valutare**

- pin delle dipendenze e dei modelli;
- clean install riproducibile;
- SBOM e verifica della supply chain;
- packaging e firma quando richiesti dal canale di distribuzione;
- checklist di rilascio e report dei rischi residui.

Questa wave non deve precedere la stabilizzazione dei contratti e dei test fondamentali.

## 4. Criteri per decidere cosa implementare

Ogni proposta futura deve compilare questa scheda:

```text
Obiettivo utente:
Problema osservabile:
Evidenza nel codice/test/log:
Scope autorizzato:
File o moduli coinvolti:
Rischio introdotto:
Prova di accettazione:
Rollback:
Decisione: implementare | mantenere e irrobustire | rinviare | non implementare
```

Una feature va mantenuta e irrobustita quando ha valore reale e il rischio è mitigabile. Va rinviata quando mancano una prova o una dipendenza necessaria. Va esclusa quando è inutilizzata, duplicata, non testabile o irreversibilmente distruttiva senza rollback.

## 5. Strategia di valutazione degli step

Prima di ogni wave:

1. aggiornare la discovery e verificare il working tree;
2. correlare la proposta con `PROJECT_STATUS.json`;
3. definire una fixture o un test riproducibile;
4. registrare precondizioni, file fuori scope e piano di rollback.

Dopo ogni modifica:

1. eseguire i test mirati;
2. eseguire typecheck, lint, build e smoke test quando applicabili;
3. verificare diff, file generati e assenza di segreti;
4. aggiornare la documentazione canonica e il tracker del debito;
5. classificare il risultato come `verified`, `failed` o `unverifiable`.

Il successo dell’agente non è “risposta plausibile”: è una combinazione di modifica nello scope, prova eseguita, workspace recuperabile e assenza di violazioni di sicurezza.

## 6. Decisioni rinviate

Restano da decidere con evidenza o approvazione esplicita:

- scelta tra Electron Offscreen WebContents e `playwright-core` per la preview headless;
- forma finale del `ProjectProfile` e sua posizione nei layer;
- eventuale migrazione completa dei contratti custom a Zod, evitando due fonti di verità;
- formato del log locale per-run e politica di redazione;
- uso di runner e giudici LLM in CI o soltanto come strumenti locali;
- eventuale supporto a commit automatici: di default resta vietato senza approvazione umana.

