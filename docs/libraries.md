# Dipendenze e limiti noti

Riesame documentale del **22 ottobre 2026**. Versioni e provenienza si ricavano da [package.json](../package.json), [package-lock.json](../package-lock.json), [requisiti comuni](../sidecar/requirements-common.txt) e [vincoli Python](../sidecar/constraints.txt). La baseline della schermata Informazioni è generata da [dependencyVersions.mts](../scripts/dependencyVersions.mts); non interroga Sidecar/Ollama esterni.

## Node/Electron

Il readback locale di lockfile e manifest installati coincide per React 19.2.8, Electron 43.8.3, Vite 8.2.4, Vitest 4.1.11, Monaco 0.56.0, DOMPurify 3.4.17 e `braces` 3.0.4+onlyrag.1. È una fotografia di questa verifica, non un vincolo aggiuntivo al manifest.

La [correzione Monaco](./verification-monaco-sanitizer-2026-10-20.md) sostituisce il sanitizer incorporato nel grafo Vite con DOMPurify esatto. L'override npm da solo non modifica i byte incorporati; [monacoSanitizer.mjs](../scripts/e2e/monacoSanitizer.mjs) è un controllo locale disponibile, senza obbligo CI. Vite è stato aggiornato e verificato nell'[intervento del 21 ottobre](./verification-tracker-completion-2026-10-21.md). Le versioni candidate o gli alert citati nei vecchi audit valgono alle loro date.

## Python Sidecar

FastAPI/Pydantic espongono REST, LanceDB/Arrow conservano dati e vettori, pandas/openpyxl/xlrd leggono tabelle, PyMuPDF/python-docx elaborano documenti e RapidOCR/ONNX Runtime eseguono OCR. Il venv CPU di release è distinto da quello di sviluppo GPU; i [requisiti runtime](../sidecar/requirements.txt) non comprendono necessariamente tutti i [requisiti di test](../sidecar/requirements-dev.txt).

L'[audit critico del 21 ottobre](./critical-application-audit-2026-10-21.md) conserva la qualifica di Electron 43.8.3/Pillow 13.0.0 e inventari/npm/PyPI/OSV datati. Non è un nuovo audit remoto o una garanzia di assenza di vulnerabilità; gli alert del servizio possono avere stato distinto dal checkout. Nessun registro di advisory è stato interrogato in questa revisione documentale.

## Residui attuali

Il [tracker](../PROJECT_STATUS.json) mantiene la futura sostituzione del fork `braces` con upstream idoneo (`npm view braces version` ancora `3.0.3` al 22 ottobre) e l'attribuzione del rifiuto storico dev-server, oltre al determinismo offline della fixture `pnpm` (`TEST-PNPM-OFFLINE-PREPARATION-01`) e al provider OCR effettivo dopo fallback CPU (`OCR-RUNTIME-EFFECTIVE-PROVIDER-01`). Il [rimedio locale del 16 ottobre](./dependency-remediation-2026-10-16.md) rimuove `sprintf-js` e conserva patch/provenienza del fork: non risultano task upstream `sprintf-js` o sanitizer Monaco ancora aperti. Il worker di scansione e la cache HTTP Got disabilitata mantengono i propri confini; una mitigazione non prova la risoluzione upstream.

## Evidenze datate e ancoraggi conservati

I precedenti conteggi, proposte e audit sono nel [registro delle dipendenze](./libraries-history-2026-10-13.md). Le sezioni seguenti mantengono gli ancoraggi usati dai vecchi rapporti.

## DOMPurify dependency remediation — 2026-10-02

[Evidenza storica](./libraries-history-2026-10-13.md#dompurify-dependency-remediation--2026-10-02).

## Dependency audit snapshot — 2026-10-05

[Evidenza storica](./libraries-history-2026-10-13.md#dependency-audit-snapshot--2026-10-05).

## Dependency remediation and residuals — 2026-10-06

[Evidenza storica](./libraries-history-2026-10-13.md#dependency-remediation-and-residuals--2026-10-06).

## Build download cache disposition — 2026-10-06

[Evidenza storica](./libraries-history-2026-10-13.md#build-download-cache-disposition--2026-10-06).

## Dependency scanner isolation — 2026-10-10

[Evidenza storica](./libraries-history-2026-10-13.md#dependency-scanner-isolation--2026-10-10).

## Chat Markdown dependencies — 2026-10-11

[Evidenza storica](./libraries-history-2026-10-13.md#chat-markdown-dependencies--2026-10-11).

## Residui ricontrollati — 19 ottobre 2026

[Evidenza storica](./libraries-history-2026-10-13.md#residui-ricontrollati--19-ottobre-2026).

## Controlli

[Evidenza storica](./libraries-history-2026-10-13.md#controlli).

## sprintf-js exposure disposition - 2026-10-13

[Evidenza storica](./libraries-history-2026-10-13.md#sprintf-js-exposure-disposition---2026-10-13).

## Riesame Dependabot del 15 ottobre 2026

[Evidenza storica](./libraries-history-2026-10-13.md#riesame-dependabot-del-15-ottobre-2026).
