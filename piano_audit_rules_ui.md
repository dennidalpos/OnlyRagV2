# Piano di Audit e Validazione Architetturale: Integrazione Prompt UI Gerarchico

Questo documento funge da specifica tecnica e piano di audit per verificare la fattibilità, l'impatto e la corretta integrazione del modulo **Dynamic Prompt & Hierarchy Rules UI** all'interno dell'ecosistema **OnlyRag V2**.

L'obiettivo è analizzare l'architettura corrente del progetto, proporre le opzioni implementative e lasciare che l'Assistente AI valuti l'approccio migliore in base ai vincoli del sistema (Clean Architecture, performance su hardware minimo, prevenzione VRAM Thrashing).

---

## 1. Obiettivi dell'Audit

* **Fattibilità dell'Ereditarietà**: Verificare se l'albero gerarchico delle regole può essere linearizzato e iniettato nell'assembler dei prompt senza alterare i contratti dei moduli core (`agentOrchestratorAppService.ts`, `useChatEngine.ts`).
* **Integrazione del File System**: Determinare il posizionamento ideale del file di configurazione (`prompt_rules.json`) rispettando l'isolamento dei workspace e la persistenza globale di fallback.
* **Impatto sul Context Window**: Valutare come il calcolo dinamico dei token (`gpt-tokenizer`) e i compattatori euristici (`heuristicContextCompactor.ts`) debbano reagire a prompt di sistema mutabili configurati dall'utente.
* **UI Jitter & Monaco Sync**: Ispezionare lo stack del Renderer per garantire che l'albero UI e le istanze di Monaco Editor non introducano latenze o riscritture ridondanti su disco.

---

## 2. Analisi dei Componenti Impattati

Prima di procedere con la scrittura del codice, l'AI deve analizzare e validare le interazioni sui quattro livelli della **Layered Clean Architecture** di OnlyRag V2:

### A. Presentation Layer (IPC Router)
* Canali ipotizzati: `rules:get-tree`, `rules:save-tree`, `rules:reset-defaults`.
* *Punto di verifica:* Come evitare collisioni con i canali esistenti delle Skill (`skills:*`) e della cronologia (`sessions:*`).

### B. Application Layer (Orchestratori & Use Cases)
* File critico: `electron/core/application/agentOrchestratorAppService.ts`.
* *Punto di verifica:* Il ciclo agentico autonomo (Tool Calling Loop) estrae la testa del prompt ad ogni turno. L'iniezione dell'albero delle regole deve avvenire via caching in memoria o tramite lettura FS ad ogni inizio task per preservare le performance?

### C. Domain Layer (Pure Business Logic)
* File critico: `electron/core/domain/agent/heuristicContextCompactor.ts`.
* *Punto di verifica:* Se l'utente imposta regole molto estese per un sotto-modulo, il compattatore (attivato al 75% del watermark hardware) deve poter troncare o riassumere anche le regole utente, o queste vanno considerate un "Immutable Anchor"?

### D. Infrastructure Layer (I/O & Repository)
* File critico: `electron/core/infrastructure/filesystem/fileSystemRepository.ts`.
* *Punto di verifica:* Applicazione del pattern di scrittura atomica `tmp + rename` per prevenire file JSON corrotti.

---

## 3. Opzioni di Approccio ad Alto Livello (Sottoposte ad Audit AI)

L'AI è invitata a valutare e confrontare i tre seguenti approcci, selezionando quello ottimale o proponendo una sintesi ibrida:

| Criterio | Approccio 1: Stateless On-Demand | Approccio 2: Stateful Memory Cache | Approccio 3: Sidecar-Driven DB (LanceDB) |
| :--- | :--- | :--- | :--- |
| **Descrizione** | Il Main Process legge il JSON da disco solo all'avvio di un task o di una chat, assemblando il prompt al volo. | Le regole vengono caricate in un Singleton di stato nel Main Process al boot dell'app e aggiornate solo via IPC. | Le regole vengono indicizzate in una tabella dedicata di LanceDB (`prompt_rules`) e recuperate via query scalare dal Sidecar. |
| **Vantaggi** | Zero overhead di memoria RAM; consistenza immediata se il file viene modificato esternamente. | Latenza di recupero prompt pari a 0ms; ideale per i loop agentici rapidi multi-step. | Consente ricerche semantiche sulle sotto-regole e integrazione nativa con la pipeline RAG. |
| **Svantaggi** | Leggero I/O overhead ad ogni turno dell'agente (ridotto se mitigato da OS caching). | Rischio di desincronizzazione se l'utente modifica il JSON manualmente su disco senza passare dalla UI. | Introduce dipendenza asincrona verso il Sidecar Python anche per la sola generazione del prompt di sistema. |

---

## 4. Criteri di Accettazione e Valutazione (DoD)

Il piano sarà considerato valido se risponde positivamente ai seguenti vincoli di progetto:
1. **Zero Hardcoded Prompts**: Nessun blocco di testo di sistema deve rimanere cablato nell'applicazione, eccetto lo schema dei 27 tool e i preamboli di ripiegamento TDD.
2. **Hardware Protection**: Sistemi operanti su host classificati come `legacy` o `entry` non devono subire degradi di throughput (token/s) a causa dell'assemblaggio gerarchico.
3. **Falsificabilità del Piano**: L'albero gerarchico deve poter iniettare i criteri di accettazione specifici in modo che si riflettano sul modulo `planFalsifiabilityNormalizer.ts`.

---

## 5. Richiesta di Parere all'Assistente AI

*In base alla documentazione fornita e alla topologia di OnlyRag V2, quale dei tre approcci proposti garantisce la massima resilienza, isolamento e velocità di esecuzione all'interno del processo Electron Main? Esistono colli di bottiglia latenti legati all'uso combinato di React 19 e Monaco Editor per la manipolazione di strutture ad albero ricorsive?*