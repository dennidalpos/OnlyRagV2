# Dipendenze Esterne & Implementazioni di Dominio — OnlyRag V2

Questo documento descrive la logica di adozione delle librerie di terze parti e le implementazioni proprietarie pure del dominio in OnlyRag V2.

---

## 1. Implementazioni di Dominio Pure vs Librerie

OnlyRag V2 privilegia librerie standard collaudate per parsing crittografico/sintattico e implementa internamente la logica di dominio ad alta sensibilità per evitare dipendenze superflue e vulnerabilità:

| Funzionalità | Approccio Adottato | Rationale |
| :--- | :--- | :--- |
| **Calcolo Token BPE** | `gpt-tokenizer` (`o200k_base`) | Tokenizer BPE ufficiale ultrarapido e deterministico in puro JS, con fallback su conteggio caratteri calibrato. |
| **Riparazione JSON** | `jsonrepair` | Ripara JSON troncati o con errori di sintassi generati dagli SLM (virgole mancanti, apici singoli). |
| **Diffing & Hunk Parsing** | `diff` + [`diffEngine.ts`](../shared/domain/agent/diffEngine.ts) | La libreria genera i raw diff; `diffEngine` applica la logica pura di proiezione e calcolo offset riga per l'editor Monaco. |
| **String Similarity** | `fast-levenshtein` | Calcolo efficiente della distanza di Levenshtein per il fuzzy matching dei comandi e dei nomi file. |
| **Queue di Concorrenza** | `p-queue` | Limita la concorrenza delle richieste concorrenti asincrone verso Ollama e il file system. |
| **HTML to Markdown** | `turndown` + `cheerio` | Conversione fedele e sanificata del web fetch in Markdown per il contesto dell'agente. |
| **Vector DB** | `lancedb` (Python) | Database vettoriale embedded serverless basato su Apache Arrow, senza necessità di server esterni o Docker. |
| **PDF Extraction & OCR** | `PyMuPDF (fitz)` + `RapidOCR` | PyMuPDF offre estrazione nativa istantanea (<5ms/pagina). RapidOCR gestisce OCR locale via ONNX Runtime su CPU/GPU. |

---

## 2. Sintesi dell'Audit Dipendenze e Sicurezza

1. **Zero Dipendenze Circolari**: Il grafo delle dipendenze di `src/` ed `electron/` è verificato a 0 cicli tramite `dpdm` e `skott` (`npm run audit:cycles`).
2. **Isolamento da Vulnerabilità Note**:
   - `dompurify` è vincolato a versione sicura tramite `overrides` in `package.json`.
   - I log operativi sono filtrati da [`logRedactor.ts`](../electron/logRedactor.ts) per escludere chiavi API, token e percorsi assoluti.
3. **Audit Dead Code**: I moduli non utilizzati ed export orfani vengono monitorati continuativamente via Knip (`npm run audit:deadcode`).
