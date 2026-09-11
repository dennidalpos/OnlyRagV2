# Dipendenze

## Node/Electron

- React, Vite, Electron, Tailwind e Monaco: UI e packaging.
- `gpt-tokenizer`: stima BPE del contesto.
- `zod`, `jsonrepair`: contratti e recupero delle risposte strutturate.
- `diff`, `fast-levenshtein`: diff e matching.
- `p-queue`: coda dei task Main.
- `turndown`, `cheerio`: conversione web in Markdown.
- `node-pty`, `playwright`: terminale e validazione browser.

## Python Sidecar

- FastAPI/Uvicorn/Pydantic: HTTP e validazione.
- LanceDB/NumPy/Pandas: persistenza e dati vettoriali.
- PyMuPDF, python-docx, Pillow, RapidOCR e ONNX Runtime GPU: parsing/OCR.
- `flashrank`: reranking opzionale con fallback locale.
- `wordfreq`, `symspellpy`, `langdetect`: vocabolario e normalizzazione.

Versioni e vincoli sono nei manifest [`package.json`](../package.json), [`sidecar/requirements.txt`](../sidecar/requirements.txt) e [`sidecar/constraints.txt`](../sidecar/constraints.txt). Non duplicarli nella documentazione.

## Controlli

`npm run quality:static`, `npm run audit:deadcode` e `npm run audit:cycles` coprono qualità, export orfani e dipendenze circolari. I log passano da [`logRedactor.ts`](../electron/logRedactor.ts).
