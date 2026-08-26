# Piano operativo agent-ready per la stabilizzazione di OnlyRag V2

**Destinatario:** agente AI incaricato di analizzare, correggere e verificare il progetto  
**Versione:** 1.0  
**Data:** 26 agosto 2026  
**Input considerati:** audit critico precedente, `PROJECT_STATUS.json`, `specifica_audit_prompt_onlyrag.txt`, `README.md`, `architecture.md`, `api.md`, `modules.md`, `libraries-and-domain-implementations.md`, `agent-live-testing.md` e `setup-and-env.md`.

## 1. Mandato operativo

L'obiettivo non è aggiungere subito nuove funzionalità, ma trasformare OnlyRag V2 da una specifica ricca di garanzie dichiarate in un sistema **verificabile, recuperabile e adatto a modelli locali eterogenei**. L'agente deve prima ricostruire lo stato reale del repository, poi correggere contratti, sicurezza, workflow del Coding Agent, hardware routing e test. Ogni modifica deve essere piccola, tracciata, verificata e reversibile.

> **Regola principale:** non riscrivere un progetto esistente per adattarlo al piano. Prima analizzarlo, preservarne l'intento e formulare un piano di integrazione incrementale.

Il progetto deve supportare due modalità diverse:

| Modalità | Comportamento obbligatorio |
|---|---|
| **Workspace vuoto** | L'agente può proporre uno scaffold, ma deve prima scegliere stack, runtime, package manager e criteri di verifica. |
| **Workspace esistente** | L'agente deve produrre una mappa, identificare stack e convenzioni, leggere manifest/config principali, rilevare test e build, classificare il debito e pianificare modifiche senza distruggere codice funzionante. |

## 2. Valutazione critica della proposta `specifica_audit_prompt_onlyrag`

### 2.1 Verdetto

La proposta è **utile e parzialmente fattibile**, ma non deve essere implementata nella forma attuale come infrastruttura centrale del prodotto. È adatta come **strato esterno di valutazione e regressione**, non come dipendenza del Domain Layer né come prova automatica sufficiente della correttezza dell'agente.

| Aspetto | Valutazione | Decisione |
|---|---|---|
| Ispezione workspace e riconciliazione del piano | Fattibile e molto utile | Implementare subito, prima dell'audit prompt. |
| Promptfoo per scenari ripetibili | Fattibile come runner esterno | Adottare con adapter locale e fixture, senza vincolare il dominio. |
| Langfuse | Utile per tracing, ma in conflitto con privacy/zero-cloud se configurato remoto | Opt-in, local-only o sostituibile con telemetria JSONL nativa. |
| DeepEval/Ragas | Utili per esperimenti RAG, deboli come giudice unico dell'agente coding | Non usarli come gate di release senza assert deterministici. |
| “Suite fissa e immutabile” universale | Non fattibile in senso assoluto | Usare core invariabile + probe dinamici derivati dal progetto reale. |
| “Comportamento deterministico” di SLM | Non realistico | Rendere deterministiche policy, tool, gate e metriche; non la risposta del modello. |
| Neutralizzazione dei deficit cognitivi tramite parser | Parzialmente utile | Il parser recupera forma, non comprensione, pianificazione o conoscenza aggiornata. |
| Tracing di ogni transazione | Fattibile | Registrare dati minimizzati, hash e metadati; mai segreti o documenti completi per default. |

### 2.2 Rischi specifici della proposta

La proposta assume che `Answer Relevancy`, `Faithfulness` e `Tool Call Accuracy` siano metriche sufficienti. Non lo sono per un agente coding: un'applicazione può generare una risposta pertinente e chiamare tool sintatticamente corretti, ma introdurre una regressione, alterare API pubbliche, ignorare convenzioni del repository o lasciare vulnerabilità. Il gate deve quindi essere basato su **prove osservabili**: test del progetto, typecheck, lint, diff, invarianti di sicurezza, file toccati e scenario di esecuzione.

L'uso di un LLM come giudice è inoltre fragile quando il modello locale è debole o non aggiornato. Un giudice locale può non riconoscere una API moderna, premiare una soluzione plausibile ma sbagliata o confermare un output scritto in modo convincente. Per questo i giudizi semantici devono essere secondari e mai sostitutivi dei test deterministici.

Infine, l'idea di “agnosticismo dello stack” non significa assenza di comandi specifici. Significa che il core conosce solo astrazioni, mentre un resolver legge il manifest e seleziona i comandi reali (`npm`, `pnpm`, `pytest`, `cargo`, `go test`, ecc.) con policy e conferma. Un progetto senza test o manifest deve produrre `UNVERIFIABLE`, non `PASS`.

## 3. Protocollo obbligatorio dell'agente

### Fase A — Protezione e acquisizione del baseline

Prima di modificare qualsiasi file, l'agente deve:

1. identificare root reale, repository Git, branch, stato dirty, submodule e symlink;
2. creare un manifest di sessione con timestamp, hash dei file di configurazione, commit corrente e percorso workspace;
3. distinguere workspace vuoto, progetto esistente, monorepo, progetto multi-package, directory non versionata e directory contenente più progetti;
4. non eseguire comandi distruttivi, installazioni o scaffolding prima dell'approvazione del piano;
5. registrare un `baseline_snapshot` persistente su disco, non soltanto in memoria.

Se il workspace contiene più progetti, l'agente deve chiedere o determinare esplicitamente il progetto target, delimitare il sottopercorso autorizzato e impedire modifiche fuori da quel perimetro.

### Fase B — Discovery del progetto esistente

Il primo piano non deve essere “costruire l'app”. Deve essere “capire cosa esiste”. L'agente deve usare strumenti astratti per:

| Ordine | Attività | Risultato richiesto |
|---:|---|---|
| 1 | Scansione top-level e profondità limitata | Inventario senza `node_modules`, `.git`, build e cache. |
| 2 | Lettura manifest | `package.json`, lockfile, `pyproject.toml`, `requirements`, `Cargo.toml`, `go.mod`, workflow CI e config. |
| 3 | Rilevazione framework | Stack, entrypoint, package manager, runtime, test runner, build e lint. |
| 4 | Mappa semantica | Moduli, simboli esportati, entrypoint, API e dipendenze interne. |
| 5 | Baseline verificabile | Esecuzione del comando non mutante più economico disponibile. |
| 6 | Analisi del rischio | File sensibili, segreti, configurazioni custom, generated code e aree non toccabili. |

L'agente deve classificare ogni area come `healthy`, `unknown`, `failing`, `generated`, `legacy` o `out-of-scope`. Non deve promuovere file esistenti a milestone completate soltanto perché sono presenti: la presenza produce `present/in_progress`; la verifica richiede una prova compatibile.

### Fase C — Piano riconciliato

Il planner deve unire tre fonti: obiettivo utente, stato del workspace e tracker pendente. Le milestone già soddisfatte devono essere riusate; quelle parziali devono essere riformulate; quelle incompatibili con lo stack devono essere sostituite con equivalenti verificabili.

Ogni milestone deve contenere:

```text
id
scope autorizzato
file o moduli candidati
precondizioni
azione atomica
prova di accettazione
comando di verifica risolto dal progetto
rischio e piano di rollback
stato: pending | in_progress | verified | failed | unverifiable
```

Una milestone con criterio generico come “migliorare il coding agent” è invalida finché non viene convertita in risultati misurabili, per esempio “il comando `run_tests` rifiuta un test volutamente fallace e registra exit code non zero”.

## 4. Rifacimento operativo del modulo Coding Agent

### 4.1 Diagnosi della causa probabile del malfunzionamento

Dalla documentazione il modulo Coding è sovraccarico: l'orchestrator coordina piano, tool loop, parsing, auto-healing, verifica, persistenza, approvazioni, modelli e rollback; `agentToolExecutorService.ts` raccoglie numerosi strumenti; la correttezza è spesso affidata a prompt, euristiche e stato mutabile condiviso. Questo aumenta la probabilità di errori di ciclo di vita, contratti divergenti, contesto eccessivo e comportamenti diversi tra modelli.

Le cause più probabili sono quindi:

1. **eccessiva responsabilità per modulo**, con confini difficili da testare;
2. **dipendenza da modelli che emettono tool call non strutturate**, soprattutto su SLM deboli;
3. **piano troppo verboso o astratto** rispetto al budget di contesto;
4. **verifica semantica confusa con exit code e presenza file**;
5. **mancanza di validazione visiva reale** per UI e applicazioni web;
6. **workflow non differenziato tra workspace vuoto ed esistente**;
7. **contratti IPC e tool non generati da una fonte unica**;
8. **auto-healing che può ripetere il problema invece di ridurre il problema**.

### 4.2 Target architecture

Ristrutturare il Coding Agent in pipeline con contratti stretti:

```text
WorkspaceDiscovery
  -> ProjectProfile
  -> PlanReconciler
  -> TaskCompiler
  -> ModelCapabilityRouter
  -> ToolPolicyGateway
  -> ToolExecutor
  -> EvidenceCollector
  -> VerificationGate
  -> SessionCommitOrRollback
```

`agentOrchestratorAppService.ts` deve restare coordinatore sottile. L'esecuzione dei tool deve essere divisa almeno in domini separati: filesystem, shell/test, git, web/download, skill, diagnostica e browser/artifact preview. Ogni tool deve avere schema, policy, precondizioni, effetto, evidenza e strategia di rollback.

### 4.3 Strategia per modelli deboli o non aggiornati

Il sistema non deve chiedere al modello locale di conoscere automaticamente gli ultimi stack tecnologici. Deve estrarre informazioni dal repository e, solo quando autorizzato, usare ricerca web mirata per documentazione aggiornata. Il modello deve ricevere contesto compatto e strutturato, non l'intero repository.

| Capacità rilevata | Strategia |
|---|---|
| Tool calling nativo affidabile | Usare schema strutturato, validazione stretta e massimo un'azione per turno. |
| Tool calling assente ma JSON recuperabile | Usare parser difensivo con schema e rifiuto delle chiamate ambigue. |
| Ragionamento debole | Ridurre microtask, vietare piani profondi, richiedere una prova dopo ogni mutazione. |
| Conoscenza stack obsoleta | Iniettare `ProjectProfile`, manifest e documentazione runtime; usare web search solo per il gap dichiarato. |
| Risposte incoerenti | Passare a modalità deterministica assistita: tool selezionabili, template brevi, retry limitati. |
| Modello non compatibile | Non forzare il loop; restituire `MODEL_UNSUITABLE` con motivazione e modello alternativo. |

Il router deve misurare capacità osservate, non fidarsi soltanto del nome modello o dell'allow-list. Le capability possono essere `native_tool_calling`, `structured_output`, `long_context`, `vision`, `reasoning`, `coding`, `freshness_unknown`. Il sistema deve distinguere “capability dichiarata da Ollama” da “capability verificata da probe”.

### 4.4 Regole di esecuzione

L'agente deve operare con un microtask alla volta. Dopo ogni mutazione deve raccogliere diff, file toccati, esito del tool e prova minima. Dopo un errore deve ridurre il contesto al comando, errore e file rilevanti; non reinviare tutta la cronologia. Dopo due tentativi equivalenti deve fermarsi e riformulare il piano; dopo tre fallimenti deve terminare il microtask come `failed` o `unverifiable`, senza simulare progresso.

`ask` non deve essere invocato in modalità autonoma quando nessuno può rispondere. In assenza di risposta, il sistema deve usare una policy esplicita: default sicuro, sospensione o fallimento, mai un ciclo di attesa indefinito.

## 5. Integrazione del tracker `PROJECT_STATUS.json`

Il tracker deve essere convertito in milestone con evidenza, non trattato come lista di desideri.

| Voce tracker | Priorità | Prima prova richiesta |
|---|---|---|
| Ricerca web azionabile | Alta | Probe che mostra query solo su gap del `ProjectProfile`, URL e motivo registrati. |
| Badge capability live | Alta | Confronto tra `/api/tags`, probe osservato e UI; modello sconosciuto non promosso. |
| Verifica contesto allocato | Alta | Confronto `/api/ps` con `num_ctx` richiesto, segnalato come verifica e non dimensionamento. |
| Workspace pre-seminato | Critica | Scenario su progetto esistente che dimostra assenza di riscrittura da zero. |
| Log per-run | Alta | File isolato per sessione con ID, timestamp e metriche non contaminate da run precedenti. |
| Verifiche live mancanti | Critica | Uno scenario negativo per ciascun guard, con fixture volutamente fallace. |
| Scope skill | Critica | Test di installazione workspace/userData, provenance, hash e rifiuto senza consenso. |
| Refactoring tool | Alta | Build invariata, contract test per ogni tool e nessun comportamento perso. |
| Validazione visiva | Alta | Screenshot, DOM e console error su artifact web, con fallback `UNAVAILABLE`. |
| First-Class Artifacts Engine | Media, dopo sicurezza | Preview confinata alla sandbox, path containment e nessuna esecuzione automatica non approvata. |

## 6. Suite di audit dei prompt: implementazione corretta

La suite deve avere tre livelli.

### Livello 1 — Invarianti deterministiche

Controlla schema tool, path safety, autorizzazioni, FSM, budget, timeout, rollback, contratti IPC, stato milestone, verifica dei comandi e assenza di egress in `offline-strict`. Questo livello è un gate obbligatorio.

### Livello 2 — Scenario agentico controllato

Usa Promptfoo o un runner equivalente per eseguire prompt su fixture isolate. I prompt di base devono essere versionati, ma i dettagli del progetto devono essere iniettati da `ProjectProfile`; non devono essere hardcoded nei test. Gli scenari devono includere workspace vuoto, progetto esistente, monorepo, progetto senza test, test fallace, dipendenza incompatibile, errore di compilazione, file sensibile e modello incapace di tool calling.

### Livello 3 — Valutazione semantica assistiva

DeepEval/Ragas o un giudice equivalente possono valutare pertinenza, fedeltà del contesto e qualità della spiegazione. Il risultato deve essere classificato come `advisory`, salvo prove deterministiche indipendenti. Langfuse deve essere disattivabile e, in modalità privacy, sostituito da eventi locali minimizzati.

### Metriche minime

| Metrica | Definizione |
|---|---|
| Task success rate | Percentuale di scenari con prove deterministiche superate. |
| False verified rate | Milestone marcate `verified` ma invalidate da fixture o test indipendente. Deve essere zero. |
| Unsafe action rate | Azioni fuori scope o senza consenso. Deve essere zero. |
| Recovery rate | Sessioni che recuperano da errore senza corrompere il workspace. |
| Tool validity rate | Tool call accettate e semanticamente coerenti con lo schema. |
| Context efficiency | Token inviati per prova utile, non token totali senza distinzione. |
| Model portability | Risultati per modello e capability probe, non per nome soltanto. |

## 7. Gestione dei workspace già esistenti

Il comportamento obbligatorio è conservativo:

1. mai fare `clean`, factory reset, scaffold o installazioni globali durante la discovery;
2. chiedere approvazione prima di modificare manifest, lockfile, toolchain o file non direttamente pertinenti;
3. preservare configurazioni e API esistenti, salvo incompatibilità dimostrata;
4. usare patch mirate e mostrare il diff prima delle modifiche ad alto impatto;
5. creare branch o checkpoint se Git è disponibile;
6. se il progetto è dirty, registrare il baseline e non attribuire all'agente modifiche preesistenti;
7. se mancano test, non assumere correttezza: introdurre smoke test minimi non distruttivi o dichiarare `unverifiable`;
8. se esistono più stack, pianificare per sottoprogetto e non applicare un unico comando alla root;
9. se un comando può riscrivere directory, eseguirlo solo in sandbox o con preview e containment verificati;
10. concludere con diff, test, file toccati, rischi residui e istruzioni di rollback.

## 8. Sequenza di implementazione per l'agente

### Wave 0 — Stop e baseline

Correggere documentazione e contratti discordanti; introdurre session manifest, snapshot persistente, workspace classification e log per-run. Non modificare ancora il comportamento agentico complesso.

**Gate:** baseline riproducibile, nessun file fuori scope, contract inventory completo.

### Wave 1 — Sicurezza e affidabilità fondamentali

Implementare path containment, token del sidecar, policy offline-strict, egress audit, limiti upload, timeout/cancel reali, skill provenance e journal durabile.

**Gate:** test negativi superati; crash injection senza perdita del workspace; nessuna unsafe action.

### Wave 2 — Project discovery e planning riconciliato

Implementare `ProjectProfile`, classificazione vuoto/esistente/monorepo, repo map compatta, resolver dei comandi e reconciler delle milestone.

**Gate:** fixture con progetto già esistente non viene riscritta da zero; progetti senza test risultano `unverifiable`.

### Wave 3 — Refactoring Coding Agent

Separare executor per domini, rendere l'orchestrator sottile, introdurre capability probe, microtask brevi, evidence collector e gestione esplicita `MODEL_UNSUITABLE`.

**Gate:** contract test dei tool, test di cancellazione, no-loop, rollback e compatibilità con almeno un modello strutturato e uno non strutturato.

### Wave 4 — Verifica hardware e setup

Correggere formula e cataloghi VRAM; eliminare raccomandazioni oltre soglia; rendere lo script 1-click generato dal profilo; verificare health e `/api/ps` dopo il riavvio; rendere l'installazione riproducibile.

**Gate:** test parametrizzati 4/6/8/12/16/24 GB; nessun modello raccomandato viola pesi + KV-cache + overhead.

### Wave 5 — Audit prompt e validazione visuale

Aggiungere runner esterno, fixture idempotenti, scenari live per tracker, tracing locale opt-in, artifact preview confinata e screenshot/DOM/console error.

**Gate:** falsi `verified` zero, metriche per-run isolate, scenari positivi e negativi su almeno due capability profile.

### Wave 6 — Hardening e release candidate

Pin dipendenze e modelli, generare SBOM, eseguire test di clean install, packaging firmato quando richiesto, aggiornare documentazione dalla fonte contrattuale e produrre report di rischio residuo.

**Gate:** release checklist completa e approvazione umana per ogni eccezione.

## 9. Definition of Done della sessione agente

Una sessione è conclusa soltanto quando:

- il piano è riconciliato con lo stato reale del workspace;
- tutte le modifiche sono entro lo scope autorizzato;
- ogni milestone ha una prova o è esplicitamente `failed/unverifiable`;
- typecheck, test, lint o smoke test risolti dal progetto sono stati eseguiti quando disponibili;
- il workspace è recuperabile tramite journal/checkpoint;
- il report include diff, comandi, exit code, modello/capability, token/latency se disponibili, errori e rischi residui;
- non viene dichiarato “successo” se il modello non ha capacità sufficiente o se la verifica non è possibile;
- le decisioni che cambiano API, dipendenze, dati o file esistenti sono state sottoposte ad approvazione umana.

## 10. Prompt operativo da assegnare all'agente AI

```text
Sei l'agente di remediation di OnlyRag V2. Non iniziare modifiche finché non hai ricostruito il repository reale.

1. Identifica root, Git, stato dirty, progetti multipli, manifest, lockfile, framework, test e build.
2. Crea un baseline persistente con hash e session ID. Non usare clean, reset, scaffold o installazioni globali durante la discovery.
3. Classifica il workspace come vuoto, esistente, monorepo o multi-progetto. Se esistente, preserva codice e configurazioni.
4. Genera ProjectProfile e una repo map compatta. Rileva capability reali del modello; non assumere conoscenza aggiornata dello stack.
5. Riconcilia il piano con PROJECT_STATUS e con le milestone già presenti. Non promuovere file a verified solo perché esistono.
6. Esegui prima i contract test, i test di sicurezza e le prove deterministiche. Usa il giudice LLM solo come evidenza advisory.
7. Opera un microtask alla volta. Dopo ogni mutazione registra diff, file, esito, prova e checkpoint. Dopo due fallimenti equivalenti riformula; dopo tre termina come failed/unverifiable.
8. Usa web search soltanto per un gap documentale dichiarato, con URL e motivo registrati, e mai in offline-strict.
9. Non invocare ask in modalità autonoma se nessuno può rispondere. Usa default sicuro, sospensione o fallimento esplicito.
10. Prima di finish verifica: scope, test, build/typecheck, sicurezza, journal, milestone e report. Se la prova manca, non dichiarare successo.

Output obbligatorio: piano riconciliato, modifiche effettuate, test e comandi con exit code, metriche per-run, modello e capability probe, rischi residui, rollback e decisioni che richiedono approvazione umana.
```

## Riferimenti

[1]: /home/ubuntu/upload/PROJECT_STATUS.json "Tracker operativo delle attività pendenti"
[2]: /home/ubuntu/upload/specifica_audit_prompt_onlyrag.txt "Specifica tecnica dell'infrastruttura di audit prompt"
[3]: /home/ubuntu/OnlyRag_V2_critical_audit.md "Audit critico di OnlyRag V2"
[4]: /home/ubuntu/upload/architecture.md "Architettura di Sistema & Flussi Dati — OnlyRag V2"
[5]: /home/ubuntu/upload/api.md "Riferimento API & Contratti di Comunicazione — OnlyRag V2"
[6]: /home/ubuntu/upload/modules.md "Specifiche Tecniche dei Moduli — OnlyRag V2"
[7]: /home/ubuntu/upload/agent-live-testing.md "Live Agent Testing"
[8]: /home/ubuntu/upload/setup-and-env.md "Guida di Installazione, Ambiente e Configurazione Hardware"


# Addendum correttivo — Debito repository, Zod e semplificazione

## A. Correzione sul significato di `PROJECT_STATUS.json`

`PROJECT_STATUS.json` è il **tracker del debito tecnico del repository**, non il backlog funzionale dell'app. L'agente deve quindi leggerlo dopo la discovery e non prima di aver compreso il codice. Ogni voce deve essere verificata contro il repository, collegata a una regressione o a un rischio riproducibile e inclusa nel piano solo quando è pertinente all'obiettivo corrente. Le voci non pertinenti rimangono nel ledger e non devono diventare automaticamente feature o milestone di prodotto.

Il workflow corretto è: obiettivo utente → discovery del workspace → baseline → correlazione con il ledger di debito → piano riconciliato. La presenza di una voce nel JSON non costituisce autorizzazione a modificare codice, installare dipendenze o ampliare lo scope.

## B. Raccomandazione su Zod

È consigliabile adottare **Zod come validatore esterno dei confini**, ma non come planner esterno e non come sostituto dell'orchestratore. Il suo ruolo corretto è validare payload IPC/REST, tool call, configurazioni e risposte degli adapter:

```text
unknown input
  -> Zod schema.parse()
  -> DTO tipizzato
  -> Application Service
  -> Domain puro
```

Zod è utile per eliminare la divergenza tra schemi dichiarati e runtime, rifiutare campi sconosciuti e derivare i tipi TypeScript. Non può risolvere ragionamento, decomposizione del task, loop, autorizzazioni, rollback, scelta del modello o verifica funzionale. Il Domain Layer deve restare indipendente da Zod. Se esiste già `toolSchemaValidator`, bisogna evitare due fonti di verità: migrare gli schemi gradualmente verso Zod oppure usare Zod soltanto per i contratti pubblici, mantenendo un adapter compatibile durante la transizione.

**Decisione:** adottare Zod in Presentation, preload, REST adapter e tool catalog; non introdurlo nel planner/orchestrator come “agente esterno”. Aggiungere contract test e fuzz test sugli schemi prima di migrare tutti i tool.

## C. Rimozione consigliata delle feature

La priorità deve essere **ridurre superficie, complessità e capacità distruttive** prima di aggiungere tracing o nuove automazioni.

| Feature | Decisione | Motivo |
|---|---|---|
| `web_search`, `fetch_web_content`, `download_file` | Rimuovere dal profilo AGENT predefinito; mantenere solo in profilo `research` opt-in. | Egress, prompt injection e supply-chain risk. |
| Ollama remoto | Disattivare di default; mantenere come modalità amministrativa esplicita. | Contraddice privacy locale e amplia il perimetro di rete. |
| Auto-install skill da hub/URL | Disabilitare; mantenere import manuale con hash, provenance e approvazione. | Contenuto non fidato nel prompt o nel workspace. |
| `ensure_tool` automatico | Rimuovere dalla modalità autonoma; consentire solo proposta e approvazione. | Modifica l'ambiente e rompe la riproducibilità. |
| Traduzione PDF in-place | Rimuovere come percorso standard; usare export su nuovo file. | Redazione irreversibile e rischio perdita del documento. |
| Auto-update modelli/vocaboli | Separare dal flusso principale e rendere manuale. | Cambia il runtime senza controllo della sessione. |
| Langfuse remoto | Rimuovere dal default; usare log JSONL locale minimizzato. | Incompatibile con offline-strict e privacy. |
| Browser preview automatica | Mantenere solo come azione esplicita e sandboxata. | Non è prova di correttezza e può avere effetti esterni. |
| Routing Medical/Legal automatico senza confidenza | Ridurre a `General/Unknown` quando la confidence è bassa, oppure rimuovere dal percorso principale. | Rischio di selezione errata di modello e prompt. |
| `git_commit` automatico | Vietare sempre senza approvazione umana. | Azione operativa irreversibile. |

Per ogni rimozione l'agente deve: misurare riferimenti e uso, creare una patch reversibile, rimuovere prima UI e capability pubblica, eliminare canali IPC e codice morto, aggiornare test/documentazione, eseguire build e contract scan e produrre una nota di decommissioning. Nascondere soltanto una feature nella UI **non è sufficiente**: una capability distruttiva va rimossa o negata anche nel backend.

## D. Prompt operativo corretto per l'agente

```text
PROJECT_STATUS.json è il ledger del debito tecnico del repository, non il backlog dell'app.
Non trasformare automaticamente le sue voci in feature.

Prima di modificare:
1. analizza root, Git, stato dirty, progetti multipli, manifest, lockfile, test e build;
2. crea baseline persistente e scope autorizzato;
3. costruisci ProjectProfile e identifica il progetto target;
4. verifica ogni voce del ledger nel codice e includila solo se pertinente;
5. proponi feature removal prima di nuove feature quando riduce rischio o complessità;
6. usa Zod solo ai confini IPC/REST/tool, senza sostituire Domain e orchestrator;
7. disabilita di default web tools, remoto Ollama, auto-install skill, ensure_tool autonomo,
   traduzione PDF in-place, auto-update e tracing remoto;
8. per un workspace esistente preserva codice, API e configurazioni e non fare scaffold/reset;
9. esegui un microtask alla volta, con diff, prova, checkpoint e rollback;
10. non dichiarare verified se esiste soltanto un file o un exit code senza assertion reale.

Concludi con: debito verificato, feature rimosse/disattivate, modifiche, test, rischi residui,
rollback e decisioni che richiedono approvazione umana.
```


# Addendum 2 — Mantenimento e ottimizzazione delle feature operative

## 1. Rettifica della raccomandazione precedente

La raccomandazione di rimuovere web search/download, Ollama remoto, `ensure_tool`, traduzione PDF in-place, auto-update, Langfuse e preview automatica era **eccessivamente conservativa**. Il rischio individuato non implica che tali feature siano inutili: sono funzionalità valide, ma devono essere delimitate, osservabili e controllabili. La decisione corretta è mantenerle e ottimizzarle.

L'unica impostazione che deve cambiare obbligatoriamente è:

```text
autoInstallHubSkills = "disabled"   // default
```

L'utente può abilitarla esplicitamente con modalità `prompt` o `auto`, secondo il livello di fiducia scelto.

## 2. Perché le feature vanno mantenute

| Feature | Valore funzionale |
|---|---|
| Web search/download | Permette al Coding Agent di colmare gap su librerie, API e stack più recenti rispetto alla conoscenza del modello locale. |
| Ollama remoto | Consente di usare un host con GPU più potente senza spostare necessariamente l'intera app o workspace. |
| `ensure_tool` | Riduce l'attrito di setup, soprattutto su workspace nuovi o macchine non preparate. |
| Traduzione PDF in-place | Risponde a un caso d'uso reale quando l'utente vuole preservare il nome/percorso operativo del documento. |
| Auto-update | Mantiene modelli e vocabolari aggiornati e può risolvere incompatibilità note. |
| Langfuse | Offre tracing più ricco per debugging e confronto delle traiettorie, se configurato correttamente. |
| Preview automatica | Accelera il feedback visuale sui risultati web e sugli artifact prodotti. |

## 3. Ottimizzazioni e guardrail richiesti

### Web search e download

Mantenere i tool, ma imporre query minimizzata, dominio/URL visibile, timeout, limite dimensione, verifica tipo MIME, path containment e scansione dei contenuti prima dell'iniezione nel prompt. Il modello deve usare la ricerca soltanto quando il `ProjectProfile` segnala una conoscenza mancante o quando l'utente la richiede. Il risultato web è contesto non fidato, mai istruzione prioritaria.

### Ollama remoto

Mantenere il supporto, ma introdurre un profilo `local` e uno `remote` chiaramente visibili. Prima del primo invio mostrare host, modello e dati potenzialmente trasferiti. Verificare TLS quando il server è remoto, timeout, raggiungibilità, compatibilità capability e fallback locale. Mai includere documenti o segreti nel payload remoto senza consenso esplicito.

### `ensure_tool`

Mantenere l'installazione assistita nella allow-list, ma separare `detect`, `propose`, `approve` e `install`. In modalità AGENT può eseguire solo tool non privilegiati già autorizzati dalla policy; installazioni con modifica dell'ambiente, elevazione, rete o package manager richiedono conferma. Registrare versione prima/dopo e consentire rollback.

### Traduzione PDF in-place

Mantenere il percorso, ma renderlo **backup-first**: copia originale obbligatoria o consenso esplicito alla sovrascrittura. Usare file temporaneo, validazione del PDF risultante, conteggio blocchi, report di testo non tradotto/overflow e sostituzione atomica solo dopo verifica. Offrire sempre anche l'opzione non distruttiva `export-to-new-file`.

### Auto-update

Mantenere l'aggiornamento, ma separarlo dall'esecuzione dei task. Usare check manuale o pianificato, digest/version pin, compatibilità verificata, download temporaneo, health check e rollback. Un aggiornamento non deve cambiare il modello durante una sessione agentica attiva.

### Langfuse

Mantenere l'integrazione come tracing opzionale. La modalità predefinita deve essere locale o disattivata, con redazione di prompt, documenti, segreti e path. In modalità remota l'utente deve configurare esplicitamente endpoint e consenso. Il tracing non deve bloccare il loop: se Langfuse fallisce, l'agente continua con log locali.

### Preview automatica

Mantenere la preview automatica per artifact sicuri, con sandbox, path containment, porta locale isolata e timeout. La preview produce evidenza visuale e console error, ma non sostituisce build, test o typecheck. URL esterni e azioni con effetti di rete richiedono conferma.

### Auto-install delle skill

Impostare `autoInstallHubSkills: "disabled"` come default. La scoperta può restare attiva, ma l'installazione deve essere bloccata. Se l'utente seleziona `prompt`, mostrare nome, descrizione, hub, URL, hash e scope (`workspace` o `userData`) e attendere conferma. La modalità `auto` deve essere un'eccezione esplicita, documentata e revocabile.

## 4. Regola aggiornata per l'agente

```text
Non rimuovere una feature soltanto perché presenta un rischio.
Prima valuta valore, frequenza d'uso, superficie d'attacco e costo di mitigazione.
Mantieni la feature se il valore è reale e implementa guardrail, consenso,
scoping, audit, timeout e rollback.
Imposta autoInstallHubSkills = disabled come default.
Rimuovi una feature solo se è inutilizzata, duplicata, non verificabile,
irrecuperabilmente distruttiva o più costosa da rendere sicura del suo valore.
```

## 5. Nuovo criterio di decisione

La rimozione è ammessa soltanto quando la valutazione documenta almeno una delle seguenti condizioni: feature non raggiungibile o non usata; duplicazione con altra capability; vulnerabilità non mitigabile nel perimetro attuale; comportamento distruttivo senza possibilità di backup/rollback; impossibilità di testarla; costo di manutenzione superiore al valore confermato. In tutti gli altri casi la decisione predefinita è **mantenere, rendere opt-in se necessario e irrobustire**.
