# Dipendenze

## Node/Electron

- React, Vite, Electron, Tailwind e Monaco: UI e packaging.
- `gpt-tokenizer`: stima BPE del contesto.
- `zod`: contratti delle risposte strutturate.
- `diff`: diff delle proposte di modifica.
- `p-queue`: coda dei task Main.
- `turndown`, `cheerio`: conversione web in Markdown.
- `playwright`: validazione browser. Il terminale usa PowerShell tramite `PersistentPowerShellSession`, senza dipendenze native aggiuntive.

## Python Sidecar

- FastAPI/Uvicorn/Pydantic: HTTP e validazione.
- LanceDB/NumPy/Pandas: persistenza e dati vettoriali.
- openpyxl e xlrd: motori Excel espliciti per XLSX e XLS, inclusi nel bundle PyInstaller.
- Arrow: dipendenza diretta per Parquet; PyInstaller include esplicitamente `pyarrow.parquet`.
- PyMuPDF, python-docx, Pillow, RapidOCR (`rapidocr` 3, modelli PP-OCRv6 nel wheel), OpenCV (`opencv-python`, la build richiesta da `rapidocr`) e ONNX Runtime GPU: parsing/OCR.
- `wordfreq`, `symspellpy`, `langdetect`: vocabolario e normalizzazione.

Versioni e vincoli sono nei manifest [`package.json`](../package.json), [`sidecar/requirements.txt`](../sidecar/requirements.txt) e [`sidecar/constraints.txt`](../sidecar/constraints.txt). Non duplicarli nella documentazione.

## DOMPurify dependency remediation — 2026-10-02

The existing npm override now requires DOMPurify 3.4.16 or newer compatible 3.x; npm 11 regenerated the lockfile and changed exactly one installed package (3.4.14 to 3.4.16). `npm install --ignore-scripts --no-fund` reports zero vulnerabilities; `npm explain dompurify` verifies Monaco's resolved dependency. Build passes before and after the update. [Upstream advisory GHSA-p98j-92pf-mc4p](https://github.com/cure53/DOMPurify/security/advisories/GHSA-p98j-92pf-mc4p), checked 2026-10-02, identifies 3.4.16 as the patch for alert 25.

Runtime review found an independent vendored DOMPurify 3.4.8 inside Monaco's ESM `domSanitize.js` path. The npm override does not replace that embedded implementation, and the renderer bundle is unchanged by this dependency-only update. Reviewed Monaco calls sanitize strings or fragments, without `IN_PLACE`; its `afterSanitizeAttributes` hook removes attributes, not nodes. The alert's specific exploit prerequisites were not found in this app path. This is not a general security certification of the old embedded copy: upstream update or scoped bundle resolution and real-editor verification remain tracked separately as `DEPENDENCY-MONACO-VENDORED-SANITIZER-01`. The patched lockfile was committed/pushed to `origin/master` in `f84cb6f` on explicit request. Authenticated GitHub API verification confirms [alert 25](https://github.com/dennidalpos/OnlyRagV2/security/dependabot/25) **fixed**, with `fixed_at=2026-10-02T20:10:59Z` (22:10:59 Europe/Rome); no alert was dismissed. The independent embedded Monaco sanitizer remains tracked.

## Dependency audit snapshot — 2026-10-05

At the 2026-10-05 audit, `npm audit --json` exited 1 with **six high package findings from two root advisories**. `braces` reaches the production Main dependency scanner through `depcheck` and the development graph tool through `skott`; `http-cache-semantics` is in the development packaging/download chain. The GitHub advisories checked on that date listed no patched versions, despite npm's suggested downgrade/fix metadata. Compatible remediation and actual exposure review are tracked separately in `DEPENDENCY-BRACES-REMEDIATION-01` and `DEPENDENCY-BUILD-CACHE-REVIEW-01`; no dependency or lockfile changed. This dated result supersedes the historical zero-vulnerability snapshot above without reopening the fixed DOMPurify alert; it is not a fresh advisory check on every later documentation update. Exact paths, official advisory links and limitations: [repository audit](./repository-residue-audit-2026-10-05.md#findings).

The Sidecar log bypass found on 2026-10-05 is corrected on 2026-10-06: complete stdout/stderr lines pass through the existing Main sanitizer before diagnostics and `sidecar.log`, including EOF tails and split credentials. The file writer also sanitizes direct callers before appending; rotation retains these sanitized records. Retrieval logs query length/top-k, never the query body. Log-write failures emit a sanitized warning. Existing historical logs and unredacted live diagnosis artifacts are not rewritten or removed; their preservation policy remains. [Verification](./verification.md#sidecar-log-privacy--2026-10-06).

## Dependency remediation and residuals — 2026-10-06

Fresh `npm audit --json` reported **19 package findings: 8 high, 11 moderate**, from six root advisories. The current reviewed advisories explicitly identify patches for [compression](https://github.com/advisories/GHSA-vc2v-76pw-4v95), [source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) and [smol-toml](https://github.com/advisories/GHSA-r4xh-jqrq-34v2). `npm update compression source-map-js smol-toml --ignore-scripts --no-fund` regenerated the lockfile within existing dependency constraints: compression 1.8.2, source-map-js 1.2.2 and smol-toml 1.9.0. The compression patch adds its upstream `destroy` dependency; direct manifest ranges and integrity checks are unchanged. npm's [update semantics](https://docs.npmjs.com/cli/v11/commands/npm-update/) were checked before updating. No force fix, override, downgrade or vendor edit was used.

Afterward, audit still exits **1** with **16 package findings: 6 high, 10 moderate**, from three root advisories: [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [http-cache-semantics](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) and the newly tracked [sprintf-js](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). Each official advisory still declares no patched version on 2026-10-06; a registry version outside a listed affected range is not alone proof of a reviewed fix. The first two tasks remain open, and `DEPENDENCY-SPRINTF-REMEDIATION-01` records the new residue. sprintf-js reaches production depcheck through js-yaml/argparse and the optional development packaging chain through global-agent/roarr. No application exploit was demonstrated.

Production scanner review found fixed ignore patterns and default parser globs. findup-sync receives literal `package.json` and avoids its glob branch on that call. Development skott accepts operator-supplied patterns. These inspected paths do not establish an attacker-controlled braces pattern. The scanner's existing `Promise.race` timeout cannot preempt synchronous parsing or cancel the scan, and its timer is not cleared; bounded worker/process isolation or a reviewed dependency replacement remains an implementation decision in `DEPENDENCY-BRACES-REMEDIATION-01`. Packaging/download cache exposure remains in `DEPENDENCY-BUILD-CACHE-REVIEW-01`. [Verification and limits](./verification.md#dependency-security-patches--2026-10-06).

## Controlli

`npm run quality:static` (errori di lint Biome, format-check Biome di ogni file incluso da `biome.json`, guard IPC e di layering; `noExplicitAny` è un errore in ogni file, test compresi (il JSON non fidato ai confini usa l'alias documentato `UntrustedJson` di `shared/types`; i doppi di test usano tipi espliciti, `as unknown as T` o `as never`); i `catch` usano `unknown` con [`errorMessage`](../shared/domain/errors/errorMessage.ts)), `npm run audit:deadcode` e `npm run audit:cycles` coprono qualità, export orfani e dipendenze circolari. `audit:deadcode` esegue knip due volte: la modalità normale conta anche i test come entry, `--production` solo le entry marcate `!` in [`knip.json`](../knip.json), così un export usato solo dai test risulta orfano; gli hook di test voluti (reset di cache, `__testing`) portano il tag JSDoc `@internal`. I log passano da [`logRedactor.ts`](../electron/logRedactor.ts).
