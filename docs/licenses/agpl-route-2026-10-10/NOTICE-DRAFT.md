# Distribution notice draft — not installed or approved

Prepared 2026-10-10 for the [AGPL proposal](../../distribution-agpl-proposal.md). This packet covers the items below; it is not a complete third-party notice manifest or a statement that the retained installer complies. Exact text sources and hashes are in [evidence.json](./evidence.json).

## OnlyRag and PDF components

OnlyRag project code: Copyright (c) 2026 Danny Perondi. Original MIT permission: [repository LICENSE](../../../LICENSE). The proposed covered combined release uses GNU AGPL v3; its final release identity, grant wording, source download and component copyrights remain to be bound. [Full AGPL text](./AGPL-3.0.txt). Preserve PyMuPDF/MuPDF's actual release copyrights/notices separately; those are not replaced by the project copyright. Final interactive notices must include no warranty, redistribution rights and access to these terms and corresponding source.

## wordfreq 3.1.1

Code: Copyright 2022 Robyn Speer, Apache-2.0. Preserve the [code notice](./wordfreq-3.1.1-code-license.txt) and [full Apache terms](./Apache-2.0.txt).

Frequency data: Creative Commons Attribution-ShareAlike 4.0. Preserve [full CC BY-SA terms](./CC-BY-SA-4.0.txt) and [exact-release attribution/citations](./wordfreq-3.1.1-data-attribution.txt). These identify Google Books Ngrams/Syntactic Ngrams, Leeds Internet Corpus, Wikipedia, ParaCrawl, OPUS OpenSubtitles/OpenSubtitles and SUBTLEX authors. SUBTLEX remains freely available data. The extract comes from the 3.1.1 PyPI description and is not claimed to be a release `NOTICE` file. All 66 identified packaged data files are unchanged relative to the compared installation; any subsequent adaptation must carry its own change notice.

## RapidOCR and OCR model artifacts

RapidOCR engineering code belongs to the RapidOCR Authors. Upstream OCR weights belong to Baidu and/or applicable PaddleOCR rights holders. Both use Apache-2.0; preserve the [full license](./Apache-2.0.txt). RapidOCR converts/packages upstream models for ONNX inference; original ownership remains. This application redistributes the compared model bytes unchanged. Names identify provenance without implying endorsement. [Official attribution and conversion record](https://rapidai.github.io/RapidOCRDocs/main/en/model_licenses/), reviewed 2026-10-10.

| Packaged artifact | SHA-256 |
| --- | --- |
| `PP-OCRv6_det_small.onnx` | `090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f` |
| `PP-OCRv6_rec_small.onnx` | `6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884` |
| `ch_ppocr_mobile_v2.0_cls_mobile.onnx` | `e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c` |

Preserve any applicable upstream copyright/NOTICE and modification notices. Exact-release code copyright and complete upstream notice binding remain pending; these three models do not cover unrelated ONNX sample networks, datasets, fonts or inference runtimes.

## Noto fonts and remaining notices

Retained project texts: [OFL for Noto Sans](./OFL-NotoSans.txt), [OFL for Noto Sans CJK](./OFL-NotoSansCJK.txt). Confirm exact font source/version and attach actual copyright notices before packaging. The copied CJK license alone has no copyright header.

Electron/Chromium, Python/native/transitive notices and final corresponding-source delivery are still incomplete. NVIDIA terms are not represented as AGPL grants; the proposal removes those libraries from the standard release, subject to approval and artifact verification. A final notice must identify the actual released components, rather than carrying this draft's pending statements into the product.
