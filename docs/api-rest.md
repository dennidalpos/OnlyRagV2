# Riferimento REST API Sidecar — OnlyRag V2

Questo documento definisce in modo conciso e pratico tutti gli endpoint REST esposti dal **FastAPI Python Sidecar** locale in ascolto su `http://127.0.0.1:8000`.

La specifica machine-readable OpenAPI 3.1 completa è mantenuta in [`sidecar/contracts/openapi-2.3.0.json`](../sidecar/contracts/openapi-2.3.0.json) (rigenerabile con `npm run generate:openapi` ed auditabile con `npm run test:sidecar`).

---

## 1. Stato del Servizio & Manutenzione

### `GET /health`
* **Descrizione**: Verifica lo stato operativo, la connessione al database LanceDB e le risorse hardware GPU/OCR disponibili.
* **Risposta (200 OK)**:
  ```json
  {
    "status": "online",
    "engine": "FastAPI Python Sidecar + LanceDB OCR Engine V2",
    "version": "2.3.0",
    "vector_db": "LanceDB Embedded",
    "gpu": { "has_nvidia_gpu": true, "gpu_name": "RTX 4070", "vram_total_mb": 12288 },
    "ocr": { "provider": "CPUExecutionProvider", "host_has_gpu": true },
    "documents_count": 14,
    "chunks_count": 420,
    "python_version": "3.12.x"
  }
  ```

### `POST /db/maintenance`
* **Descrizione**: Esegue la compattazione dei file di LanceDB e l'ottimizzazione degli indici vettoriali per evitare frammentazione su disco.
* **Risposta (200 OK)**: `{ "status": "optimized", "compacted_tables": ["documents", "chunks"] }`

### `POST /cleanup/temp`
* **Descrizione**: Rimuove file temporanei di rendering OCR e residui lasciati da task interrotti.
* **Risposta (200 OK)**: `{ "freed_bytes": 10485760, "deleted_files": 12 }`

### `POST /tasks/cancel`
* **Descrizione**: Cancella un task di estrazione o traduzione asincrono in corso nel sidecar.
* **Body**: `{ "task_id": "string" }`
* **Risposta (200 OK)**: `{ "cancelled": true, "task_id": "..." }`

---

## 2. Ingestione Documentale & OCR

### `POST /ingest`
* **Descrizione**: Ingestione via upload multipart per file binari (`PDF`, `DOCX`, `TXT`, `MD`, `PNG`, `JPG`).
* **Form-Data**:
  * `file`: file binario.
  * `normalize_with_llm` *(opzionale, default: false)*: normalizzazione con LLM.
  * `normalization_model` *(opzionale)*: modello per la correzione Markdown.
* **Risposta (200 OK)**: `IngestResponse` con metadati, pagine e `extracted_markdown`.

### `POST /ingest-path` & `POST /ingest-path-stream`
* **Descrizione**: Ingestione ad alta velocità da percorso locale su disco (con opzione di streaming NDJSON progressivo per la UI).
* **Body**:
  ```json
  {
    "file_path": "C:/documenti/report.pdf",
    "vision_model": "llama3.2-vision:latest",
    "vision_prompt": "template_mustache_raw",
    "normalize_with_llm": false,
    "max_tabular_rows": 500
  }
  ```
* **Tier OCR**: Se `vision_prompt` è fornito, il sidecar elabora le pagine scansionate con il modello Vision LLM via Ollama; in caso contrario (o in caso di errore), opera il fallback locale deterministico su **RapidOCR**.
* **Streaming NDJSON (`/ingest-path-stream`)**: Eventi progressivi `{ "type": "progress" | "done", "percent": 0-100, "step": "...", "pipeline": "Vision LLM OCR" | "OCR Layout" }`.

---

## 3. Gestione Documenti Vettoriali

### `GET /documents`
* **Descrizione**: Elenco di tutti i documenti indicizzati in LanceDB con stato (`indexed` o `indexed_fallback`) e flag `used_fallback_embeddings`.
* **Risposta (200 OK)**: `IngestedDocument[]`.

### `DELETE /documents/{doc_id}`
* **Descrizione**: Eliminazione atomica di un documento e di tutti i vettori associati nelle tabelle LanceDB.
* **Risposta (200 OK)**: `{ "deleted": true, "doc_id": "..." }`

### `PUT /documents/{doc_id}`
* **Descrizione**: Aggiorna il testo Markdown di un documento precedentemente estratto e rigenera i chunk vettoriali.
* **Body**: `{ "markdown_content": "# Nuovo testo..." }`
* **Risposta (200 OK)**: `{ "updated": true, "doc_id": "...", "num_chunks": 8 }`

### `GET /documents/{doc_id}/page-preview/{page_num}`
* **Descrizione**: Renderizza l'anteprima bitmap (PNG Base64 o JPEG) di una specifica pagina del documento per la vista split-screen.
* **Risposta (200 OK)**: `{ "data_url": "data:image/png;base64,..." }`

---

## 4. Traduzione In-Place a Layout Preservato

### `POST /documents/{doc_id}/translate-inplace` & `POST /documents/{doc_id}/translate-inplace-stream`
* **Descrizione**: Traduce il documento sostituendo il testo in-place all'interno delle coordinate geometriche originali (PDF/DOCX), preservando impaginazione, font, tabelle ed elementi grafici.
* **Body**:
  ```json
  {
    "source_lang": "Italian",
    "target_lang": "English",
    "model": "qwen2.5:7b",
    "backup_original": true,
    "target_dir": "C:/documenti/tradotti"
  }
  ```
* **PDF Engine**: Modalità fine con redazione del testo originale, auto-fit del font size, collision avoidance spaziale e font Noto Sans specifici per CJK o lingue occidentali.

---

## 5. Ricerca Vettoriale & Storico Semantico

### `POST /vector/search`
* **Descrizione**: Ricerca ibrida avanzata su LanceDB che combina Dense Vector Similarity, BM25 lessicale e Reciprocal Rank Fusion (RRF, $k=60$).
* **Body**:
  ```json
  {
    "query": "clausole di recesso e penali",
    "top_k": 5,
    "model": "nomic-embed-text",
    "doc_ids": ["doc_123", "doc_456"]
  }
  ```
* **Risposta (200 OK)**: Array di `VectorSearchResult` con snippet, header di sezione e score RRF.

### `POST /history/index`, `POST /history/search`, `POST /history/remove`
* **Descrizione**: Indice semantico cross-progetto dei prompt eseguiti con successo per suggerimenti intelligenti e riutilizzo contestuale.

---

## 6. Diagnostica Log SLM & Vocabolario

### `POST /agent/logs/analyze`
* **Descrizione**: Parsing euristico dei log della sessione SLM per isolare stack trace, warning, codici di uscita PowerShell e loop ricorsivi.
* **Body**: `{ "raw_log": "...", "workspace_path": "..." }`
* **Risposta (200 OK)**: `SlmDiagnosticsReport` con gravità (`CRITICAL`, `ERROR`, `WARNING`) e suggerimenti di remediation.

### `POST /vocab/sync` & `GET /vocab/status`
* **Descrizione**: Sincronizza ed interroga le matrici N-gram/TF-IDF per la classificazione deterministica ultra-rapida dei domini specialistici (Medical, Legal, General).
