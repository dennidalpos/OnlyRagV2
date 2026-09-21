# RAG, OCR e traduzione

Il Main usa [`sidecarHttpClient.ts`](../electron/core/infrastructure/http/sidecarHttpClient.ts) per parlare con il FastAPI Sidecar. Il Sidecar coordina estrazione, embedding, LanceDB, ricerca, OCR ed export.
Lo stato è `online` solo con HTTP 200 e un payload `/health` completo: risposta malformata, errore, timeout o uscita del processo impostano `offline`.

## Ingestion

- Parser per PDF, DOCX, testo, immagini e dati tabellari.
- `file_type` è parte del contratto di ingestione, aggiornamento e lista: il Main lo normalizza senza perdere `docx`, così l'idoneità alla traduzione in-place resta stabile.
- PDF: estrazione nativa; OCR locale RapidOCR quando serve; Vision Ollama come percorso configurabile.
- I chunk ricevono intestazioni contestuali e vengono indicizzati in LanceDB.
- Se l'embedding Ollama fallisce, il vettore deterministico CPU marca il documento `indexed_fallback`.
- Ogni stream ha un `task_id`: l'annullamento è cooperativo ai confini sicuri e pulisce i record LanceDB parziali.
- L'eliminazione aggiorna lista e selezione del Renderer solo dopo `DELETE /documents/{doc_id}` riuscita; errori HTTP, rete e timeout restano visibili e non producono uno stato locale falso.

Implementazione: [`sidecar/domain/ingestion.py`](../sidecar/domain/ingestion.py), [`sidecar/services/ingest_service.py`](../sidecar/services/ingest_service.py), [`sidecar/infrastructure/embeddings.py`](../sidecar/infrastructure/embeddings.py).

## Ricerca

[`search_service.py`](../sidecar/services/search_service.py) esegue:

1. retrieval denso sui chunk LanceDB;
2. matching lessicale sui token, nome documento e sezione;
3. RRF con `k=60`;
4. reranking dei candidati con FlashRank o fallback locale.

## Traduzione in-place

[`translator.py`](../sidecar/domain/translator.py) traduce batch di run DOCX e blocchi PDF, preservando coordinate e formattazione dove possibile. Per PDF applica redazione del testo originale, scelta font Noto e adattamento della dimensione; lo stream usa NDJSON.

## Dati e lifecycle

- Tabelle e filtri sono gestiti da [`sidecar/infrastructure/db.py`](../sidecar/infrastructure/db.py).
- Il Main avvia e arresta il processo tramite `sidecarProcessManager`.
- Il database persistente vive in `<userData>/data/lancedb_store`. All'avvio il Main sposta in modo non distruttivo gli archivi creati dal vecchio percorso `<userData>/data/data`; in caso di collisione conserva entrambe le copie e registra un avviso.
- Durante l'avvio il Renderer ripete la diagnostica ogni secondo finché il Sidecar non risponde, poi torna all'intervallo ordinario di 10 secondi. Il primo controllo `offline` non viene quindi mantenuto mentre LanceDB sta ancora inizializzando.
- I residui su `:8000` sono reclamati solo se il processo appartiene ai binari autorizzati.
- Il vocabolario aggiuntivo usa il manifest `sidecar/assets/vocab/manifest.json`: prova prima il repository `master`, risolve i pack relativi allo stesso percorso e aggiorna la cache con sostituzione atomica.
- Il pacchetto Sidecar include lo stesso manifest e un pack di base. Se rete o manifest remoto non sono disponibili, avvia quindi una cache funzionante dagli asset inclusi invece di dipendere da una cache preesistente.
- Residuo esterno tracciato: gli asset remoti diventano raggiungibili da `raw.githubusercontent.com` solo dopo la pubblicazione delle modifiche su `origin/master`; fino ad allora viene usata la copia inclusa.
