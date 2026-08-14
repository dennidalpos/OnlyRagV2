# Riferimento API & Contratti di Comunicazione — OnlyRag V2

OnlyRag V2 implementa due livelli di interfaccia:
1. **REST API (FastAPI Sidecar)** per l'elaborazione dei documenti, l'ingestione e la ricerca ibrida su LanceDB.
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
  "embedding_model": "bge-m3",
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
  "embedding_model": "bge-m3",
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
* **`GET /documents`**: Restituisce la lista di tutti i documenti indicizzati in LanceDB.
* **`DELETE /documents/{doc_id}`**: Elimina atomicamente il documento e tutti i relativi chunk vettoriali associati.

---

## 2. Electron IPC API (`window.electronAPI`)

Tutte le chiamate IPC sono tipizzate tramite TypeScript in `src/types/index.ts`.

### 2.1. Canali Modelli Ollama (`ollama:*`)

| Canale IPC | Input | Output | Descrizione |
| :--- | :--- | :--- | :--- |
| `ollama:get-models` | `none` | `OllamaModel[]` | Elenco di tutti i modelli scaricati localmente. |
| `ollama:pull-model` | `{ modelName: string }` | `Stream Event (progress %)` | Download streaming del modello con percentuale e byte trasferiti. |
| `ollama:get-running-models`| `none` | `RunningModelInfo[]` | Modelli attualmente caricati nella VRAM/RAM (`/api/ps`). |
| `ollama:unload-model` | `{ modelName: string }` | `{ success: boolean }` | Evizione esplicita immediata (`keep_alive: 0`). |

---

### 2.2. Canali Agente di Sviluppo (`agent:*`)

| Canale IPC | Input | Output | Descrizione |
| :--- | :--- | :--- | :--- |
| `agent:run-turn` | `AgentTurnRequest` | `Async Stream` | Esecuzione di un turno agentico con Tool-Calling e auto-healing. |
| `agent:stop-generation` | `none` | `void` | Interruzione immediata della generazione del token stream. |
| `agent:run-benchmark` | `none` | `BenchmarkReport` | Valutazione quantitativa delle prestazioni dei modelli locali. |

---

### 2.3. Canali Workspace & File System (`workspace:*`)

| Canale IPC | Input | Output | Descrizione |
| :--- | :--- | :--- | :--- |
| `workspace:read-file` | `{ filePath: string, startLine?: number, endLine?: number }` | `{ content: string, totalLines: number }` | Lettura intera o slicing puntuale del file. |
| `workspace:write-file` | `{ filePath: string, content: string }` | `{ success: boolean, path: string }` | Scrittura sicura con creazione automatica delle cartelle padre. |
| `workspace:replace-file-content` | `{ filePath: string, chunks: ReplacementChunk[] }` | `{ success: boolean }` | Sostituzione mirata multi-chunk tollerante ai line ending CRLF. |
| `workspace:run-command` | `{ command: string, cwd?: string, timeoutMs?: number }` | `{ stdout: string, stderr: string, exitCode: number }` | Esecuzione sequenziale di comandi PowerShell con cattura dello stack trace. |

---

### 2.4. Canali Sistema & Diagnostica (`system:*`)

| Canale IPC | Input | Output | Descrizione |
| :--- | :--- | :--- | :--- |
| `system:get-diagnostics`| `none` | `DiagnosticsData` | Ispezione di CPU, RAM, VRAM, GPU NVML e capienza disco. |
| `system:read-logs` | `none` | `string[]` | Lettura dei log applicativi da disco. |
| `system:clear-logs` | `none` | `{ success: boolean }` | Pulizia del buffer in memoria e azzeramento del file fisico `logs/app.log`. |

---

### 2.5. Canali Skill Agentiche (`skills:*`)

| Canale IPC | Input | Output | Descrizione |
| :--- | :--- | :--- | :--- |
| `skills:list` | `none` | `SkillDefinition[]` | Elenco delle skill presenti in `/skills/` con provenienza e hash SHA-256. |
| `skills:save` | `{ name: string, content: string, origin?: SkillOrigin }` | `{ success: boolean, skill: SkillDefinition }` | Creazione o aggiornamento con calcolo checksum automatico. |
| `skills:delete` | `{ name: string }` | `{ success: boolean }` | Rimozione della cartella skill dal workspace. |
