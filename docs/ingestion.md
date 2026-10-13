# Ingestion, OCR e dati sorgente

Il Renderer passa il percorso del file a Main tramite il Preload. Main valida la richiesta e usa il Sidecar FastAPI per estrazione, OCR, normalizzazione facoltativa, embedding e salvataggio. Il contratto eseguibile è in [`sidecar/main.py`](../sidecar/main.py), [`sidecar/schemas.py`](../sidecar/schemas.py) e [`electron/core/infrastructure/http/sidecarHttpClient.ts`](../electron/core/infrastructure/http/sidecarHttpClient.ts).

## Comportamento attuale

- `POST /ingest-path-stream` emette progresso NDJSON; `POST /tasks/cancel` prende il `task_id`. L'originale del chiamante non viene modificato. Le nuove ingestion conservano una copia verificabile in `data/source-documents/<doc_id>`.
- Il Sidecar prepara chunk e vettori prima del commit coordinato. `data/document-recovery.json` blocca operazioni dipendenti se il recupero fallisce; non promuovere o cancellare il journal a mano.
- La normalizzazione LLM usa il contesto selezionato e un budget esplicito. Se non può preservare il contenuto, restituisce l'estrazione originale per revisione e non indicizza il risultato rifiutato. L'accettazione automatica riguarda soltanto differenze di spaziatura approvate.
- CSV/TSV conserva stringhe letterali come `0007`, `12.50` e `NA`. CSV, Parquet, XLSX e XLS producono estratti RAG limitati e segnalano righe, colonne o celle omesse. I parser rifiutano input malformati prima di scrivere l'indice.
- L'opzione **Excel: format dimensions** vale per una singola ingestion. Mantiene le coordinate massime del formato, ma l'estratto indicizzato resta limitato. XLS carica ancora un foglio selezionato tramite xlrd: i casi numerici estremi verificati non stabiliscono un limite generale di memoria.

## Limiti aperti

`DOC-LARGE-EXTRACTION-REVIEW-01` riguarda estrazioni originali oltre i limiti della bozza di revisione. `XLS-PARSER-MEMORY-ADMISSION-01` riguarda l'ammissione prima della materializzazione di XLS. `SOURCE-ARCHIVE-LIFECYCLE-01` richiede backup, export e reclamazione esplicita degli originali conservati. Il riferimento operativo resta [`PROJECT_STATUS.json`](../PROJECT_STATUS.json).

Dettagli storici e misure: [`rag-sidecar-history-2026-10-13.md`](./rag-sidecar-history-2026-10-13.md), [`verification-history-2026-10-13.md`](./verification-history-2026-10-13.md). Le prove isolate non qualificano automaticamente un corpus personale o un'app installata.
