# Dipendenze e limiti noti

Le dipendenze correnti sono in [package.json](../package.json), [package-lock.json](../package-lock.json), [requirements.txt](../sidecar/requirements.txt) e [constraints.txt](../sidecar/constraints.txt). Non usare i conteggi degli audit datati come stato corrente. La distribuzione richiede l'inventario reale dei componenti: [distribution.md](./distribution.md).

## Node/Electron

React/Vite/Electron gestiscono UI e packaging. Il runtime usa depcheck in un worker dedicato per la scansione dipendenze; il Renderer usa `react-markdown`/`remark-gfm` per messaggi completati. Versioni e percorsi transitivi si verificano sui manifest installati.

## Python Sidecar

FastAPI/Pydantic espongono REST, LanceDB e Arrow conservano i dati, pandas/openpyxl/xlrd leggono tabelle, PyMuPDF/python-docx elaborano documenti e RapidOCR/ONNX Runtime eseguono OCR. La build CPU usa un ambiente separato dal venv di sviluppo con GPU.

## Residui attuali

Gli interventi compatibili upstream per braces, sprintf-js, la cache HTTP del builder e il sanitizer incorporato in Monaco sono aperti nel [tracker](../PROJECT_STATUS.json). Il worker limita e isola la scansione, ma non corregge il pacchetto braces. La cache HTTP Got del builder resta disabilitata; il controllo dell'artefatto scaricato è separato. La presenza di un pacchetto vulnerabile non dimostra da sola un input sfruttabile nell'app. Rivedere la catena di chiamata e l'advisory ufficiale prima di cambiare lockfile o confini di esecuzione.

## Evidenze datate

## Node/Electron

[Evidenza e fonti](./libraries-history-2026-10-13.md#nodeelectron).

## Python Sidecar

[Evidenza e fonti](./libraries-history-2026-10-13.md#python-sidecar).

## DOMPurify dependency remediation — 2026-10-02

[Evidenza e fonti](./libraries-history-2026-10-13.md#dompurify-dependency-remediation--2026-10-02).

## Dependency audit snapshot — 2026-10-05

[Evidenza e fonti](./libraries-history-2026-10-13.md#dependency-audit-snapshot--2026-10-05).

## Dependency remediation and residuals — 2026-10-06

[Evidenza e fonti](./libraries-history-2026-10-13.md#dependency-remediation-and-residuals--2026-10-06).

## Build download cache disposition — 2026-10-06

[Evidenza e fonti](./libraries-history-2026-10-13.md#build-download-cache-disposition--2026-10-06).

## Dependency scanner isolation — 2026-10-10

[Evidenza e fonti](./libraries-history-2026-10-13.md#dependency-scanner-isolation--2026-10-10).

## Chat Markdown dependencies — 2026-10-11

[Evidenza e fonti](./libraries-history-2026-10-13.md#chat-markdown-dependencies--2026-10-11).

## Controlli

[Evidenza e fonti](./libraries-history-2026-10-13.md#controlli).

## sprintf-js exposure disposition - 2026-10-13

[Evidenza e fonti](./libraries-history-2026-10-13.md#sprintf-js-exposure-disposition---2026-10-13).
