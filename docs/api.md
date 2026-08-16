# Riferimento API & Contratti di Comunicazione — OnlyRag V2

OnlyRag V2 implementa due livelli di interfaccia:
1. **REST API (FastAPI Sidecar)** per l'elaborazione dei documenti, l'ingestione, l'export e la ricerca ibrida su LanceDB.
2. **IPC API (Electron Main/Renderer)** per l'esecuzione dei tool agentici, la diagnostica hardware e la gestione dei modelli Ollama.

---

## 1. REST API — Python FastAPI Sidecar (`http://127.0.0.1:8000`)

### 1.1. Health Check
* **Endpoint:** `GET /health`
* **Descrizione:** Verifica lo stato operativo del sidecar e la connessione al database LanceDB.
* **Risposta (200 OK):**
```json
{
  "status": "healthy",
  "version": "2.0.0",
  "lancedb": "connected",
  "total_documents": 12
}
```

---

### 1.2. Ingestione Documentale
* **Endpoint:** `POST /ingest`
* **Content-Type:** `multipart/form-data`
* **Parametri:**
  * `file`: File binario (`PDF`, `DOCX`, `TXT`, `MD`, `PNG`, `JPG`).
  * `embedding_model` *(opzionale)*: Modello di embedding (default: `nomic-embed-text`).
* **Risposta (200 OK):**
```json
{
  "status": "success",
  "doc_id": "doc_a1b2c3d4",
  "filename": "Contratto_Fornitura.pdf",
  "chunks_created": 18,
  "embedding_model": "nomic-embed-text",
  "extracted_preview": "# Contratto di Fornitura..."
}
```

---

### 1.3. Ricerca Vettoriale Ibrida & Re-Ranking
* **Endpoint:** `POST /search`
* **Content-Type:** `application/json`
* **Request Body:**
```json
{
  "query": "Quali sono le penali per recesso anticipato secondo art. 1341?",
  "top_k": 5,
  "embedding_model": "nomic-embed-text",
  "allowed_doc_ids": ["doc_a1b2c3d4"]
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

### 1.4. Gestione Documenti Memorizzati
* **`GET /documents`**: Restituisce la lista di tutti i documenti indicizzati in LanceDB con metadati (`id`, `filename`, `file_size`, `num_pages`, `num_chunks`, `status`, `ingested_at`).
* **`DELETE /documents/{doc_id}`**: Elimina atomicamente il documento e tutti i relativi chunk vettoriali associati da LanceDB.

---

### 1.5. Esportazione Documento Formattato
* **Endpoint:** `POST /export`
* **Content-Type:** `application/json`
* **Request Body:**
```json
{
  "title": "Relazione_Tradotta",
  "content": "# Relazione Clinica\n\nTesto tradotto...",
  "format": "pdf"
}
```
* **Formati Supportati:** `pdf`, `md`, `docx`.
* **Risposta (200 OK):** File binario scaricabile con appropriato `Content-Disposition`.

---

## 2. Electron IPC API (`window.electronAPI`)

Tutte le chiamate IPC sono rigorosamente tipizzate tramite TypeScript in `src/types/index.ts`.

### 2.1. Canali Modelli Ollama (`ollama:*`)

| Canale IPC | Input | Output | Descrizione |
| :--- | :--- | :--- | :--- |
| `ollama:get-models` | `none` | `OllamaModel[]` | Elenco di tutti i modelli scaricati localmente. |
| `ollama:pull-model` | `{ modelName: string }` | `Stream Event (progress %)` | Download streaming del modello con percentuale e byte trasferiti. |
| `ollama:get-running-models`| `none` | `RunningModelInfo[]` | Modelli attualmente caricati nella VRAM/RAM (`/api/ps`). |
| `ollama:unload-model` | `{ modelName: string }` | `{ success: boolean }` | Evizione esplicita immediata (`keep_alive: 0`). |

---

### 2.2. Canali Agente di Sviluppo (`agent:*`) & Tool Set (19 Strumenti)

| Canale IPC | Input | Output | Descrizione |
| :--- | :--- | :--- | :--- |
| `agent:run-turn` | `AgentTurnRequest` | `Async Stream` | Esecuzione di un turno agentico con Tool-Calling (19 strumenti), auto-healing e FSM mode gating. |
| `agent:stop-generation` | `none` | `void` | Interruzione immediata della generazione del token stream. |
| `agent:run-benchmark` | `none` | `BenchmarkReport` | Valutazione quantitativa delle prestazioni dei modelli locali. |

#### Matrice Completa dei 19 Strumenti Agentici Supportati

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
| `inspect_os_env` | `system_info`, `os_env` | `none` | Ispezione di CPU, RAM, OS platform ed estensione hardware. |
| `web_search` | `search_web`, `google`, `duckduckgo` | `query` | Ricerca web tramite DuckDuckGo. |
| `fetch_web_content` | `read_url`, `web_fetch`, `browse` | `url` | Estrazione e conversione in markdown di pagine web remote. |
| `download_file` | `download`, `fetch_file`, `save_url` | `url`, `targetPath` | Download di file binari o sorgenti nel workspace. |
| `ask` | `ask_question`, `clarify`, `question` | `question` | Richiesta di chiarimento all'utente (intercettata in modalita AGENT). |
| `finish` | `done`, `complete`, `finish_task` | `summary` | Conclusione del turno previo superamento del Pre-Finish Gate. |

---

### 2.3. Canali Workspace & File System (`workspace:*`)

| Canale IPC | Input | Output | Descrizione |
| :--- | :--- | :--- | :--- |
| `workspace:read-file` | `{ filePath: string, startLine?: number, endLine?: number }` | `{ content: string, totalLines: number }` | Lettura intera o slicing puntuale del file. |
| `workspace:write-file` | `{ filePath: string, content: string }` | `{ success: boolean, path: string }` | Scrittura sicura con creazione automatica delle cartelle padre. |
| `workspace:replace-file-content` | `{ filePath: string, chunks: ReplacementChunk[] }` | `{ success: boolean }` | Sostituzione mirata multi-chunk tollerante ai line ending CRLF. |
| `workspace:run-command` | `{ command: string, cwd?: string, timeoutMs?: number }` | `{ stdout: string, stderr: string, exitCode: number }` | Esecuzione sequenziale di comandi PowerShell con cattura dello stack trace. |

---

### 2.4. Canali Sistema & Diagnostica (`system:*` / `diagnostics:*`)

| Canale IPC | Input | Output | Descrizione |
| :--- | :--- | :--- | :--- |
| `system:get-diagnostics`| `none` | `DiagnosticsData` | Ispezione di CPU, RAM, VRAM, GPU NVML e capienza disco. |
| `system:read-logs` | `none` | `string[]` | Lettura dei log applicativi da disco. |
| `system:clear-logs` | `none` | `{ success: boolean }` | Pulizia del buffer in memoria e azzeramento del file fisico `logs/app.log`. |
| `diagnostics:open-logs-folder` | `none` | `{ success: boolean, path: string }` | Apre la cartella locale dei log (`logs/`) sul file system host Windows. |

---

### 2.5. Canali Skill Agentiche (`skills:*`)

| Canale IPC | Input | Output | Descrizione |
| :--- | :--- | :--- | :--- |
| `skills:list-installed` | `workspaceRoot?: string` | `SkillDefinition[]` | Elenco delle skill installate (globali e di workspace) con stato attivo e provenance. |
| `skills:list-hub` | `workspaceRoot?: string` | `HubSkillItem[]` | Elenco delle skill del Core Hub ufficiale. |
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

