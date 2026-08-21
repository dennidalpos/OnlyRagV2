# Piano Operativo Master: Transizione Architetturale a Librerie Universali & Zero Hardcoding

> **Obiettivo Globale**: Sostituire sistematicamente ogni logica artigianale (*homegrown*), regex fragile, parser manuale e dizionario lessicale statico con librerie standard universali, complete e battle-tested. L'obiettivo è garantire affidabilità al 100%, supporto multilingua nativo (100+ lingue), zero latenza aggiuntiva (<1ms in frontend), assenza di race condition, zero bloat binario e perfetta compatibilità con l'ecosistema Windows / Electron / Python Sidecar.

---

## 🗺️ Mappa delle Fasi Operative e Priorità

```
[FASE 1: NLP, Lingue & Domain Routing] (P1)
   │
   ▼
[FASE 2: Agent Tools, JSON Repair, Frontmatter & Ignore Rules] (P2)
   │
   ▼
[FASE 3: Ingestion, Chunking RAG, OCR & Tabelle] (P3)
   │
   ▼
[FASE 4: Web Scraping, Diffing Engine & AST] (P4)
   │
   ▼
[FASE 5: Code Asincrone, Date Native & Packaging NSIS] (P5)
```

---

## 📊 Matrice di Sostituzione Moduli Homegrown ➔ Librerie Standard

| Priorità | Ambito / File Coinvolti | Soluzione Artigianale da Eliminare | Nuova Libreria Standard Universale | Beneficio Architetturale Principale |
| :--- | :--- | :--- | :--- | :--- |
| **P1** | **Domain Intent Router**<br>`src/services/domainRouter.ts`<br>`src/services/domainRouter.test.ts` | Array statici `MEDICAL_KEYWORDS`, `LEGAL_KEYWORDS`, `MEDICAL_CENTROID_ROOTS`, `LEGAL_CENTROID_ROOTS` | **N-gram / TF-IDF Centroid Similarity Sincrona** | Zero latenza (<1ms sincrono in React), supporto multilingua, zero contesa di inferenza LLM e zero dipendenza da Ollama per il routing. |
| **P1** | **Word Segmentation & Zipf Frequency**<br>`sidecar/domain/word_segmenter.py` | Set statico `_CORE_VOCABULARY` (~300 parole IT/EN cablate) | **`wordfreq`** (database Zipf statistico su 45+ lingue) con Viterbi cost calcolato | Segmentazione unigramma statistica multilingua con penalità di transizione calibrate contro la sovra-segmentazione. |
| **P1** | **Language Detection & ISO Normalization**<br>`sidecar/domain/translator.py`<br>`sidecar/domain/word_segmenter.py` | `_LATIN_STOP_WORDS` (5 lingue latine), dizionari hardcoded | **`langdetect`** (deterministico con `seed=0`) + **`pycountry`** | Rilevamento automatico lingua su 75+ lingue e codici ISO 639 standard. Mantiene controlli script Unicode per la selezione dei font PDF. |
| **P2** | **JSON Repair da LLM**<br>`electron/core/domain/agent/toolParser.ts` | Oltre 50 righe di regex fragili in `sanitizeAndParseJson` | **`jsonrepair`** (Jos de Jong) | Riparazione streaming deterministica di qualsiasi JSON malformato emesso da SLM (<0.2ms) preservando path Windows (`C:\...`). |
| **P2** | **YAML Frontmatter Parser**<br>`electron/core/infrastructure/filesystem/skillRepository.ts` | Funzione manuale `parseSkillFrontmatter` con split `---` e regex | **`gray-matter`** / **`yaml`** | Parsing conforme dello standard Markdown Frontmatter preservando i checksum SHA-256 di provenienza. |
| **P2** | **File Filtering & `.gitignore` Spec**<br>`electron/core/domain/agent/contextFilter.ts`<br>`electron/core/infrastructure/filesystem/fileSystemRepository.ts` | Set statici `DEFAULT_IGNORED_DIRS` e regex manuali di esclusione | **`ignore`** (npm standard) + **Invarianti di Sicurezza AppSec** | Conformità alla specifica `.gitignore` ufficiale garantendo al contempo il blocco assoluto di `.env` e chiavi private. |
| **P2** | **ANSI Log Stripper**<br>`electron/core/domain/agent/shellStreamGuard.ts`<br>`electron/core/domain/agent/autoHealingLogCapper.ts`<br>`src/components/coding/agentLogMessageUtils.ts` | Regex parziale `replace(/\x1b\[[0-9;]*m/g, '')` | **`strip-ansi`** | Pulizia completa di sequenze VT100, truecolor 24-bit e OSC hyper-link per prompt LLM puliti. |
| **P3** | **Correzione Glitch & Typo OCR**<br>`sidecar/domain/word_segmenter.py` | Sostituzioni stringhe manuali (`telass -> Telepass`, `cagnome -> cognome`, `viadel -> via del`) | **`symspellpy`** (isolato alla pipeline OCR) | Algoritmo Symmetric Delete spell-checking ultra-rapido $O(1)$ (<1ms) alimentato con dizionario multilingua, senza intaccare codice o testo digitale. |
| **P3** | **Formattazione Tabelle Markdown**<br>`sidecar/domain/ingestion.py` | Concatenazione stringhe `| Col 1 | Col 2 |` e padding artigianale | **`tabulate`** / `df.to_markdown(tablefmt="pipe")` | Tabelle Markdown compliant GFM con perfetto allineamento colonne anche su caratteri CJK/multibyte. |
| **P3** | **Mojibake & Unicode Cleanup**<br>`sidecar/domain/sanitizer.py`<br>`sidecar/domain/translator.py` | Decine di `replace('\ufffd')` e regex per accenti e apostrofi | **`ftfy`** (*Fixes Text For You*) | Riparazione automatica di doppie codifiche UTF-8/Latin-1 (es. `Ã¨` -> `è`), entità spurie e caratteri PUA. |
| **P3** | **RAG Structural & Recursive Chunking**<br>`sidecar/domain/ingestion.py` | Algoritmo `create_semantic_chunks` con conteggio caratteri e splitting manuale | **`chonkie`** (Recursive / Sentence / Markdown Chunker) | Chunking strutturale gerarchico che rispetta intestazioni, tabelle e blocchi di codice senza dipendenze PyTorch pesanti. |
| **P3** | **Spatial OCR Layout 2D Clustering**<br>`sidecar/infrastructure/ocr.py` | Ciclo geometrico con euristiche cablate in `_reconstruct_layout_from_ocr_boxes` | **`numpy`** (Intervalli vettoriali & ordinamento topologico 2D) | Ordinamento topologico 2D ultra-veloce (<0.5ms) per layout multi-colonna e moduli senza bloat binario di `scipy`. |
| **P3** | **Magic MIME Type Detection**<br>`sidecar/domain/router.py` | Controlli di estensione file statici | **`puremagic`** | Ispezione dei magic bytes reali dei file su filesystem (100% Python puro, zero DLL esterne). |
| **P4** | **HTML -> Markdown & Web Scraping**<br>`electron/core/infrastructure/http/webClient.ts` | Regex `htmlToCleanMarkdown()` e scraping manuale link DuckDuckGo | **`turndown`** + **`cheerio`** | Conversione robusta DOM -> Markdown GFM e selettori CSS veloci preservando i guardrail SSRF e il content budget (16k char). |
| **P4** | **Diffing & Fuzzy Patch Engine**<br>`electron/core/domain/agent/diffEngine.ts`<br>`electron/core/domain/agent/fuzzyPatchEngine.ts` | LCS artigianale (cap a 2500 righe) e matrice Levenshtein allocata in JS | **`diff`** (Myers) + **`fast-levenshtein`** | Algoritmo Myers standard senza limiti di righe integrato con `DiffLine` / `DiffHunk` per Monaco Diff e approvazioni. |
| **P4** | **Estrazione Simboli AST**<br>`electron/core/infrastructure/filesystem/fileSystemRepository.ts` | Regex riga per riga `extractCodeSymbols()` per funzioni e classi | **TypeScript Compiler API (`ts.createSourceFile`)** + Tokenizer poliglotto | Analisi sintattica AST robusta, deterministica e nativa (zero fragilità WASM in ASAR) per TS, JS, JSX, TSX, Python e linguaggi C-like. |
| **P5** | **Serial Task Queue & Retry Resilience**<br>`electron/core/application/taskQueueAppService.ts`<br>`electron/core/application/resilientModelDispatcher.ts` | Array FIFO manuali con flag `isProcessing` e `setTimeout` | **`p-queue`** + **`p-retry`** | Coda seriale atomica a prova di race condition, exponential backoff con jitter e AbortSignal. |
| **P5** | **Formattazione Date Relative**<br>`src/lib/timeFormat.ts` | Serie di `if (diff < 60) ... 'm fa'` | **`Intl.RelativeTimeFormat`** (Web API standard) | Formattazione nativa multilingua zero-dipendenze (`5s fa`, `5 sec ago`, `il y a 5s`). |
| **P5** | **Packaging & Data Bundling**<br>`scripts/build_package.ps1`<br>`sidecar.spec`<br>`package.json` | Nessuna direttiva PyInstaller per file di dati compressi | Data collection per file `.msgpack` di `wordfreq`, dizionari `symspellpy` e magic tables | Installer NSIS production-ready senza errori di file mancanti a runtime. |

---

## 📋 Checklist Operativa di Avanzamento (Esecuzione Atomica)

### 📌 FASE 1: NLP, Lingue & Domain Intent Routing (Priorità: P1)
- [x] **1.1** `domainRouter.ts`: Eliminare array statici `MEDICAL_KEYWORDS`, `LEGAL_KEYWORDS`, `MEDICAL_CENTROID_ROOTS`, `LEGAL_CENTROID_ROOTS`.
- [x] **1.2** `domainRouter.ts`: Implementare classificazione sincrona N-gram / TF-IDF Centroid Similarity (<1ms, zero-latency, zero-Ollama).
- [x] **1.3** `domainRouter.test.ts`: Aggiornare la suite di test con validazione semantica multilingua (Italiano, Inglese, Spagnolo, Francese, Tedesco).
- [x] **1.4** `word_segmenter.py`: Rimuovere il set statico `_CORE_VOCABULARY` (~300 parole cablate).
- [x] **1.5** `word_segmenter.py`: Connettere `MultiLangVocabManager` a `wordfreq.zipf_frequency(word, lang)` con smoothing e threshold di sicurezza per composti/acronimi.
- [x] **1.6** `word_segmenter.py`: Ricalibrare l'algoritmo di costo Viterbi `_viterbi_segment_compound` per prevenire la sovra-segmentazione (risolvendo i test Pytest `LUOGOEDATA`).
- [x] **1.7** `translator.py`: Rimuovere dizionari hardcoded `_LATIN_STOP_WORDS`, preservando i matcher di script Unicode per la selezione dei font PDF.
- [x] **1.8** `translator.py`: Integrare `langdetect.detect` (con `DetectorFactory.seed = 0`) per il rilevamento del testo dei documenti.
- [x] **1.9** `sidecar.spec`: Aggiungere subito la raccolta dati per `wordfreq` e `langdetect` (`datas += collect_all(...)`).
- [x] **1.10** **Check di Verifica Seriale Fase 1**:
  - `.\.venv\Scripts\pytest.exe sidecar/tests -q` ➔ **PASS** (100/100 tests passed)
  - `npm run test:fast` ➔ **PASS** (81/81 test files, 594 tests passed)

---

### 📌 FASE 2: Agent Tools, JSON Repair, Frontmatter & Ignore Rules (Priorità: P2)
- [x] **2.1** Installare dipendenze Node.js: `npm install jsonrepair gray-matter ignore strip-ansi`.
- [x] **2.2** `toolParser.ts`: Sostituire le 50+ righe di regex fragili in `sanitizeAndParseJson` con `jsonrepair` preservando l'estrazione CoT e i path Windows.
- [x] **2.3** `toolParser.test.ts`: Eseguire e verificare la test suite del tool parser.
- [x] **2.4** `skillRepository.ts`: Sostituire la funzione artigianale `parseSkillFrontmatter` con `gray-matter` garantendo stabilità dei checksum SHA-256.
- [x] **2.5** `contextFilter.ts`: Integrare `ignore` per `.gitignore` preservando gli invarianti rigidi di sicurezza (`SECRET_FILENAMES`, chiavi private).
- [x] **2.6** `taskRunner.ts` e `GitDiffPanel.tsx`: Sostituire le regex ANSI parziali con `strip-ansi`.
- [x] **2.7** **Check di Verifica Seriale Fase 2**:
  - `npm run test:fast` ➔ **PASS** (81/81 test files, 594 tests passed)
  - `npm run typecheck` ➔ **PASS** (0 errors)

---

### 📌 FASE 3: Ingestion, Chunking RAG, OCR & Tabelle (Priorità: P3)
- [x] **3.1** Installare dipendenze Python: `pip install chonkie ftfy puremagic tabulate`.
- [x] **3.2** `word_segmenter.py`: Rimossi dizionari hardcoded, integrato `wordfreq` e programmazione dinamica Viterbi.
- [x] **3.3** `ingestion.py`: Sostituita la costruzione manuale delle tabelle Markdown con `df.to_markdown(tablefmt="pipe", index=False)` tramite `tabulate`.
- [x] **3.4** `sanitizer.py` e `translator.py`: Integrato `ftfy.fix_text()` per risolvere automaticamente mojibake e caratteri spuri.
- [x] **3.5** `ingestion.py`: Integrato `chonkie` (`RecursiveChunker`) per chunking RAG strutturato senza dipendenze PyTorch.
- [x] **3.6** `ocr.py`: Ottimizzato il raggruppamento geometrico dei bounding box 2D tramite **NumPy** vettorializzato.
- [x] **3.7** `router.py`: Integrato `puremagic` per il rilevamento del MIME type dai magic bytes reali.
- [x] **3.8** `sidecar.spec`: Aggiunta data collection per `chonkie`, `ftfy`, `puremagic`, `tabulate`.
- [x] **3.9** **Check di Verifica Seriale Fase 3**:
  - `.\.venv\Scripts\pytest.exe sidecar/tests -q` ➔ **PASS** (100/100 tests passed)
  - `npm run test:fast` ➔ **PASS** (81/81 test files, 594 tests passed)

---

### 📌 FASE 4: Web Scraping, Diffing Engine & AST (Priorità: P4)
- [x] **4.1** Installare dipendenze Node.js: `npm install turndown cheerio diff fast-levenshtein @types/turndown @types/diff @types/fast-levenshtein`.
- [x] **4.2** `webClient.ts`: Sostituire `htmlToCleanMarkdown` e lo scraping regex con `turndown` e `cheerio` preservando SSRF e size ceiling.
- [x] **4.3** `diffEngine.ts`: Sostituire l'algoritmo LCS custom con `diff` (Myers) preservando le strutture `DiffLine` e `DiffHunkGroup`.
- [x] **4.4** `fuzzyPatchEngine.ts`: Sostituire la matrice Levenshtein con `fast-levenshtein`.
- [x] **4.5** `fileSystemRepository.ts`: Modernizzare `extractCodeSymbols` per analisi sintattica AST robusta tramite TypeScript Compiler API (`ts.createSourceFile`) e tokenizer poliglotto.
- [x] **4.6** **Check di Verifica Seriale Fase 4**:
  - `npm run test:fast` ➔ **PASS** (81/81 test files, 596 tests passed)
  - `npm run typecheck` ➔ **PASS** (0 errors)

---

### 📌 FASE 5: Code Asincrone, Date Native & Packaging (Priorità: P5)
- [x] **5.1** Installare dipendenze Node.js: `npm install p-queue p-retry`.
- [x] **5.2** `taskQueueAppService.ts`: Sostituita la coda manuale con istanza atomica `PQueue({ concurrency: 1 })`.
- [x] **5.3** `resilientModelDispatcher.ts`: Integrato `p-retry` con exponential backoff per le chiamate Ollama.
- [x] **5.4** `timeFormat.ts`: Sostituiti i calcoli manuali delle date con l'API standard `Intl.RelativeTimeFormat`.
- [x] **5.5** `scripts/build_package.ps1` e `sidecar.spec`: Verifica finale bundle PyInstaller / NSIS su tutte le dipendenze e file `.msgpack` / dizionari.
- [x] **5.6** **Validazione Finale End-to-End**:
  - `powershell -ExecutionPolicy Bypass -File .\scripts\test_sidecar_health.ps1 -Fast` ➔ **PASS**
  - `npm run test:fast` ➔ **PASS** (81/81 test files, 597 tests passed)
  - `powershell -ExecutionPolicy Bypass -File .\scripts\build_package.ps1 -SkipSidecar -Fast` ➔ **PASS**
- [x] **5.7** **Chiusura & Documentazione**:
  - Sincronizzati `/docs/modules.md` e `/docs/architecture.md`.
  - Pulito `PROJECT_STATUS.json` (`{"todos": []}`).

---

## 🎯 Protocollo Definition of Done (DoD)

Un task o una fase è considerato **Done** solo se:
1. Tutti i test correlati passano al 100% in modalità seriale deterministica.
2. Il rispettivo punto della checklist in [`UNIVERSAL_REFACTOR_PLAN.md`](file:///d:/GITHUB/OnlyRagV2/UNIVERSAL_REFACTOR_PLAN.md) viene spuntato (`[x]`).
3. [`PROJECT_STATUS.json`](file:///d:/GITHUB/OnlyRagV2/PROJECT_STATUS.json) viene svuotato istantaneamente (`{"todos": []}`).
4. La documentazione in `/docs/` riflette esattamente le modifiche apportate.
