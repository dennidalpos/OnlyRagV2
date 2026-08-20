# Piano Operativo Master: Transizione Architetturale a Librerie Universali & Zero Hardcoding

> **Obiettivo Globale**: Sostituire sistematicamente ogni logica artigianale (*homegrown*), regex fragile, parser manuale e dizionario lessicale statico con librerie standard universali, complete e battle-tested. L'obiettivo è garantire affidabilità al 100%, supporto multilingua nativo (100+ lingue), zero latenza aggiuntiva, assenza di race condition e perfetta compatibilità con l'ecosistema Windows / Electron / Python Sidecar.

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
| **P1** | **Domain Intent Router**<br>`src/services/domainRouter.ts`<br>`src/services/domainRouter.test.ts` | Array statici `MEDICAL_KEYWORDS`, `LEGAL_KEYWORDS`, `MEDICAL_CENTROID_ROOTS`, `LEGAL_CENTROID_ROOTS` | **Cosine Similarity su Centroidi Semantici Vettoriali (Opzione B)** | Zero latenza (<5ms), supporto nativo per 100+ lingue, zero contesa di inferenza LLM. |
| **P1** | **Word Segmentation & Zipf Frequency**<br>`sidecar/domain/word_segmenter.py` | Set statico `_CORE_VOCABULARY` (~300 parole IT/EN cablate) | **`wordfreq`** (database Zipf statistico su 45+ lingue) | Segmentazione unigramma Viterbi basata su frequenze corpus reali multilingua. |
| **P1** | **Language Detection & ISO Normalization**<br>`sidecar/domain/translator.py`<br>`sidecar/domain/word_segmenter.py` | `_LATIN_STOP_WORDS` (5 lingue latine), `_LANG_PATTERNS` (regex script), `_LANG_CODE_MAP` (dizionario 20 chiavi) | **`langdetect`** / **`lingua-language-detector`** + **`pycountry`** | Rilevamento automatico lingua su 75+ lingue (anche testi brevi) e codici ISO 639 standard. |
| **P2** | **JSON Repair da LLM**<br>`electron/core/domain/agent/toolParser.ts` | Oltre 50 righe di regex fragili in `sanitizeAndParseJson` | **`jsonrepair`** (Jos de Jong) | Riparazione streaming deterministica di qualsiasi JSON malformato emesso da SLM (<0.2ms). |
| **P2** | **YAML Frontmatter Parser**<br>`electron/core/infrastructure/filesystem/skillRepository.ts` | Funzione manuale `parseSkillFrontmatter` con split `---` e regex | **`gray-matter`** / **`yaml`** | Parsing conforme dello standard Markdown Frontmatter (liste annidate, tipi nativi, commenti). |
| **P2** | **File Filtering & `.gitignore` Spec**<br>`electron/core/domain/agent/contextFilter.ts`<br>`electron/core/infrastructure/filesystem/fileSystemRepository.ts` | Set statici `DEFAULT_IGNORED_DIRS` e regex manuali di esclusione | **`ignore`** (npm standard) | Conformità esatta alla specifica `.gitignore` ufficiale (glob `**`, negazioni `!`, path relativi). |
| **P2** | **ANSI Log Stripper**<br>`electron/core/domain/agent/shellStreamGuard.ts`<br>`electron/core/domain/agent/autoHealingLogCapper.ts`<br>`src/components/coding/agentLogMessageUtils.ts` | Regex parziale `replace(/\x1b\[[0-9;]*m/g, '')` | **`strip-ansi`** | Pulizia completa di sequenze VT100, truecolor 24-bit e OSC hyper-link per prompt LLM puliti. |
| **P3** | **Correzione Glitch & Typo OCR**<br>`sidecar/domain/word_segmenter.py` | Sostituzioni stringhe manuali (`telass -> Telepass`, `cagnome -> cognome`, `viadel -> via del`) | **`symspellpy`** | Algoritmo Symmetric Delete spell-checking ultra-rapido O(1) (<1ms) alimentato con `wordfreq`. |
| **P3** | **Formattazione Tabelle Markdown**<br>`sidecar/domain/ingestion.py` | Concatenazione stringhe `| Col 1 | Col 2 |` e padding artigianale | **`tabulate`** / `df.to_markdown(tablefmt="pipe")` | Tabelle Markdown compliant GFM con perfetto allineamento colonne anche su caratteri CJK/multibyte. |
| **P3** | **Mojibake & Unicode Cleanup**<br>`sidecar/domain/sanitizer.py`<br>`sidecar/domain/translator.py` | Decine di `replace('\ufffd')` e regex per accenti e apostrofi | **`ftfy`** (*Fixes Text For You*) | Riparazione automatica di doppie codifiche UTF-8/Latin-1 (es. `Ã¨` -> `è`), entità spurie e caratteri PUA. |
| **P3** | **RAG Semantic Chunking**<br>`sidecar/domain/ingestion.py` | Algoritmo `create_semantic_chunks` con conteggio caratteri e splitting manuale | **`chonkie`** (Token/Sentence/Semantic Chunker) | Chunking semantico nativo per RAG che rispetta confini di frasi, tabelle e blocchi di codice. |
| **P3** | **Spatial OCR Layout Clustering**<br>`sidecar/infrastructure/ocr.py` | Ciclo geometrico con euristiche cablate in `_reconstruct_layout_from_ocr_boxes` | **`scipy.spatial`** (`cKDTree`) / `shapely` | Ordinamento topologico bidimensionale 2D per lettura multi-colonna e moduli senza errori di riga. |
| **P3** | **Magic MIME Type Detection**<br>`sidecar/domain/router.py` | Controlli di estensione file statici | **`puremagic`** | Ispezione dei magic bytes reali dei file su filesystem (100% Python puro, zero DLL esterne). |
| **P4** | **HTML -> Markdown & Web Scraping**<br>`electron/core/infrastructure/http/webClient.ts` | Regex `htmlToCleanMarkdown()` e scraping manuale link DuckDuckGo | **`turndown`** + **`cheerio`** | Conversione robusta DOM -> Markdown GFM e selettori CSS veloci per il web search dell'Agent. |
| **P4** | **Diffing & Fuzzy Patch Engine**<br>`electron/core/domain/agent/diffEngine.ts`<br>`electron/core/domain/agent/fuzzyPatchEngine.ts` | LCS artigianale (cap a 2500 righe) e matrice Levenshtein allocata in JS | **`diff`** (Myers) + **`fast-levenshtein`** / `diff-match-patch` | Algoritmo Myers standard senza limiti di righe e Bitap matching ad alta efficienza per patch. |
| **P4** | **Estrazione Simboli AST**<br>`electron/core/infrastructure/filesystem/fileSystemRepository.ts` | Regex riga per riga `extractCodeSymbols()` per funzioni e classi | **`web-tree-sitter`** (WASM) | Analisi sintattica AST reale per TypeScript, Python, Go, Rust, C++ (supporta firme multilinea e decoratori). |
| **P5** | **Serial Task Queue & Retry Resilience**<br>`electron/core/application/taskQueueAppService.ts`<br>`electron/core/application/resilientModelDispatcher.ts` | Array FIFO manuali con flag `isProcessing` e `setTimeout` | **`p-queue`** + **`p-retry`** | Coda seriale atomica a prova di race condition, exponential backoff con jitter e AbortSignal. |
| **P5** | **Formattazione Date Relative**<br>`src/lib/timeFormat.ts` | Serie di `if (diff < 60) ... 'm fa'` | **`Intl.RelativeTimeFormat`** (Web API standard) | Formattazione nativa multilingua zero-dipendenze (`5s fa`, `5 sec ago`, `il y a 5s`). |
| **P5** | **Packaging & Data Bundling**<br>`scripts/build_package.ps1`<br>`package.json` | Nessuna direttiva PyInstaller per file di dati compressi | Data collection per file `.msgpack` di `wordfreq` e dizionari `symspellpy` | Installer NSIS production-ready senza errori di file mancanti a runtime. |

---

## 📋 Checklist Operativa di Avanzamento (Esecuzione Atomica)

### 📌 FASE 1: NLP, Lingue & Domain Intent Routing (Priorità: P1)
- [ ] **1.1** `domainRouter.ts`: Eliminare array statici `MEDICAL_KEYWORDS`, `LEGAL_KEYWORDS`, `MEDICAL_CENTROID_ROOTS`, `LEGAL_CENTROID_ROOTS`.
- [ ] **1.2** `domainRouter.ts`: Implementare classificazione con Cosine Similarity su Centroidi Semantici Vettoriali pre-calcolati (Opzione B, zero latenza).
- [ ] **1.3** `domainRouter.test.ts`: Aggiornare la suite di test con validazione semantica multilingua (Italiano, Inglese, Spagnolo, Francese, Tedesco).
- [ ] **1.4** `word_segmenter.py`: Rimuovere il set statico `_CORE_VOCABULARY` (~300 parole cablate).
- [ ] **1.5** `word_segmenter.py`: Connettere `MultiLangVocabManager` a `wordfreq.zipf_frequency(word, lang)` su tutte le lingue supportate.
- [ ] **1.6** `word_segmenter.py`: Ricalibrare l'algoritmo di costo Viterbi `_viterbi_segment_compound` basandosi puramente sui valori Zipf statistici.
- [ ] **1.7** `translator.py`: Rimuovere dizionari hardcoded `_LATIN_STOP_WORDS` e regex `_LANG_PATTERNS`.
- [ ] **1.8** `translator.py`: Integrare `langdetect.detect` per il rilevamento universale della lingua del documento.
- [ ] **1.9** **Check di Verifica Seriale Fase 1**:
  - `powershell -ExecutionPolicy Bypass -File .\scripts\test_sidecar_health.ps1 -Fast` ➔ **PASS**
  - `npm test -- --run` ➔ **PASS**

---

### 📌 FASE 2: Agent Tools, JSON Repair, Frontmatter & Ignore Rules (Priorità: P2)
- [ ] **2.1** Installare dipendenze Node.js: `npm install jsonrepair gray-matter ignore strip-ansi`.
- [ ] **2.2** `toolParser.ts`: Sostituire le 50+ righe di regex fragili in `sanitizeAndParseJson` con la libreria `jsonrepair`.
- [ ] **2.3** `toolParser.test.ts`: Eseguire e verificare la test suite del tool parser.
- [ ] **2.4** `skillRepository.ts`: Sostituire la funzione artigianale `parseSkillFrontmatter` con `gray-matter`.
- [ ] **2.5** `contextFilter.ts`: Sostituire i set hardcoded di esclusione con l'engine conforme `ignore` per rispettare `.gitignore`.
- [ ] **2.6** `shellStreamGuard.ts` e `autoHealingLogCapper.ts`: Sostituire le regex ANSI parziali con `strip-ansi`.
- [ ] **2.7** **Check di Verifica Seriale Fase 2**:
  - `npm test -- --run` ➔ **PASS**
  - `npm run typecheck` ➔ **PASS**

---

### 📌 FASE 3: Ingestion, Chunking RAG, OCR & Tabelle (Priorità: P3)
- [ ] **3.1** `word_segmenter.py`: Rimuovere le sostituzioni stringhe hardcoded e integrare `symspellpy` per correzione typo/glitch OCR $O(1)$.
- [ ] **3.2** `ingestion.py`: Sostituire la costruzione manuale delle tabelle Markdown con `df.to_markdown(tablefmt="pipe", index=False)` tramite `tabulate`.
- [ ] **3.3** `sanitizer.py` e `translator.py`: Integrare `ftfy.fix_text()` per risolvere automaticamente mojibake e caratteri di controllo PDF.
- [ ] **3.4** `ingestion.py`: Integrare `chonkie` per chunking semantico e ricorsivo su Markdown.
- [ ] **3.5** `ocr.py`: Ottimizzare il raggruppamento geometrico dei bounding box 2D tramite `scipy.spatial`.
- [ ] **3.6** `router.py`: Integrare `puremagic` per il rilevamento del MIME type dai magic bytes reali.
- [ ] **3.7** **Check di Verifica Seriale Fase 3**:
  - `powershell -ExecutionPolicy Bypass -File .\scripts\test_sidecar_health.ps1 -Fast` ➔ **PASS**

---

### 📌 FASE 4: Web Scraping, Diffing Engine & AST (Priorità: P4)
- [ ] **4.1** Installare dipendenze Node.js: `npm install turndown cheerio diff fast-levenshtein web-tree-sitter`.
- [ ] **4.2** `webClient.ts`: Sostituire `htmlToCleanMarkdown` e lo scraping regex con `turndown` e `cheerio`.
- [ ] **4.3** `diffEngine.ts`: Sostituire l'algoritmo LCS custom con `diff` (Myers) preservando le strutture `DiffLine` e `DiffHunkGroup`.
- [ ] **4.4** `fuzzyPatchEngine.ts`: Sostituire la matrice Levenshtein con `fast-levenshtein` / `diff-match-patch`.
- [ ] **4.5** `fileSystemRepository.ts`: Modernizzare `extractCodeSymbols` per analisi sintattica AST robusta tramite `web-tree-sitter`.
- [ ] **4.6** **Check di Verifica Seriale Fase 4**:
  - `npm test -- --run` ➔ **PASS**

---

### 📌 FASE 5: Code Asincrone, Date Native & Packaging (Priorità: P5)
- [ ] **5.1** Installare dipendenze Node.js: `npm install p-queue p-retry`.
- [ ] **5.2** `taskQueueAppService.ts`: Sostituire la coda manuale con istanza atomica `PQueue({ concurrency: 1 })`.
- [ ] **5.3** `resilientModelDispatcher.ts`: Integrare `p-retry` con exponential backoff, jitter e AbortSignal per le chiamate Ollama.
- [ ] **5.4** `timeFormat.ts`: Sostituire i calcoli manuali delle date con l'API standard `Intl.RelativeTimeFormat`.
- [ ] **5.5** `scripts/build_package.ps1`: Configurare PyInstaller per raccogliere i dati binari compressi (`wordfreq/*.msgpack`, dizionari `symspellpy`).
- [ ] **5.6** **Validazione Finale End-to-End**:
  - `powershell -ExecutionPolicy Bypass -File .\scripts\test_sidecar_health.ps1 -Fast` ➔ **PASS**
  - `npm test -- --run` ➔ **PASS**
  - `powershell -ExecutionPolicy Bypass -File .\scripts\build_package.ps1` ➔ **PASS**
- [ ] **5.7** **Chiusura & Documentazione**:
  - Sincronizzare `/docs/modules.md` e `/docs/architecture.md`.
  - Pulire `PROJECT_STATUS.json` (`{"todos": []}`).

---

## 🎯 Protocollo Definition of Done (DoD)

Un task o una fase è considerato **Done** solo se:
1. Tutti i test correlati passano al 100% in modalità seriale deterministica.
2. Il rispettivo punto della checklist in [`UNIVERSAL_REFACTOR_PLAN.md`](file:///d:/GITHUB/OnlyRagV2/UNIVERSAL_REFACTOR_PLAN.md) viene spuntato (`[x]`).
3. [`PROJECT_STATUS.json`](file:///d:/GITHUB/OnlyRagV2/PROJECT_STATUS.json) viene svuotato istantaneamente (`{"todos": []}`).
4. La documentazione in `/docs/` riflette esattamente le modifiche apportate.
