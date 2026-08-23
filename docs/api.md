# Riferimento API & Contratti di Comunicazione — OnlyRag V2

OnlyRag V2 implementa due livelli di interfaccia:
1. **REST API (FastAPI Sidecar)** per l'elaborazione dei documenti, l'ingestione, l'export, la ricerca ibrida su LanceDB e l'orchestrazione SLM Agent Studio.
2. **IPC API (Electron Main/Renderer)** per l'esecuzione dei tool agentici, la diagnostica hardware, la gestione dei modelli Ollama e i canali SLM Agent Studio.

---

## 1. REST API — Python FastAPI Sidecar (`http://127.0.0.1:8000`)

### 1.1. Health Check
* **Endpoint:** `GET /health`
* **Descrizione:** Verifica lo stato operativo del sidecar, la connessione al database LanceDB e l'accelerazione GPU.
* **Risposta (200 OK):**
```json
{
  "status": "online",
  "engine": "FastAPI Python Sidecar + LanceDB OCR Engine V2",
  "version": "2.3.0",
  "vector_db": "LanceDB Embedded",
  "gpu": { "has_nvidia_gpu": true, "gpu_name": "RTX 4070", "vram_total_mb": 12288 },
  "documents_count": 12,
  "chunks_count": 340,
  "python_version": "3.11.x"
}
```

---

### 1.2. Ingestione Documentale
* **Endpoint:** `POST /ingest`
* **Content-Type:** `multipart/form-data`
* **Parametri:**
  * `file`: File binario (`PDF`, `DOCX`, `TXT`, `MD`, `PNG`, `JPG`).
  * `normalize_with_llm` *(opzionale, default: false)*: Attiva la normalizzazione del testo estratto pagina per pagina con modello LLM locale.
  * `normalization_model` *(opzionale, default: null / "llama3.2")*: Modello Ollama specifico da impiegare per la normalizzazione Markdown.
* **Risposta (200 OK):**
```json
{
  "id": "doc_a1b2c3d4",
  "filename": "Contratto_Fornitura.pdf",
  "file_size": 204800,
  "num_pages": 12,
  "num_chunks": 18,
  "extracted_markdown": "# Contratto di Fornitura...",
  "status": "indexed",
  "ingested_at": "2026-08-17T01:00:00Z"
}
```

---

### 1.3. Ingestione da Path (con Streaming)
* **`POST /ingest-path`** — Ingestione sincrona da percorso file locale.
  * **Corpo:** `{ "file_path": "C:/docs/report.pdf", "normalize_with_llm"?: false, "normalization_model"?: "llama3.2", "max_tabular_rows"?: 500, "max_excel_rows_per_sheet"?: 250, "max_excel_sheets"?: 20 }`.
  * **Risposta:** `IngestResponse` (`{ "id": "...", "filename": "...", "status": "indexed" | "indexed_fallback", "used_fallback_embeddings": boolean, ... }`).
* **`POST /ingest-path-stream`** — Ingestione con streaming NDJSON progressivo.
  * **Corpo:** `{ "file_path": "C:/docs/report.pdf", "normalize_with_llm"?: false, "normalization_model"?: "llama3.2", "max_tabular_rows"?: 500, "max_excel_rows_per_sheet"?: 250, "max_excel_sheets"?: 20 }`.
  * **Content-Type:** `application/x-ndjson`.
  * **Eventi:** `{ "type": "progress" | "done", "percent": 0-100, "step": "...", "data"?: IngestResponse }`.

---

### 1.4. Gestione Documenti Memorizzati
* **`GET /documents`**: Lista tutti i documenti indicizzati in LanceDB con metadati completi. Include sia `status: "indexed"` sia `status: "indexed_fallback"` (entrambi indicizzati e ricercabili) e restituisce `used_fallback_embeddings` per ciascun record, cosi' il renderer puo' segnalare la qualita' degradata degli embedding. Gli stati diversi da questi due (es. ingest fallito) restano esclusi.
* **`DELETE /documents/{doc_id}`**: Elimina atomicamente il documento e tutti i relativi chunk vettoriali.
* **`PUT /documents/{doc_id}`**: Aggiorna il contenuto Markdown e re-indicizza i chunk vettoriali. Corpo: `{ "markdown_content": "..." }`.
* **`POST /documents/{doc_id}/translate-inplace`**: Traduce il documento **in-place** su file system o verso una cartella target (`target_dir`), con salvataggio compresso ad alta efficienza (`deflate=True, garbage=4, clean=True`), separando nettamente il flusso di esportazione file su disco dalla base di conoscenza RAG (il campo `extracted_markdown` e i vettori LanceDB del documento originale rimangono inalterati nella lingua sorgente originale).
  * **Request Body:** `{ "source_lang": "Italian", "target_lang": "English", "model"?: "llama3.2", "backup_original"?: true, "target_dir"?: "C:\\path\\to\\folder" }`
  * **Risposta (200 OK):** stessa struttura di `IngestResponse` (§1.2), con il testo `extracted_markdown` originale preservato.
* **`POST /documents/{doc_id}/translate-inplace-stream`**: Streaming asincrono NDJSON del processo di traduzione con progresso pagina per pagina e fase per fase (`extracting_blocks`, `translating_blocks`, `reconstructing_layout`).
  * **Request Body:** identico a `POST /documents/{doc_id}/translate-inplace`.
  * **Content-Type Risposta:** `application/x-ndjson` con eventi `start`, `progress`, `done`, `error`.
  * **Pipeline per formato** (dispatch automatico su `file_type`, vedi [`translator.py`](../sidecar/domain/translator.py)):
    * `docx` — sostituzione diretta dei run testuali via `python-docx` (stile/font/tabelle invariati, cancellazione reale del testo originale nell'XML del run) con salvataggio sicuro in `target_dir` o `EXPORT_DIR`.
    * `pdf` (**fine-mode compresso con OpenCV e Collision Avoidance**) — per ogni pagina: redazione reale del testo originale (`page.add_redact_annot` + `apply_redactions()`) o inpainting OpenCV su scansioni, seguito dal reinserimento del testo tradotto nello stesso bounding box, con **auto-fit progressivo del font size**, **collision avoidance spaziale con R-Tree/bounding box limits** per evitare sovrapposizioni su blocchi sottostanti, **rilevamento lingua a blocchi (micro-detection)** per non ritradurre sezioni già nella lingua di destinazione, e **fallback di rendering garantito** (100% dei blocchi testuali mantenuti senza cadute di testo). Salvataggio finale compresso con deflating stream e garbage collection PyMuPDF. **Selezione font per lingua** (`_resolve_pdf_font_file`, match case-insensitive su `target_lang`): giapponese/coreano/cinese semplificato/cinese tradizionale usano il rispettivo font Noto Sans CJK imbarcato in `sidecar/assets/fonts/`; ogni altra lingua usa il fallback Noto Sans Latin/Cirillico/Greco.
    * Qualsiasi altro `file_type` → `400 Bad Request`.
  * **Codici di errore:** `400` (tipo file non supportato), `404` (documento non trovato o file originale non più presente su disco), `500` (errore imprevisto).

---

### 1.5. Ricerca Vettoriale Ibrida
* **Endpoint:** `POST /vector/search`
* **Content-Type:** `application/json`
* **Request Body:**
```json
{
  "query": "Quali sono le penali per recesso anticipato secondo art. 1341?",
  "top_k": 5,
  "embedding_model": "nomic-embed-text",
  "doc_ids": ["doc_a1b2c3d4"]
}
```
* **Risposta (200 OK):**
```json
[
  {
    "chunk_id": "doc_a1b2c3d4_chunk_3",
    "doc_id": "doc_a1b2c3d4",
    "doc_name": "Contratto_Fornitura.pdf",
    "section_header": "Art. 7 - Risoluzione e Penali",
    "text": "[Documento: Contratto_Fornitura.pdf | Sezione: Art. 7]\nIn caso di recesso anticipato...",
    "score": 0.942
  }
]
```

---

### 1.6. Ispezione Immagine (Vision OCR)
* **Endpoint:** `POST /inspect-image`
* **Request Body:**
```json
{
  "image_base64": "<base64_string>",
  "question": "Describe the diagram in detail.",
  "vision_model": "llama3.2-vision"
}
```
* **Risposta (200 OK):** `{ "status": "success", "analysis": "..." }`

---

### 1.7. Esportazione Documento Formattato
* **Endpoint:** `POST /export`
* **Content-Type:** `application/json`
* **Request Body:**
```json
{
  "markdown_content": "# Relazione Clinica\n\nTesto...",
  "export_format": "pdf"
}
```
* **Formati Supportati:** `pdf`, `md`, `docx`.
* **Risposta (200 OK):** File binario scaricabile con appropriato `Content-Disposition`.

---

### 1.8. Gestione Task & Pulizia
* **`POST /tasks/cancel?task_id={id}`**: Segnala la cancellazione di un task attivo. Risposta: `{ "status": "success", "message": "..." }`.
* **`POST /cleanup/temp`**: Rimuove tutti i file temporanei nella directory di export. Risposta: `{ "status": "success", "cleaned_files": 3 }`.

---

### 1.9. Sincronizzazione Vocabolari Multi-Lingua
* **`POST /vocab/sync`**: Esegue il controllo asincrono degli aggiornamenti dei vocabolari di lingua upstream (scaricati atomicamente in `%APPDATA%/onlyrag-v2/vocab/`). Risposta: `{ "status": "success" | "cached" | "offline", "updated_languages": [...], "message": "..." }`.
* **`GET /vocab/status`**: Restituisce lo stato delle lingue caricate in cache locale e la disponibilità della libreria `wordfreq`. Risposta: `{ "wordfreq_available": boolean, "cached_languages": [...], "cache_dir": "..." }`.

---

### 1.10. SLM Agent Studio — Diagnostica Log

> Lo stack di orchestrazione SLM duplicato (`POST /agent/orchestrate`, `slm_tool_registry`, macchina a stati di retry L1/L2/L3) è stato rimosso: era ridondante rispetto al loop agentico principale (`agent:start-task`, vedi §2.2), che è l'unico percorso di esecuzione tool realmente usato dall'app. Rimane solo l'endpoint di diagnostica log qui sotto, usato da `SlmDiagnosticsPanel.tsx`.

#### `POST /agent/logs/analyze`

Scansiona i file di log di OnlyRag V2 e restituisce un report strutturato di anomalie diagnostiche.

**Anomalie rilevate:**
- **`TRUNCATED_JSON`** — Tool call JSON troncata (risposta Ollama incompleta per limite token).
- **`CUDA_OOM`** / **`VRAM_THRASHING`** — Out-of-memory CUDA o thrashing VRAM (severity: `CRITICAL`).
- **`EMPTY_RESPONSE`** — Risposta vuota da Ollama (possibile VRAM saturation).
- **`GATEWAY_TIMEOUT`** — Timeout HTTP 504 nella comunicazione con Ollama.
- **`TOOL_LOOP`** — Stesso tool ripetuto ≥4 volte in una finestra di 30 righe (severity: `CRITICAL`).

**Request Body:**
```json
{
  "extra_paths": ["C:/custom/logs/"]
}
```

| Campo | Tipo | Default | Descrizione |
| :--- | :--- | :--- | :--- |
| `extra_paths` | `string[] \| null` | `null` | Percorsi aggiuntivi di directory da includere nella scansione. |

**Response Body (200 OK):**
```json
{
  "scanned_files": [
    "C:/Users/.../AppData/Local/OnlyRagV2/logs/sidecar.log",
    "C:/Users/.../AppData/Local/OnlyRagV2/logs/app.log"
  ],
  "total_lines_scanned": 1842,
  "anomalies": [
    {
      "anomaly_type": "CUDA_OOM",
      "severity": "CRITICAL",
      "log_file": "C:/Users/.../sidecar.log",
      "line_number": 34,
      "snippet": "[ERROR] CUDA out of memory. Tried to allocate 4.00 GiB",
      "count": 2
    },
    {
      "anomaly_type": "TOOL_LOOP",
      "severity": "CRITICAL",
      "log_file": "C:/Users/.../app.log",
      "line_number": 112,
      "snippet": "{\"tool_name\": \"list_dir\", \"arguments\": {}}",
      "count": 4
    }
  ],
  "has_critical": true,
  "summary": "Found 2 critical anomalies: CUDA_OOM (x2), TOOL_LOOP (x1)"
}
```

| Campo | Tipo | Descrizione |
| :--- | :--- | :--- |
| `scanned_files` | `string[]` | Lista completa dei file di log scansionati. |
| `total_lines_scanned` | `integer` | Numero totale di righe analizzate. |
| `anomalies` | `AnomalyRecord[]` | Lista ordinata di anomalie rilevate. Vuota se nessuna anomalia. |
| `has_critical` | `boolean` | `true` se almeno un'anomalia ha severity `CRITICAL`. |
| `summary` | `string` | Stringa leggibile con conteggio anomalie o `"No anomalies detected"`. |

**Codici di errore HTTP:**

| Codice | Causa |
| :--- | :--- |
| `200 OK` | Analisi completata (verificare `has_critical` per anomalie). |
| `500 Internal Server Error` | Errore imprevisto durante la scansione dei log. |

---

## 2. Electron IPC API (`window.electronAPI`)

Tutte le chiamate IPC sono rigorosamente tipizzate tramite TypeScript in `src/types/index.ts`. L'interfaccia completa è definita in `IElectronAPI`.

### 2.1. Canali Modelli Ollama (`ollama:*`)

| Canale IPC | Input | Output | Descrizione |
| :--- | :--- | :--- | :--- |
| `ollama:get-models` | `none` | `OllamaModel[]` | Elenco di tutti i modelli scaricati localmente. |
| `ollama:pull-model` | `{ modelName: string }` | `Stream Event (progress %)` | Download streaming del modello con percentuale e byte trasferiti. |
| `ollama:get-running-models`| `none` | `RunningModelInfo[]` | Modelli attualmente caricati nella VRAM/RAM (`/api/ps`). |
| `ollama:unload-model` | `{ modelName: string }` | `{ success: boolean }` | Evizione esplicita immediata (`keep_alive: 0`). |

---

### 2.2. Canali Agente di Sviluppo (`agent:*`) & Tool Set (27 Strumenti)

| Canale IPC | Input | Output | Descrizione |
| :--- | :--- | :--- | :--- |
| `agent:start-task` | `AgentTaskPayload` | `{ success: boolean; summary: string }` | Esecuzione di un turno agentico completo con Tool-Calling (27 strumenti), auto-healing e FSM mode gating. |
| `agent:cancel-task` | `taskId?: string` | `{ success: boolean; message?: string }` | Interruzione di un task specifico o di tutti i task attivi. |
| `agent:get-queue-status` | `none` | `TaskQueueStatus` | Stato corrente della coda task (running, queued, maxConcurrency). |
| `agent:set-max-concurrency` | `limit: number` | `{ success: boolean; maxConcurrency: number }` | Imposta il limite di task concorrenti (range: 1-8). |
| `agent:parse-tool-call` | `rawText: string` | `AgentToolCall \| null` | Parsing difensivo di una tool call grezza (4 stage: JSON, JSON-in-prose, regex, fallback). |
| `agent:clear-audit-log` | `none` | `boolean` | Azzera il log di audit delle azioni agente. |

#### Cronologia Sessioni — Canali IPC CRUD

Store filesystem unico (`sessionHistoryRepository`): `<workspace>/.onlyrag/sessions/session_history.json`, con fallback `~/.onlyrag_v2/sessions/session_history.json` per le sessioni standalone. Il renderer non persiste piu' nulla in `localStorage`.

| Canale IPC | `electronAPI` Method | Input | Output | Descrizione |
| :--- | :--- | :--- | :--- | :--- |
| `sessions:list` | `listCodingSessions(workspacePath?)` | `workspacePath?` | `CodingSession[]` | Sessioni del progetto, ordinate dalla piu' recente, con i relativi `ExecutedPrompt`. |
| `sessions:save` | `saveCodingSession(session)` | `CodingSession` | `CodingSession \| null` | Upsert della sessione. Normalizza i timestamp in ISO 8601 e deriva il titolo dal primo prompt eseguito. |
| `sessions:delete` | `deleteCodingSession(sessionId, workspacePath?)` | `sessionId`, `workspacePath?` | `boolean` | Elimina la sessione, il relativo `.onlyrag/sessions/.agent_state_*.json` e le sue voci nell'audit log. |
| `sessions:clear` | `clearCodingSessions(workspacePath?)` | `workspacePath?` | `boolean` | Svuota la cronologia del progetto e i relativi stati agente (azione "Svuota storico progetto" nella sezione Storico del Workspace Explorer). |
| `sessions:migrate-legacy` | `migrateLegacyCodingSessions(sessions)` | array grezzo da `localStorage` | `{ migrated: number }` | Import one-shot delle sessioni legacy (`onlyrag_coding_sessions_v2`); le sessioni gia' presenti su disco non vengono sovrascritte. |

**Tipi TypeScript (da `src/types/`):**
```typescript
interface ExecutedPrompt {
  id: string
  sessionId: string
  prompt: string
  startedAt: string            // ISO 8601
  completedAt?: string         // ISO 8601
  agentMode: 'plan' | 'ask' | 'agent'
  outcome: 'running' | 'success' | 'failed' | 'cancelled' | 'unknown'
  totalSteps: number
  filesTouched: number
  additions: number
  deletions: number
  summary?: string
}

// Storico piani della sessione (CodingSession.plans)
interface AgentPlan {
  id: string
  version: number
  prompt: string
  planText: string
  status: 'idle' | 'generating' | 'ready' | 'approved' | 'rejected'
  createdAt: string            // ISO 8601
  baseStepOffset?: number
  milestones?: PlanMilestone[]
}
```

#### Conferma Installazione Skill dall'Hub (`autoInstallHubSkills: 'prompt'`)

| Canale IPC | `electronAPI` Method | Direzione | Payload | Descrizione |
| :--- | :--- | :--- | :--- | :--- |
| `agent:skill-install-request` | `onAgentSkillInstallRequest(cb)` | main → renderer | `{ requestId, skillName, skillDescription, hubName, score }` | Richiesta di conferma emessa durante l'assemblaggio del prompt, prima di installare una skill scoperta su un hub. |
| `agent:skill-install-response` | `respondAgentSkillInstall(requestId, approved)` | renderer → main | `{ requestId, approved }` | Risposta dell'utente. In assenza di risposta entro 120s la richiesta si risolve come rifiutata. |

#### SLM Agent Studio — Canale IPC di Diagnostica

| Canale IPC | `electronAPI` Method | Input | Output | Descrizione |
| :--- | :--- | :--- | :--- | :--- |
| `agent:logs-analyze` | `agentLogsAnalyze(extraPaths?)` | `extraPaths?: string[]` | `SlmLogDiagnosticReport \| null` | Avvia la diagnostica anomalie sui log di sistema. Restituisce `null` se il sidecar non è raggiungibile. |

**Tipi TypeScript (da `src/types/index.ts`):**
```typescript
// Report da agent:logs-analyze
interface SlmLogDiagnosticReport {
  scanned_files: string[]
  total_lines_scanned: number
  anomalies: SlmAnomalyRecord[]
  has_critical: boolean
  summary: string
}
```

**React Hook di utilizzo:** `src/hooks/useSlmOrchestration.ts`
```typescript
const { analyzeLogs, isAnalyzingLogs, lastReport } = useSlmOrchestration()

// Analizza i log
const report = await analyzeLogs()
```

#### Plan Approval — Canali IPC dedicati

| Canale IPC | `electronAPI` Method | Input | Output | Descrizione |
| :--- | :--- | :--- | :--- | :--- |
| `agent:plan-generate` | `agentPlanGenerate(prompt, model, settings, pendingResidueMilestones?)` | prompt/model/settings + milestone residui opzionali | `{ planText: string; milestones: PlanMilestone[] }` | Genera un piano instradato attraverso le opzioni runtime del profilo hardware, parsato dal parser canonico `GoalDecompositionPlanner`. I milestone residui non verificati del piano precedente vengono inclusi come contesto di riconciliazione. |
| `agent:plan-parse-text` | `agentPlanParseText(planText)` | `planText: string` | `PlanMilestone[]` | Ri-parsa testo di piano (es. modificato manualmente) con lo stesso parser canonico usato in generazione. |
| `agent:get-plan-state` | `agentGetPlanState(sessionId, workspacePath?)` | `sessionId`, `workspacePath?` | `{ planMilestones: PlanMilestone[]; status?; stepCount } \| null` | Legge lo stato dei milestone persistito dal backend (`GoalDecompositionPlanner`, unica fonte di verità) per una sessione. |
| `agent:plan-seed` | `agentPlanSeed(sessionId, workspacePath, planMilestones, userTask?)` | `sessionId`, `workspacePath`, milestone approvati, `userTask?` | `boolean` | Inietta i milestone di un piano approvato nello stato di sessione persistito prima dell'avvio dell'esecuzione, cosicché il loop agentico li carichi come stato iniziale. |

#### Matrice Completa dei 27 Strumenti Agentici Supportati

| Tool Name | Aliases Supportati | Parametri Principali | Descrizione |
| :--- | :--- | :--- | :--- |
| `read_file` | `read`, `view_file`, `cat`, `open_file` | `filePath`, `startLine`, `endLine` | Lettura file con slicing opzionale di righe. |
| `extract_code_symbols` | `extract_symbols`, `code_symbols`, `list_symbols` | `filePath` | Estrazione AST/Regex di funzioni, classi e interfacce. |
| `write_file` | `write`, `create_file`, `save_file` | `filePath`, `content` | Scrittura file con creazione automatica cartelle padre. |
| `create_directory` | `mkdir`, `make_directory`, `create_folder` | `dirPath` | Creazione ricorsiva sicura di directory. |
| `copy_file` | `copy`, `cp`, `duplicate_file` | `sourcePath`, `targetPath` | Copia di file con tracciamento su journal transazionale. |
| `move_file` | `move`, `mv`, `rename`, `rename_file` | `sourcePath`, `targetPath` | Spostamento/rinomina di file con snapshot preventivo. |
| `replace_file_content` | `replace_chunk`, `edit_file`, `modify_file` | `filePath`, `targetContent`, `replacementContent` | Sostituzione mirata di un singolo blocco di testo. |
| `multi_replace_file_content` | `multi_replace`, `multi_edit`, `batch_replace` | `filePath`, `replacements[]` | Sostituzione non contigua di molteplici blocchi in un file. |
| `delete_file` | `remove_file`, `unlink`, `rm` | `filePath` | Eliminazione sicura di un file dal workspace. |
| `grep_search` | `grep`, `search_files`, `find_in_files` | `query`, `dirPath`, `isRegex`, `caseInsensitive` | Ricerca di testo o regex attraverso i file del progetto. |
| `list_dir` | `ls`, `listdir`, `dir` | `dirPath` | Elenco file e cartelle di un singolo livello. |
| `list_files_recursive` | `tree`, `find_files`, `file_tree` | `dirPath`, `maxDepth` | Scansione ricorsiva della struttura cartelle (escludendo `node_modules`, `.git`). |
| `run_command` | `terminal`, `exec`, `powershell`, `cmd`, `bash` | `command`, `cwd` | Esecuzione comandi PowerShell non interattivi con diagnostica auto-healing. |
| `run_tests` | *(nessuno — solo nome canonico)* | `command` | Rileva ed esegue il test runner del workspace (`test:fast`/`test` in `package.json` o pytest) e ritorna un esito pass/fail strutturato. |
| `inspect_os_env` | `system_info`, `os_env` | `none` | Ispezione di CPU, RAM, OS platform ed estensione hardware, incluso l'inventario toolchain (node/npm/pnpm/git/python con versioni). |
| `web_search` | `search_web`, `google`, `duckduckgo` | `query` | Ricerca web tramite DuckDuckGo. |
| `fetch_web_content` | `read_url`, `web_fetch`, `browse` | `url` | Estrazione e conversione in markdown di pagine web remote. |
| `download_file` | `download`, `fetch_file`, `save_url` | `url`, `targetPath` | Download di file binari o sorgenti nel workspace. |
| `git_status` | `gitstatus`, `status_git`, `git_state` | `none` | Stato sintetico (`git status --short`) del working tree nella workspace root. |
| `git_diff` | `gitdiff`, `git_changes`, `diff` | `filePath?`, `staged?` | Diff unificato (troncato a 8000 caratteri) dell'intero working tree o di un singolo file, staged o unstaged. |
| `git_commit` | *(nessuno — solo nome canonico)* | `commitMessage` | Stage + commit via `execFileSync` (argv-array, nessuna shell string). Sempre sottoposto ad approvazione umana esplicita a monte, in ogni modalità agente. |
| `rollback_workspace` | `rollback`, `undo`, `undo_changes`, `revert_workspace` | `none` | Ripristina tutti i file al baseline di inizio sessione (`AtomicWorkspaceJournal.rollbackAll()`). |
| `rollback_last_step` | `undo_last_step`, `undo_step`, `revert_last_step` | `none` | Ripristina solo le modifiche dell'ultimo step concluso, senza toccare gli step precedenti né il baseline di sessione. |
| `get_file_info` | `file_info`, `stat_file`, `file_stats`, `file_metadata` | `filePath` | Stat del file: dimensione, tipo, flag binario, conteggio righe, data ultima modifica. |
| `ensure_tool` | *(nessuno — solo nome canonico)* | `toolName` | Installa un tool di sviluppo mancante via winget, limitatamente all'allow-list chiusa di `devToolchain.ts`. |
| `ask` | `ask_question`, `clarify`, `question` | `question` | Richiesta di chiarimento all'utente (intercettata in modalità AGENT). |
| `finish` | `done`, `complete`, `finish_task` | `result` | Conclusione del turno previo superamento del Pre-Finish Gate. `result` è obbligatorio. |

---

### 2.3. Canali Workspace & File System (`workspace:*`)

| Canale IPC | Input | Output | Descrizione |
| :--- | :--- | :--- | :--- |
| `workspace:read-file` | `{ filePath: string, startLine?: number, endLine?: number }` | `{ content: string, totalLines: number }` | Lettura intera o slicing puntuale del file. |
| `workspace:write-file` | `{ filePath: string, content: string }` | `{ success: boolean, path: string }` | Scrittura sicura con creazione automatica delle cartelle padre. |
| `workspace:replace-file-content` | `{ filePath: string, chunks: ReplacementChunk[] }` | `{ success: boolean }` | Sostituzione mirata multi-chunk tollerante ai line ending CRLF. |
| `workspace:run-command` | `{ command: string, cwd?: string, timeoutMs?: number }` | `{ stdout: string, stderr: string, exitCode: number }` | Esecuzione sequenziale di comandi PowerShell con cattura dello stack trace. |

#### Eventi Broadcast Renderer per Cancellazione Riferimenti
* **`workspace:file-deleted`**: Trasmesso al renderer su eliminazione file/cartella (`{ filePath: string }`). Attiva il purge deterministico di tab aperti, file in evidenza (`pinnedFiles`), file selezionati ed elementi correlati. L'unico percorso di eliminazione e' il tool `delete_file` dell'agente, che passa da `workspaceAppService.deleteFile` proprio per emettere questo evento: eliminando direttamente dal repository i riferimenti nel renderer restavano puntati a un file non piu' esistente.
* **`ingest:document-deleted`**: Trasmesso al renderer su eliminazione documento RAG (`{ docId: string }`). Rimuove il documento dagli allegati attivi (`attachedDocIds`), anteprime e selezioni UI.

---

### 1.7. SLM Log Diagnostics & Anomaly Analysis
* **Endpoint:** `POST /agent/logs/analyze`
* **Content-Type:** `application/json`
* **Request Body:**
```json
{
  "extra_paths": ["C:/custom/logs/"]
}
```
* **Risposta (200 OK):**
```json
{
  "scanned_files": [".onlyrag/logs/session.log", "logs/app.log"],
  "total_lines_scanned": 1420,
  "anomalies": [
    {
      "anomaly_type": "CUDA_OOM",
      "severity": "CRITICAL",
      "log_file": "logs/app.log",
      "line_number": 42,
      "snippet": "CUDA out of memory. Tried to allocate 4.00 GiB",
      "count": 1,
      "remediation": "Riduci il context window (num_ctx: 4096) o seleziona un modello quantizzato (Q4_K_M) nelle impostazioni."
    }
  ],
  "has_critical": true,
  "summary": "Analisi completata: 2 file scansionati, 1 anomalia rilevata."
}
```

---

### 2.4. Canali Sistema & Diagnostica (`system:*` / `diagnostics:*` / `agent:logs-*`)

| Canale IPC | Input | Output | Descrizione |
| :--- | :--- | :--- | :--- |
| `system:get-diagnostics`| `none` | `DiagnosticsData` | Ispezione di CPU, RAM, VRAM, GPU NVML e capienza disco. |
| `system:read-logs` | `none` | `string[]` | Lettura dei log applicativi da disco. |
| `system:clear-logs` | `none` | `{ success: boolean }` | Pulizia del buffer in memoria e azzeramento del file fisico `logs/app.log`. |
| `agent:logs-analyze` | `extraPaths?: string[]` | `SlmLogDiagnosticReport` | Scansione anomalie log con sidecar e fallback automatico in Node.js su disco. |
| `diagnostics:open-logs-folder` | `none` | `{ success: boolean, path: string }` | Apre la cartella locale dei log (`logs/`) sul file system host Windows. |

---

### 2.5. Canali Skill Agentiche (`skills:*`)

| Canale IPC | Input | Output | Descrizione |
| :--- | :--- | :--- | :--- |
| `skills:list-installed` | `workspaceRoot?: string` | `SkillDefinition[]` | Elenco delle skill installate (globali e di workspace) con stato attivo e provenance. |
| `skills:list-sources` | `none` | `SkillHubSource[]` | Elenco delle sorgenti di hub configurate (builtin e custom). |
| `skills:add-custom-source` | `input: CustomHubInput` | `{ success: boolean, source?: SkillHubSource, error?: string }` | Aggiunta e persistenza di una sorgente JSON Catalog o GitHub Repository. |
| `skills:remove-custom-source` | `sourceId: string` | `{ success: boolean, error?: string }` | Rimozione di una sorgente di hub personalizzata. |
| `skills:list-hub-by-source` | `sourceId: string, workspaceRoot?: string, forceRefresh?: boolean` | `HubSkillItem[]` | Elenco delle skill da una sorgente specifica con supporto a caching TTL e refresh forzato. |
| `skills:toggle-active` | `skillId: string, isActive: boolean` | `boolean` | Attivazione/disattivazione manuale con salvataggio persistente su disco (`active_skills.json`). |
| `skills:install-from-hub` | `hubSkillId: string, workspaceRoot?: string, hubSourceId?: string` | `{ success: boolean, skill?: SkillDefinition, error?: string }` | Installazione di una skill da hub con calcolo SHA-256 e metadata provenance. |
| `skills:install-from-url` | `url: string, workspaceRoot?: string, customName?: string` | `{ success: boolean, skill?: SkillDefinition, error?: string }` | Importazione diretta di una skill tramite URL raw markdown. |
| `skills:save-custom` | `input: SkillSaveInput, workspaceRoot?: string` | `{ success: boolean, skill?: SkillDefinition, error?: string }` | Creazione o aggiornamento di una skill locale/personalizzata con rilevamento modifiche. |
| `skills:reset-original` | `skillId: string, workspaceRoot?: string` | `{ success: boolean, skill?: SkillDefinition, error?: string }` | Ripristino di una skill modificata al contenuto originale dell'hub. |
| `skills:uninstall` | `skillId: string, workspaceRoot?: string` | `{ success: boolean, error?: string }` | Disinstallazione ed eliminazione sicura della cartella skill. |

---

### 2.6. Canali Ingestion, Ricerca Vettoriale & Export (`ingest:*` / `vector:*` / `export:*`)

| Canale IPC | `electronAPI` Method | Input | Output | Descrizione |
| :--- | :--- | :--- | :--- | :--- |
| `ingest:file` | `ingestFile(...)` | `filePath, visionModel?, visionPrompt?` | `{ success: boolean, data?: IngestedDocument, error?: string }` | Ingestione documento ad alta velocità con parsing PyMuPDF, OCR e indicizzazione LanceDB. |
| `ingest:update` | `updateIngestedDocument(docId, md)` | `docId: string, markdownContent: string` | `{ success: boolean, data?: IngestedDocument, error?: string }` | Aggiornamento manuale del Markdown estratto e re-indicizzazione dei vettori in LanceDB. |
| `ingest:translate-inplace` | `translateDocumentInplace(...)` | `docId, sourceLang, targetLang, model?, backupOriginal?, targetDir?` | `{ success: boolean, data?: IngestedDocument, error?: string }` | Traduzione documento PDF/DOCX con salvataggio nella cartella di destinazione e preservazione del file originale. |
| `ingest:page-preview` | `getDocumentPagePreview(...)` | `docId: string, pageNumber: number` | `PagePreviewData \| null` | Rendering raster ad alta risoluzione della pagina sorgente per la preview a due pannelli. |
| `ingest:list` | `getIngestedDocuments()` | `none` | `IngestedDocument[]` | Elenco di tutti i documenti indicizzati in LanceDB. |
| `ingest:delete` | `deleteIngestedDocument(docId)` | `docId: string` | `{ success: boolean }` | Eliminazione del documento e dei relativi vettori da LanceDB. |
| `vector:search` | `searchVectorDb(...)` | `query, topK?, embeddingModel?, docIds?` | `VectorSearchResult[]` | Ricerca ibrida (vettoriale densa + BM25) su LanceDB. |
| `export:document` | `exportDocument(...)` | `markdownContent, format, outputFolder?` | `{ success: boolean, message?: string, error?: string }` | Compilazione ed esportazione compressa in PDF, DOCX o Markdown. |

