# Specifiche Tecniche: Librerie Esterne e Implementazioni di Dominio — OnlyRag V2

Questo documento costituisce la fonte di verità sulle dipendenze esterne utilizzate in **OnlyRag V2**, i rispettivi casi d'uso architetturali e le ragioni tecniche alla base delle implementazioni di dominio sviluppate su misura laddove non esistono librerie standard idonee.

---

## 1. Principi di Governance delle Dipendenze

1. **Zero Homegrown Logic per Funzionalità Standard**: Per crittografia, tokenizzazione, diffing, parsing, terminale, elaborazione immagini, database vettoriale e linguistica, il progetto impiega librerie industriali ampiamente testate, mature e ottimizzate.
2. **Isolamento e Sicurezza Locale**: Tutte le dipendenze devono supportare l'esecuzione 100% offline (on-premise / localhost), senza telemetria né chiamate a endpoint cloud remoti.
3. **Astrazioni Minime**: Si evitano mega-framework monolitici (es. LangChain, AutoGen, LlamaIndex) che introducono dipendenze opache, latenza IPC e fragilità di runtime.

---

## 2. Inventario Completo delle Librerie Esterne

### 2.1. Frontend Renderer (React 19 / TypeScript)

| Libreria | Versione | Caso d'Uso Specifico nel Repository |
| :--- | :--- | :--- |
| **`@monaco-editor/react`** | `^4.7.0` | Motore di editing di codice, visualizzazione diff side-by-side (`DiffEditor`), evidenziazione sintattica e sincronizzazione scroll nelle viste Coding, Traduzione e Ingestione. |
| **`@tanstack/react-virtual`** | `^3.14.10` | Virtualizzazione DOM dell'Agent Timeline (`useVirtualizer` con `measureElement` dinamico per-riga), garantendo prestazioni fluide con migliaia di log ed evitando il sovraccarico del renderer. |
| **`gpt-tokenizer`** | `^4.0.0` | Conteggio deterministico dei token reali tramite Byte-Pair Encoding (BPE `o200k_base` / `cl100k_base`) per la stima precisa dell'utilizzo del context window dei modelli. |
| **`lucide-react`** | `^1.31.0` | Iconografia SVG standardizzata, accessibile e ad alte prestazioni in tutta la UI. |
| **`tailwindcss`** | `^4.0.7` | Framework CSS utility-first per lo styling reattivo, layout a griglia/flex e temi dark ad alto contrasto. |

---

### 2.2. Electron Main Process (Node.js / TypeScript)

| Libreria | Versione | Caso d'Uso Specifico nel Repository |
| :--- | :--- | :--- |
| **`node-pty`** | `^1.1.0` | Gestione a basso livello del pseudo-terminale Windows ConPTY per l'esecuzione di comandi interattivi PowerShell e streaming bidirezionale di I/O nel terminale integrato. |
| **`diff`** | `^9.0.0` | Algoritmo standard di Myers (`diffLines`, `parsePatch`) per il calcolo delle differenze riga per riga, generazione di statistiche di modifica (+/-) e scomposizione in hunk atomici (`groupDiffIntoHunks`). |
| **`fast-levenshtein`** | `^3.0.0` | Calcolo della distanza di Levenshtein per la ricerca fuzzy rapida di file nel workspace (`WorkspaceExplorer`). |
| **`jsonrepair`** | `^3.15.0` | Riparazione e normalizzazione tollerante di payload JSON malformati, troncati o contenenti commenti generati dagli LLM locali nel Tool Calling Loop. |
| **`cheerio`** | `^1.2.0` | Parsing DOM lato server per l'estrazione pulita del testo da pagine web nel tool agentico `fetch_web_content`. |
| **`turndown`** | `^7.2.4` | Conversione deterministica da HTML a Markdown strutturato per l'indicizzazione e la consultazione web. |
| **`js-yaml`** | `^4.1.0` | Parsing ed estrazione dei metadati YAML frontmatter nei manifesti delle skill agentiche (`SKILL.md`) e serializzazione YAML. |
| **`mustache`** | `^4.2.0` | Motore di rendering dei template di system prompt (`promptTemplateEngine.ts`): sostituzione variabili, innesto dei blocchi figli come partial (`{{> directives}}`, `{{> tools}}`) e sezioni condizionate sulle capability del modello (`{{^nativeToolCalling}}`). `Mustache.parse()` fornisce l'AST usato dal validatore per intercettare partial mancanti o duplicati. Scelto perche' **logic-less**: i template sono editabili dall'utente e persistiti, quindi un motore che compila a `new Function` (Eta, EJS, Handlebars) sarebbe una superficie di code injection e richiederebbe `unsafe-eval`, incompatibile con `contextIsolation: true`. |
| **`strip-ansi`** | `^7.2.0` | Rimozione dei codici di escape ANSI di colore e formattazione dai log shell prima della persistenza su disco e dell'invio all'LLM. |
| **`gpt-tokenizer`** | `^4.0.0` | Calcolo deterministico dei token reali BPE (`o200k_base`) per la selezione ottimale del `num_ctx` Ollama (`contextWindowCalculator.ts`). |
| **`p-queue`** | `^9.3.3` | Accodamento sequenziale dei task asincroni con dispatch a priorita'. |

---

### 2.3. Python Sidecar (FastAPI / Machine Learning / OCR)

| Libreria | Versione | Caso d'Uso Specifico nel Repository |
| :--- | :--- | :--- |
| **`fastapi` & `uvicorn`** | `>=0.110.0` / `>=0.28.0` | Framework web REST asincrono locale per l'orchestrazione delle API di ingestion, embedding, ricerca vettoriale e traduzione documenti. |
| **`lancedb`** | `>=0.6.0` | Vector database embedded zero-server basato su Apache Arrow, ottimizzato per ricerche vettoriali ad alta dimensione e filtri scalari atomici. |
| **`pymupdf` (fitz)** | `>=1.24.0` | Motore C++ per il parsing, rasterizzazione ad alta risoluzione (300 DPI), estrazione dei blocchi di testo, bounding box geometriche e redazione in-place di documenti PDF. |
| **`python-docx`** | `>=1.1.0` | Lettura, analisi strutturale a paragrafi/tabelle e generazione di documenti Word (.docx) preservando la formattazione originale. |
| **`rapidocr-onnxruntime`** | `>=1.4.0` | Motore OCR basato su modelli ONNX con rilevamento automatico dell'accelerazione hardware CUDA via ONNX Runtime GPU. |
| **`chevron`** | `>=0.14.0` | Renderer Mustache del prompt `images:analysis` per il Vision OCR: le variabili per-pagina (`currentPage`, `numPages`, `activePageContent`) sono note solo dentro il loop di pagina del sidecar, quindi il template arriva grezzo da Electron e viene reso qui (`domain/vision_prompt.py`). Stesso motore logic-less di `mustache` lato renderer, così un override scritto dall'utente si comporta identicamente sui due lati. |
| **`opencv-python-headless`** | `>=4.8.0` | Elaborazione computer vision per l'ottimizzazione dell'immagine prima dell'OCR (filtri CLAHE per il contrasto della luminanza ed equalizzazione unsharp mask). |
| **`pillow` (PIL)** | `>=10.0.0` | Manipolazione delle immagini bitmap, correzione dell'orientamento EXIF e ricampionamento Lanczos. |
| **`ftfy`** | `>=6.2.0` | Riparazione universale automatica di testo Unicode corrotto, mojibake e sequenze di codifica errate provenienti da PDF o scansioni OCR. |
| **`symspellpy`** | `>=6.7.7` | Correzione ortografica simmetrica in tempo quasi-costante ($O(1)$) per la ricostruzione di parole spezzate o fuse dall'OCR. |
| **`wordfreq`** | `>=3.1.0` | Frequenze statistiche dei lemmi su corpora multilingua (Italiano, Inglese, Francese, Spagnolo, Tedesco) per l'algoritmo di segmentazione Viterbi. |
| **`langdetect`** | `>=1.0.9` | Rilevamento automatico della lingua dominante del documento per l'applicazione delle pipeline corrette. |
| **`httpx`** | `>=0.27.0` | Client HTTP con connection pooling verso il server Ollama locale (`http://127.0.0.1:11434`). |
| **`numpy` & `pandas`** | `>=1.26.0` | Calcolo matriciale, operazioni di similarità coseno e manipolazione di DataFrame Arrow per LanceDB. |

---

### 2.4. Codebase Architecture & Hygiene Audit (DevDependencies)

| Libreria | Versione | Caso d'Uso Specifico nel Repository |
| :--- | :--- | :--- |
| **`dpdm`** | `^4.3.0` | Analisi statica dei cicli di importazione e dipendenze circolari (*circular dependencies*) tra moduli TypeScript/JavaScript (`src/main.tsx`, `electron/main.ts`), con risoluzione nativa di `tsconfig.json`. |
| **`knip`** | `^6.32.2` | Analisi di code hygiene completa: rilevamento di file orfani, funzioni/tipi esportati ma non utilizzati, e dipendenze fantasma o non dichiarate in `package.json` (`knip.json`). |
| **`skott`** | `^0.35.11` | Generazione del grafo di dipendenze architetturali con esportazione CLI ad albero (`file-tree`) e Web UI interattiva locale (`--displayMode=webapp`) per esplorare visivamente i collegamenti tra moduli. |

---

## 3. Implementazioni di Dominio su Misura (Custom Domain Implementations)

Le seguenti architetture e logiche sono state implementate direttamente nel codebase di OnlyRag V2 poiché **non esistono librerie standard o pacchetti open source** in grado di soddisfare i requisiti specifici di privacy locale, integrazione con Electron e sicurezza transazionale:

### 3.1. Agent Tool-Calling Loop & Definition-of-Done Gate
* **Moduli:** [`agentOrchestratorAppService.ts`](../electron/core/application/agentOrchestratorAppService.ts), [`agentToolExecutorService.ts`](../electron/core/application/agentToolExecutorService.ts), [`atomicWorkspaceJournal.ts`](../electron/core/domain/agent/atomicWorkspaceJournal.ts)
* **Motivazione Tecnica:** I framework agentici generici (LangChain, AutoGen) impongono runtime Python esterni pesanti, non supportano il journaling transazionale nativo con rollback a livello di singolo step del filesystem Windows, e non dispongono di un Definition-of-Done Verification Gate pre-terminazione che verifichi l'assenza di errori di compilazione e comandi pendenti prima di consentire all'LLM di chiudere il task.
* **Soluzione Implementata:** Engine deterministico in TypeScript nel processo Main di Electron, con Finite State Machine (`ASK`, `PLAN`, `AGENT`), rilevatore crittografico di oscillazioni ad anello (SHA-256 loop detection via `AgentActionLoopDetector`), riparazione JSON automatica con `jsonrepair` e snapshot atomici del filesystem pre-mutazione.

---

### 3.2. Calcolo Dinamico della VRAM Netta e Profilazione Hardware Host
* **Moduli:** [`hardwareProfileTiers.ts`](../src/services/hardwareProfileTiers.ts), [`hardwareRecommendationEngine.ts`](../src/services/hardwareRecommendationEngine.ts), [`hardwareProfileResolver.ts`](../electron/core/domain/agent/hardwareProfileResolver.ts)
* **Motivazione Tecnica:** Nessuna libreria NPM o PyPI è in grado di calcolare con precisione il margine di sicurezza della VRAM su macchine Windows per prevenire i crash CUDA OOM di Ollama, considerando congiuntamente:
  1. La VRAM fisica dedicata rilevata da NVML / WMI.
  2. L'overhead del Windows Desktop Window Manager (DWM) e delle applicazioni GPU in esecuzione.
  3. I requisiti di quantizzazione reale dei modelli GGUF (`Q4_K_M`, `Q8_0`, `FP16`) e il dimensionamento dinamico della KV-Cache per contesto (`num_ctx`).
* **Soluzione Implementata:** Unica fonte di verità matematica distribuita su 5 tier hardware deterministici (`legacy`, `entry`, `midrange`, `highend`, `extreme`), con formule analitiche di dimensionamento e cascata automatica di fallback (`buildFallbackChain`).

---

### 3.3. Traduzione In-Place di PDF con Preservazione della Geometria Vettoriale
* **Moduli:** [`translator.py`](../sidecar/domain/translator.py)
* **Motivazione Tecnica:** Gli strumenti di traduzione PDF commerciali si basano su servizi cloud proprietari (Google Cloud Translation API, Azure Document Translation). Le librerie open source per PDF si limitano ad estrarre testo grezzo perdendo layout, formattazione, tabelle e coordinate visive.
* **Soluzione Implementata:** Pipeline integrata locale che combina PyMuPDF, RapidOCR e Ollama:
  1. Estrazione dei blocchi vettoriali e/o OCR con coordinate pixel esatte (`bbox`).
  2. Redazione atomica in-place del testo raster/vettoriale sottostante.
  3. Traduzione contestuale del testo tramite LLM locale con preservazione assoluta di entità (email RFC, URL, codici fiscali).
  4. Re-typesetting vettoriale nella posizione originale con calcolo dinamico della dimensione font (`fontsize` fitting loop) per evitare overflow dei riquadri.

---

### 3.4. Subword Semantic Centroid Intent Router
* **Moduli:** [`domainRouter.ts`](../src/services/domainRouter.ts)
* **Motivazione Tecnica:** L'esecuzione di un modello di classificazione d'intento o di un embedding LLM ad ogni singolo carattere o prompt digitato nella UI genererebbe latenza percettibile (200-800ms) e continuo context switching in VRAM.
* **Soluzione Implementata:** Sub-Router sincrono e deterministico in puro TypeScript basato su vettori di centroidi semantici sub-parola e radici morfologiche multilingua (Italiano, Inglese, Spagnolo, Francese, Tedesco), in grado di classificare l'intento di dominio (Generale, Medico, Legale) in $<1\text{ms}$ con zero consumo di VRAM.

---

### 3.5. Graph TextRank Extractive Summarizer
* **Moduli:** [`textRankSummarizer.ts`](../electron/core/domain/nlp/textRankSummarizer.ts), [`chatContextCompactor.ts`](../src/services/chatContextCompactor.ts)
* **Motivazione Tecnica:** Per compattare le cronologie di chat lunghe senza troncare a freddo i messaggi storici, l'invocazione di un modello di riassunto neurale saturerebbe la VRAM dell'host durante lo streaming della chat.
* **Soluzione Implementata:** Implementazione nativa in TypeScript dell'algoritmo TextRank di Mihalcea & Tarau (2004) con iterazione di PageRank (power iteration) su grafi di similarità di Jaccard e matrici di adiacenza tra frasi, garantendo riassunti estrattivi immediati a costo computazionale nullo.

---

### 3.6. Pre-Flight Clarification Interview & Enriched Prompting (Claude Code Style)
* **Moduli:** [`agentInterviewAppService.ts`](../electron/core/application/agentInterviewAppService.ts), [`PlanInterviewCard.tsx`](../src/components/coding/PlanInterviewCard.tsx), [`usePlanApproval.ts`](../src/hooks/usePlanApproval.ts)
* **Motivazione Tecnica:** Prima di avviare la generazione automatica di un piano d'azione, richieste ambigue dell'utente su architettura, persistenza o styling richiedono una chiarificazione preliminare interattiva, fornendo opzioni mirate con default consigliato e supporto write-in.
* **Soluzione Implementata:** Servizio application layer che interroga l'LLM locale con schema JSON rigoroso, riparato e convalidato tramite `jsonrepair`, per generare al massimo 1-2 quesiti tecnici mirati e arricchire il prompt con le scelte dell'utente prima della scomposizione in milestone.

---

### 3.7. Browser Preview & Local App Launcher
* **Moduli:** [`agentToolExecutorService.ts`](../electron/core/application/agentToolExecutorService.ts), [`ollamaToolSchemaCatalog.ts`](../electron/core/domain/agent/ollamaToolSchemaCatalog.ts)
* **Motivazione Tecnica:** Gli agenti di sviluppo locale non devono avviare server di sviluppo bloccanti a ciclo infinito (`run_command npm run dev`), ma devono consentire all'utente di visionare immediatamente le pagine web e le SPA statiche create nel loro browser predefinito.
* **Soluzione Implementata:** Tool deterministico `open_in_browser` validato da `validatePathSafety`, integrato con le API native sicure di Electron (`electron.shell.openPath` per file HTML locali e `electron.shell.openExternal` per URL HTTP/HTTPS).

### 3.8. Resilient SLM Log Diagnostics & Native Node.js Fallback Scanner
* **Moduli:** [`sidecarSlmBridgeService.ts`](../electron/core/application/sidecarSlmBridgeService.ts), [`log_analyzer.py`](../sidecar/domain/log_analyzer.py), [`SlmDiagnosticsPanel.tsx`](../src/components/coding/SlmDiagnosticsPanel.tsx)
* **Motivazione Tecnica:** Durante l'esecuzione di carichi pesanti su hardware locale o in caso di crash/riavvio del runtime Python, la diagnostica di sistema non deve mai andare offline o bloccare l'interfaccia utente.
* **Soluzione Implementata:** Architettura a doppio scanner con fallback nativo: se l'endpoint REST del sidecar (`/agent/logs/analyze`) non risponde, il servizio Electron Main esegue una scansione in Node.js ad alte prestazioni con buffering di 500 righe per file su tutti i percorsi standard di log (`.onlyrag/logs`, `%APPDATA%/onlyrag-v2/logs`, `%LOCALAPPDATA%/OnlyRagV2/logs`, directory temporanee di sistema), correlando anomalie e fornendo suggerimenti correttivi immediati (`remediation`).

---

## 4. Mappatura delle Sostituzioni (Refactoring da Logiche Artigianali a Librerie Standard)

| Ambito | Precedente Soluzione Artigianale / Hardcoded | Sostituzione con Libreria Standard Universale | Beneficio Architetturale |
| :--- | :--- | :--- | :--- |
| **Normalizzazione Testo OCR** | Regex con sostituzioni hardcoded di specifici brand e parole | **`unicodedata.normalize('NFKC')`** + **`ftfy.fix_text()`** + **`SymSpell`** / **`wordfreq`** | Funziona universalmente su qualsiasi documento, marca, lingua e formato senza dizionari cablati. |
| **Preservazione Indirizzi Email / URL** | Stringhe fisse di domini e caselle nel prompt | Pattern regex standard RFC + token protection con placeholder `__PROT_ENT_N__` | Preserva al 100% qualsiasi indirizzo email, URL o codice alfanumerico esistente. |
| **Prompt di Traduzione** | Esempi hardcoded di singoli termini e contratti | Direttive semantiche universali sul registro formale/amministrativo | Riduzione del consumo di token e qualità di traduzione scalabile su ogni tipologia di testo. |
| **Riconoscimento Saluto Chat** | Substring check hardcoded (`'local AI RAG Assistant'`) | Identificazione strutturale univoca (`m.id === '1' && m.sender === 'bot'`) | Indipendente dalla lingua o dal testo personalizzato del saluto iniziale. |
| **Stima Token del Contesto** | Divisione euristica basata sul conteggio dei caratteri | **`gpt-tokenizer`** (`o200k_base` BPE) | Stima reale dei token coerente con l'architettura dei moderni LLM. |
| **Stima Dimensioni Modelli** | Regex e branching euristico manuale in `systemAppService.ts` | **`estimateModelWeightGB`** (`hardwareRecommendationEngine.ts` + catalogo GGUF) | Calcolo unificato e accurato dei pesi e spazio su disco per download ed esecuzione. |
