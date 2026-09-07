# Pipeline RAG & Python Sidecar — OnlyRag V2

Il sottosistema RAG di OnlyRag V2 è gestito dal **Python FastAPI Sidecar** (in ascolto su `http://127.0.0.1:8000`) abbinato al database vettoriale incorporato **LanceDB**.

---

## 1. Architettura dell'Ingestione Documentale

L'ingestione converte file eterogenei (`PDF`, `DOCX`, `TXT`, `MD`, immagini) in Markdown strutturato e vettori densi:

```
[File Sorgente] ──> [PyMuPDF / docx Parser]
                            │
              ┌─────────────┴─────────────┐
        [Testo Nativo]             [Pagine Scansionate]
              │                           │
              │                 ┌─────────┴─────────┐
              │                 ▼                   ▼
              │            [RapidOCR]      [Ollama Vision LLM]
              │           (Locale fast)     (Multimodale high-acc)
              └─────────────┬───────────────────────┘
                            ▼
                [Markdown Strutturato]
                            │
                [Semantic Chunking Engine]
                            │
                [Embedding Vectorizer (Ollama)]
                            │
                [LanceDB Embedded Table]
```

### 1.1. Bounded Concurrency per OCR e Vision
* L'elaborazione OCR/Vision delle pagine grafiche è regolata da un semaforo di concorrenza limitata (`BoundedSemaphore`).
* Questo impedisce la saturazione improvvisa della RAM/VRAM del sistema quando vengono caricati documenti PDF con centinaia di pagine illustrate.

### 1.2. Fallback Automatico degli Embedding
* Se il modello di embedding primario (es. `nomic-embed-text`) genera timeout o OOM su Ollama, il sidecar attiva automaticamente un fallback leggero (o embedding deterministico CPU), contrassegnando il documento con `status: "indexed_fallback"` e `used_fallback_embeddings: true` per notificare la UI dello stato qualitativo.

---

## 2. Ricerca Ibrida Avanzata (Hybrid Search)

Il motore di retrieval ([`search_service.py`](../sidecar/services/search_service.py)) implementa un ranking a tre stadi:

1. **Dense Vector Search**: calcolo della cosine similarity tramite l'indice LanceDB dei chunk vettorizzati.
2. **Lexical BM25 Search**: scansione lessicale per parole chiave esatte, codici identificativi o nomi propri.
3. **Reciprocal Rank Fusion (RRF)**:
   $$RRF\_Score(d) = \sum_{m \in \{dense, bm25\}} \frac{1}{k + rank_m(d)} \quad (k = 60)$$
   Fonde e normalizza i due ordinamenti, garantendo alta pertinenza sia su query semantiche astratte sia su termini tecnici specifici.

---

## 3. Traduzione In-Place a Layout Preservato

Il modulo di traduzione in-place ([`translator.py`](../sidecar/domain/translator.py)) sovrascrive direttamente il testo sui file mantenendo intatta la struttura visiva:

### 3.1. Documenti Word (`DOCX`)
* Sostituzione mirata a livello di XML run (`python-docx`).
* Preserva tabelle, intestazioni, colori, stili carattere e formattazione paragrafo originale.

### 3.2. Documenti PDF (Fine-Mode con Collision Avoidance)
* **Redazione Reale**: Il testo originale viene rimosso fisicamente tramite `page.add_redact_annot` e `apply_redactions()`. Su pagine scansionate con bitmap di sfondo, i pixel del vecchio testo vengono sbiancati per evitare sovrapposizioni visive.
* **Auto-Fit & Font Selection**: Calcolo dinamico della grandezza del font (`auto-fit`) per adattare la traduzione (spesso più lunga dell'originale) al box delimitatore. I font `Noto Sans` supportano nativamente glifi CJK, latini, cirillici e greci.
* **Collision Avoidance Spaziale**: Scansione verticale dei blocchi per evitare che l'espansione di un paragrafo tradotto copra il blocco sottostante.
* **Compressione Finale**: Salvataggio compresso del PDF generato tramite garbage collection PyMuPDF e stream deflating.

---

## 4. Manutenzione e Isolamento

- **Prevenzione Iniezioni nei Filtri**: I document ID sono validati contro un charset alfanumerico rigoroso prima di essere interpolati nei filtri SQL di LanceDB ([`db.py`](../sidecar/infrastructure/db.py)).
- **Orphan Port Reclaim**: Il processo Electron Main monitora costantemente il PID del sidecar; in caso di terminazione inaspettata, la porta `:8000` viene reclamata forzatamente prima del riavvio.
