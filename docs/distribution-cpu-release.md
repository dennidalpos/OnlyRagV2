# Approved CPU release implementation — 2026-10-11

The owner explicitly approved the [CPU AGPL proposal](./distribution-agpl-proposal.md). Its build/capability implementation is complete. Licensing and full current-source runtime qualification remain open in [PROJECT_STATUS.json](../PROJECT_STATUS.json). Nothing is published, installed over a personal profile, committed or pushed.

## Build contract

Use `npm run package:win` on Windows with Node 24/npm 11 and Python 3.13. `scripts/build_package.ps1` uses `build/release-cpu/venv`, `sidecar/requirements-release.txt` and CPU `onnxruntime==1.29.0`. Development requirements retain `onnxruntime-gpu[cuda,cudnn]`; external Ollama is unchanged. CPU runtime lists Azure and CPU providers, with no CUDA/TensorRT provider. The build refuses installed NVIDIA/GPU packages and forbidden final library names.

Every invocation writes a new `release/cpu-<UTC>-<id>` child. The original `sidecar_dist/sidecar`, legacy `release/win-unpacked` and installers are preserved. `-SkipSidecar` now refuses before creating output. `-RequireSignature` requires a valid Authenticode signature; the default still permits an explicitly reported unsigned candidate. Use this wrapper rather than calling electron-builder directly: it generates the fresh Sidecar/resources/configuration and uses `--publish never`. [PyInstaller specification documentation](https://pyinstaller.org/en/stable/spec-files.html), [electron-builder configuration](https://www.electron.build/configuration.html).

NSIS displays the full AGPL terms. About shows the grant, redistribution/no-warranty notice and a fixed-path action for `resources/licenses/`. A shell error is displayed instead of reported as success. Installed resources retain MIT/component grants, full AGPL/Apache/CC BY-SA/OFL texts, Python/Electron/Chromium notices, wordfreq credits and collected package notices. Font metadata binds five exact hashes, Noto Sans 2.015 and Noto Sans CJK 2.004 copyrights/versions to both OFL texts. Pinned native archive notices also preserve the Droid fallback copyright/Apache terms and bind its exact runtime font hash (ee38813ea00c3e32add4268fff7fff9e39417b4913cb13be2415164a47807cc2). This notice inventory is a build-environment superset, not proof of complete final-component rights coverage.

## Source and artifact identity

Before building the installer, `scripts/release_artifacts.py` creates `OnlyRag-1.0.0-source.zip` from the actual project snapshot, dependency sdists, installed source/assets where no sdist exists, pinned ORT/MuPDF/LanceDB source archives, Node package sources and exact Python lock. Installed `SOURCE-DELIVERY.txt` identifies this archive and SHA-256. `component-manifest.json`, `project-source-manifest.json`, `source-delivery.json` and `release-manifest.json` bind the build environment, project snapshot, notices, archive, installer and installed file hashes. Finalization checks installed notice readback and refuses forbidden GPU libraries. Public distribution is explicitly unqualified.

The original successful CPU candidate is `release/cpu-20261010-213500-98bd02c4`. A second candidate, `release/cpu-20261010-214729-19e3a54a`, includes Python/font notices and the shell error fix: 3,443 installed files, installer 416,762,104 bytes, SHA-256 `45fff0b2b29e48b8873857ae773e76722b9b347d10bfd2891788f5232ea74ccb`, Authenticode `NotSigned`. Both are retained. The third candidate, release/cpu-20261010-220722-4231bc47, includes the PDF fix (installer SHA-256 3b29eb3b657e9f44e5700b13e4645e20fc975835dc7e9e67d1df3976f18752f5). Native archive review also binds MuPDF's embedded Droid fallback font byte-for-byte to its official source and accompanying Apache copyright/terms. The final build includes those and other retained native archive notices; readback is recorded below.

## Native failure and correction

The second candidate passes frozen startup, CPU health and authenticated/unauthenticated export transport. Actual source RapidOCR on a generated image returns `ONLYRAG CPU 12345`, without CUDA or any Ollama request. Its PDF converts 日本語 to ???. The unmodified source baseline reproduces that loss, so it predates CPU packaging. Failed PDFs, OCR input/output, frozen log and `failure-evidence.json` remain under its `qualification-4bee67a1` child; the owned process was stopped.

Focused baseline tests reproduce Unicode loss, disappearance of a long paragraph and loss of an unclosed code block: 3 failures / 2 passes. The old fixed-height PDF textboxes are replaced by existing PyMuPDF Story page flow, with Unicode font fallback, existing heading/list/table/code handling and escaped input. No new parser dependency or file/URL resource loading is introduced. [Official Story API](https://pymupdf.readthedocs.io/en/latest/story-class.html) documents the layout/page callback and Unicode rendering engine. Unsupported glyphs/layouts are not universally certified by the retained fixtures.

Corrected source: `.venv\Scripts\python.exe -m pytest sidecar/tests/test_compression.py sidecar/tests/test_sidecar.py -q --tb=short` passes **63 tests**. The separately reproduced shell.openPath false-success defect is fixed; SystemAppService/Preload/About targeted Vitest passes **21 tests in 3 files**. Build, static and native final-candidate results are recorded separately below.

Run `build/release-cpu/venv/Scripts/python.exe scripts/e2e/cpuReleaseProbe.py --release-root release/cpu-<UTC>-<id>` against a retained candidate. It verifies installed file hashes, uses private source/frozen state, checks port ownership before sending requests, and stops only its own process. Its scope is actual **source CPU OCR** and **frozen startup/auth/Unicode PDF export**, without Ollama calls. Frozen OCR inference and complete restarted Electron/RAG qualification remain separate.

## Remaining tracker gates

- `DISTRIBUTION-LICENSE-POLICY-01`: complete preferred/native/vendored/submodule sources and wheel build correspondence; final Renderer/Main/native rights/notices versus the build-environment superset; upstream font/model provenance; installation-information and remote source-offer applicability; equivalent-access public source delivery. Archive capture is not complete corresponding-source certification.
- `DISTRIBUTION-CURRENT-SOURCE-QUALIFICATION-01`: frozen OCR, recovery, versioned embeddings, supported parsers, normalization/translation and restarted desktop qualification on the same final artifact. Existing semantic failures remain retained; source/native mechanical checks do not authorize another model campaign.
- `DISTRIBUTION-PACKAGE-SIZE-01`: record measured footprint against the preserved legacy installer and qualify frozen native OCR/assets before closing the product-size task. CPU source OCR does not prove packaged OCR performance or parity.
- `DISTRIBUTION-UPDATE-PATH-01`: actual isolated upgrade/readback/rollback remains pending. No automatic updater or publication was introduced.

## Final candidate readback

[Retained qualification receipt](./licenses/cpu-release-2026-10-11.json) binds the final candidate `release/cpu-20261010-221255-760103bf` and its `qualification-920c97df/result.json` to these identities:

| Artifact | Bytes | SHA-256 / result |
| --- | ---: | --- |
| NSIS installer | 416,792,773 | `2ba7b03e2fc69e9a40f32538ef93af0c36f902fafef553d01f5b91c78aaf62bb`; Authenticode `NotSigned` |
| Adjacent source candidate | 848,539,334 | `32c6a70fdb7e8f76f8f36221e251bebfbc7ec95da542f7375b52ee33a9c96d59` |
| Installed file inventory | 1,245,162,970 | 3,461 files; all installed hashes checked by the native probe; no forbidden GPU libraries |
| Native notice inventory | — | 18 pinned-source notice files, installed byte readback verified; embedded Droid font matches official source |

`build/release-cpu/venv/Scripts/python.exe scripts/e2e/cpuReleaseProbe.py --release-root release/cpu-20261010-221255-760103bf` exits **0**. Actual source CPU OCR returns `ONLYRAG CPU 12345`; frozen health reports `CPUExecutionProvider` and zero documents; unauthenticated export returns **401**; authenticated PDF extraction contains `ONLYRAG CPU 12345` and `日本語`. The owned Sidecar is stopped after the check. No Ollama request or personal profile is used. Frozen OCR inference and installed/restarted Electron remain unverified.

The final packaging wrapper exits **0**, including typecheck, PyInstaller, Renderer/Main build, isolated Electron bundle smoke, source capture, NSIS creation and manifest finalization. Native collection reports expected missing optional TensorRT and an upstream optional PyTorch SyntaxWarning; those are not GPU/runtime qualification. Runtime versions are Node **24.20.0**, npm **11.19.0**, Python **3.13.15**, Electron **43.7.4**, CPU ORT **1.29.0**, PyMuPDF/MuPDF **1.28.2**. The installed full AGPL text's hash also matches COPYING in the retained official MuPDF 1.28.2 source archive; native wheel build correspondence remains separately unverified.

The preserved legacy installer is 1,561,938,087 bytes; the final CPU installer is **73.32% smaller**. Logical installed file bytes fall from 3,031,696,569 (2,509 files) to 1,245,162,970: **58.93% smaller**. These measurements exclude the separately delivered source archive and do not measure allocated disk space, OCR speed or capability parity. The package-size task remains open for its frozen OCR/license gates.

All **91** previously bound legacy/development file pairs are unchanged; original Sidecar and ASAR identities remain unchanged. The source snapshot contains **984** project files; all matched the working tree before recording post-build qualification documentation. The archive retains that exact build snapshot; this subsequent receipt/documentation update is independent retained verification evidence. Complete candidate directories and the failed Unicode probe remain preserved. Only the two empty directories from this session's initial switch-binding failures are removed nonrecursively after ownership/path/emptiness checks.

Source defects found and corrected in this phase are complete, so no duplicate PDF or shell-error backlog entry remains. The four release parent gates listed above remain open with concrete residues; preparation/build/native partial checks do not close them. Final documentation/static checks pass; no publication, commit or push.
