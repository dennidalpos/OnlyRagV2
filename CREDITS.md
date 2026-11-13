# Third-party credits — OnlyRagV2

Reviewed on 13 November 2026. Original OnlyRag source is **MIT**, as declared in [LICENSE](LICENSE) and package.json. The existing [distribution policy](DISTRIBUTION-LICENSE.md) conveys the combined application containing PyMuPDF/MuPDF under AGPL version 3 while preserving component-specific grants. This review does not change that policy or certify a release.

## Scope and complete register

The [component register](docs/licenses/current/components-2026-11-13.md) lists each component, exact observed version, SPDX declaration or assessment, evidence status, source URL, original notices and obligations. The [JSON inventory](docs/licenses/current/inventory-2026-11-13.json) binds the package/recipe inputs and retained texts by SHA-256.

The source/runtime-input inventory contains **271 npm package records**, **62 Python runtime dependency records**, Electron and CPython, five Noto fonts, the Codicons font, wordfreq data and **three OCR model records with unresolved exact-release rights**. It separately records 11 project branding/documentation images whose original rights provenance has not been established. These image records are review items, not claims that the images are third-party runtime dependencies.

This is a register of current source and CPU packaging inputs, **not an inventory of a newly built installer**. Python versions come from the installed development environment except onnxruntime 1.29.0, whose CPU package metadata and license were checked upstream; that CPU wheel is not installed here. Dependency closure does not prove that every file enters a frozen executable. Native components, the actual installed artifact and source delivery remain unqualified.

Build-only npm dependency trees, Python test/installation tools, onnxruntime-gpu and NVIDIA CUDA/cuDNN are excluded from the CPU runtime entries. Vite's emitted helpers and Tailwind's emitted CSS retain their own notices without importing their build-tool dependency trees into this register. PyInstaller's embedded bootloader/runtime hooks are addressed separately below.

## Notices and attribution

Original license, copyright and applicable notice files are retained byte-for-byte under [the register's text directory](docs/licenses/current/texts/); each component links to its exact texts. These copies retain upstream attribution rather than replacing it with a generic license template.

Links in this source document use the repository layout, also intended for the corresponding-source archive. In an installed candidate, consult the adjacent original notices in python/, node/, Codicons-LICENSE.txt and Electron-LICENSES.chromium.html; copying CREDITS alone does not carry every linked source document into the installer.

| Component | Version / identity | License / attribution | Status and obligation |
| --- | --- | --- | --- |
| Local braces fork | 3.0.4+onlyrag.1, based on upstream 3.0.3 | MIT; Copyright (c) 2014-present, Jon Schlinkert | Preserve [original terms](vendor/braces-3.0.4/LICENSE) and local modification provenance. |
| PyMuPDF / MuPDF | PyMuPDF 1.28.2 | AGPL-3.0 or separate Artifex commercial terms | No commercial grant is asserted. Preserve full AGPL/notices and assess corresponding source under the existing distribution policy. Exact native correspondence remains open. |
| wordfreq code | 3.1.1 | Apache-2.0; Copyright 2022 Robyn Speer | Preserve the code notice and Apache terms. |
| wordfreq frequency data | 3.1.1 | CC-BY-SA-4.0 | Preserve [exact-release dataset attribution](docs/licenses/agpl-route-2026-10-10/wordfreq-3.1.1-data-attribution.txt), [terms](docs/licenses/agpl-route-2026-10-10/CC-BY-SA-4.0.txt) and applicable change/share-alike notices. Code and data have separate terms. |
| Noto Sans | Font version 2.015; SHA-256 in register | OFL-1.1; Copyright 2022 The Noto Project Authors | Preserve the font copyright and OFL. |
| Noto Sans CJK JP/KR/SC/TC | Font version 2.004; four separate SHA-256 records | OFL-1.1; © 2014-2021 Adobe | Preserve the embedded copyright and OFL; review reserved-name conditions if modified. |
| Codicons font in Monaco | Exact bytes match @vscode/codicons 0.0.46-21 | Microsoft Corporation and contributors; CC-BY-4.0, with the package's CC-BY-3.0 exception for Jason Long's Git Logo | Preserve [the exact package license and exception](docs/licenses/current/texts/af5e030844efddbc7ab00dcfea8b019703753d4d9f5172d727c533a492aec665.txt). The CSS's MIT banner does not substitute for font attribution. Font bytes are unchanged. |
| DOMPurify | 3.4.17 | MPL-2.0 **OR** Apache-2.0 | Preserve the offered terms and notices. The alternative is recorded without selecting a new licensing policy. |
| certifi / tqdm | 2026.10.19 / 4.70.1 | MPL-2.0 / MPL-2.0 AND MIT | Preserve package terms and assess covered-file source obligations. |
| Electron / Chromium | Electron 43.8.3; runtime HTML notice hash in register | MIT plus component-specific Chromium terms | The release collector copies Electron's full LICENSES.chromium.html into resources/licenses/; the 20 MB multi-component notice is not replaced by this summary. |
| CPython | 3.13.17 observed locally | Python license bundle | Preserve the exact runtime license bundle; qualify the interpreter/native files actually shipped. |

PyInstaller 6.22.2 is pinned as a build tool. Its [versioned upstream terms](https://github.com/pyinstaller/pyinstaller/blob/v6.22.2/COPYING.txt) distinguish GPL-2.0-or-later WITH Bootloader-exception for the embedded bootloader/loader and Apache-2.0 for runtime hooks. The compiler's GPL label alone neither establishes a conflict nor establishes the rights of the application's other dependencies. No newly built bootloader is claimed by this review.

## Corrected metadata and unresolved originals

- **langdetect 1.0.9:** the metadata's MIT field conflicts with the included Apache-2.0 texts and classifier. The register uses the actual Apache texts and retains both notices.
- **locate 1.1.1:** its proprietary classifier conflicts with its included MIT license. The register records the MIT text, including its original copyright.
- **boolbase 1.0.0, callsite 1.0.0 and deps-regex 0.2.0:** original full notices/copyright attribution remain missing. Package metadata declares ISC/MIT; callsite's README declares MIT. Existing [provisional notices](docs/licenses/provisional-node/) remain explicitly provisional and are not promoted to verified upstream grants.
- RapidOCR code terms are recorded separately from the three installed OCR weights, whose names and hashes are listed individually with SPDX NOASSERTION pending exact-release rights and conversion provenance. ONNX sample networks and final artifact-level attribution remain unresolved. The inventory also hashes 136 native package members with NOASSERTION for independently unverified native/vendored rights; package-level SPDX declarations are not substituted for those checks.
- The 24 MPL-only npm records in the complete lockfile are not 24 demonstrated shipped components. Runtime entries and multi-license expressions are listed individually in the current register.

## Distribution limits

This source update retains 218 distinct original notice/term byte sequences, with per-component hashes and provenance. The release collector now also recognizes ThirdPartyNotices, carries this CREDITS file, and copies the separately verified Codicons terms after checking the exact font/license hashes. A changed font requires a new attribution review.

The release collector's existing environment-wide notice inventory is a **superset**, not proof of the final bundled inventory. Final ASAR/PyInstaller membership, complete native/transitive notices and matching source, image/model provenance, installation-information applicability and any public source delivery require separate artifact review. No installer was rebuilt, installed or published for this update. See [the historical distribution review](docs/distribution-licenses.md) for retained evidence and its stated limits.
