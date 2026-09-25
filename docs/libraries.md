# Dipendenze

## Node/Electron

- React, Vite, Electron, Tailwind e Monaco: UI e packaging.
- `gpt-tokenizer`: stima BPE del contesto.
- `zod`, `jsonrepair`: contratti e recupero delle risposte strutturate.
- `diff`: diff delle proposte di modifica.
- `p-queue`: coda dei task Main.
- `turndown`, `cheerio`: conversione web in Markdown.
- `playwright`: validazione browser. Il terminale usa PowerShell tramite `PersistentPowerShellSession`, senza dipendenze native aggiuntive.

## Python Sidecar

- FastAPI/Uvicorn/Pydantic: HTTP e validazione.
- LanceDB/NumPy/Pandas: persistenza e dati vettoriali.
- PyMuPDF, python-docx, Pillow, RapidOCR e ONNX Runtime GPU: parsing/OCR.
- `wordfreq`, `symspellpy`, `langdetect`: vocabolario e normalizzazione.

Versioni e vincoli sono nei manifest [`package.json`](../package.json), [`sidecar/requirements.txt`](../sidecar/requirements.txt) e [`sidecar/constraints.txt`](../sidecar/constraints.txt). Non duplicarli nella documentazione.

## Controlli

`npm run quality:static` (errori di lint Biome, format-check Biome di ogni file incluso da `biome.json`, guard IPC e di layering; `noExplicitAny` è un errore in ogni file, test compresi (il JSON non fidato ai confini usa l'alias documentato `UntrustedJson` di `shared/types`; i doppi di test usano tipi espliciti, `as unknown as T` o `as never`); i `catch` usano `unknown` con [`errorMessage`](../shared/domain/errors/errorMessage.ts)), `npm run audit:deadcode` e `npm run audit:cycles` coprono qualità, export orfani e dipendenze circolari. `audit:deadcode` esegue knip due volte: la modalità normale conta anche i test come entry, `--production` solo le entry marcate `!` in [`knip.json`](../knip.json), così un export usato solo dai test risulta orfano; gli hook di test voluti (reset di cache, `__testing`) portano il tag JSDoc `@internal`. I log passano da [`logRedactor.ts`](../electron/logRedactor.ts).
