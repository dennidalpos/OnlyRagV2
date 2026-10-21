# Dipendenze e limiti noti

Il [seguito locale del 21 ottobre](./verification-tracker-completion-2026-10-21.md) aggiorna Vite a **8.2.4** per l'[advisory Windows editor-launch](https://github.com/vitejs/launch-editor/security/advisories/GHSA-698v-4r3x-3vcv): installazione pulita, audit, editor/dev-server Windows, suite complete, build e smoke Main passano. L'upstream `braces` resta 3.0.3 al controllo corrente; il fork locale resta necessario. Questi esiti sostituiscono i conteggi operativi dei resoconti datati sotto.

Il [seguito del 20 ottobre](./verification-monaco-sanitizer-2026-10-20.md) sostituisce nel bundle il sanitizer incorporato di Monaco con DOMPurify 3.4.17 esatto e aggiunge una regressione Chromium/Electron ai gate CI. La sostituzione è verificata nel grafo di build; l'override da solo non bastava. Monaco resta 0.56.0: la candidata 0.57.0 contiene ancora DOMPurify 3.4.15. `braces` upstream resta 3.0.3 al nuovo readback del registro: il fork rimane necessario.

Le dipendenze correnti sono in [package.json](../package.json), [package-lock.json](../package-lock.json), [requirements.txt](../sidecar/requirements.txt) e [constraints.txt](../sidecar/constraints.txt). Non usare i conteggi degli audit datati come stato corrente. La distribuzione richiede l'inventario reale dei componenti: [distribution.md](./distribution.md).

## Node/Electron

React/Vite/Electron gestiscono UI e packaging. Il runtime usa depcheck in un worker dedicato per la scansione dipendenze; il Renderer usa `react-markdown`/`remark-gfm` per messaggi completati. Versioni e percorsi transitivi si verificano sui manifest installati.

## Python Sidecar

FastAPI/Pydantic espongono REST, LanceDB e Arrow conservano i dati, pandas/openpyxl/xlrd leggono tabelle, PyMuPDF/python-docx elaborano documenti e RapidOCR/ONNX Runtime eseguono OCR. La build CPU usa un ambiente separato dal venv di sviluppo con GPU.

L'[audit Python del 2026-10-15](./python-dependency-audit-2026-10-15.md) confronta il lock del candidato CPU con il manifest e interroga PyPI e OSV tramite `pip-audit` per 69 pacchetti release e 81 di sviluppo: nessun advisory noto nei quattro risultati datati. La verifica non copre vulnerabilità di librerie native incorporate o advisory futuri.

## Residui attuali

Il [riesame del 16 ottobre](./dependency-remediation-2026-10-16.md) elimina tutte le copie di `sprintf-js` e applica una patch locale tracciata a `braces`: il risultato dell'audit npm non sostituisce le prove della patch. Restano nel [tracker](../PROJECT_STATUS.json) la sostituzione futura del fork con upstream verificato e il sanitizer incorporato in Monaco. Il worker di scansione conserva i propri limiti indipendenti. La cache HTTP Got del builder resta disabilitata; `http-cache-semantics` è alla 4.3.0, fuori dall'intervallo dell'advisory contestato dal manutentore ([riesame e limiti](#riesame-dependabot-del-15-ottobre-2026)). Il controllo dell'artefatto scaricato è separato. Rivedere catena di chiamata e advisory ufficiali prima di cambiare lockfile o confini di esecuzione.

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

## Residui ricontrollati — 19 ottobre 2026

Il registro npm ufficiale restituisce ancora `braces` 3.0.3 come ultima release: la sostituzione del fork locale resta aperta, senza modifiche al lockfile. Monaco 0.56.0 conserva DOMPurify **3.4.8** in `esm/vs/base/browser/dompurify/dompurify.js`: l'override npm non modifica quei byte. La rilettura delle fonti upstream aggiunge tre advisory del 12 ottobre, tutti con patch dichiarata in 3.4.17: [SMIL/XHTML GHSA-c6gr-qvv4-5v3f](https://github.com/cure53/DOMPurify/security/advisories/GHSA-c6gr-qvv4-5v3f), [hook IN_PLACE GHSA-mrv2-3pqr-j5jr](https://github.com/cure53/DOMPurify/security/advisories/GHSA-mrv2-3pqr-j5jr), [template/shadow root GHSA-cg2g-xh64-v4q7](https://github.com/cure53/DOMPurify/security/advisories/GHSA-cg2g-xh64-v4q7).

Il percorso Monaco osservato usa frammenti DOM e hook; non è stata eseguita una nuova qualifica nell'editor reale per questi tre casi. La presenza della versione nell'intervallo interessato non dimostra da sola l'esposizione dell'app alle configurazioni specifiche descritte. `DEPENDENCY-MONACO-VENDORED-SANITIZER-01` resta aperto per mappare le condizioni, qualificare eventuale sostituzione e regressioni dell'editor; nessuna mitigazione o assenza di vulnerabilità viene dichiarata per questo riesame documentale.

## Controlli

[Evidenza e fonti](./libraries-history-2026-10-13.md#controlli).

## sprintf-js exposure disposition - 2026-10-13

[Evidenza e fonti](./libraries-history-2026-10-13.md#sprintf-js-exposure-disposition---2026-10-13).

## Riesame Dependabot del 15 ottobre 2026

Gli avvisi aperti verificati tramite API GitHub sono `braces` (alto, GHSA-vfj7-8cjw-p6xm), `http-cache-semantics` (alto, GHSA-ch52-4w7c-c8xp) e `sprintf-js` (moderato, GHSA-hp3w-g68c-fv3c). Le 16 segnalazioni iniziali di `npm audit` includono i pacchetti dipendenti: non sono 16 advisory distinti.

`npm update http-cache-semantics --ignore-scripts --no-fund` aggiorna esclusivamente la dipendenza transitiva di sviluppo da 4.2.0 a 4.3.0, compatibile con `cacheable-request` 7.0.4 (`^4.0.0`). Il manifest resta invariato; npm rigenera URL e integrità nel lockfile. L'audit successivo non segnala più questo pacchetto e riporta 15 pacchetti coinvolti (5 alti, 10 moderati), radicati nei due advisory residui.

La versione 4.3.0 è fuori dall'intervallo dell'[advisory cache](https://github.com/advisories/GHSA-ch52-4w7c-c8xp), ma questo non certifica una correzione del comportamento `max-stale`: l'advisory non indica una prima versione corretta e il [manutentore contesta la segnalazione](https://github.com/kornelski/http-cache-semantics/issues/56#issuecomment-5975759591). Il [cambio upstream](https://github.com/kornelski/http-cache-semantics/commit/9fb520be70eff3ff502fe965d9c3265ca2c64e26) riguarda invece `Vary`. Il controllo locale del downloader conferma cache HTTP disabilitata, assenza di riutilizzo dei cookie di risposta, riuso degli artefatti verificati e rifiuto di cache corrotta/checksum errato. Il task `DEPENDENCY-BUILD-CACHE-UPSTREAM-01` è chiuso per aggiornamento fuori intervallo e verifica della configurazione, senza dichiarare una patch del comportamento contestato.

Per [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) e [sprintf-js](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), advisory e registro npm confermano ancora nessuna versione corretta disponibile (ultime versioni 3.0.3 e 1.1.3). Restano aperti i rispettivi task upstream. L'isolamento del parser in worker e i controlli di esposizione del formatter sono mitigazioni limitate, non eliminano i pacchetti vulnerabili. Nessun downgrade forzato o esclusione degli avvisi è applicato. [Ricevuta dei controlli](./verification-2026-10-15.md#riesame-dependabot).
