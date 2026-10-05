# Tabular fixtures

`ragged.xls` is the genuine BIFF workbook from the [xlrd test corpus](https://github.com/python-excel/xlrd/blob/60c4cff7b003234ea88fe933cf98a86588e830fb/tests/samples/ragged.xls), revision `60c4cff7b003234ea88fe933cf98a86588e830fb`.
SHA256: `a144c284163641c2cb7dfc17d0116006aeffc3dff2b4878f039d4dbab6e2b07e`.
Its BSD license is retained in `xlrd-LICENSE.txt`.

Sheet1 contains the source rows `a,b,c`, `d,e`, `f`, `g,h,I,j`, and `k,,,l`; Sheet2 and Sheet3 are empty. Tests assert first and last rows as well as trailing cells.
XLSX fixtures are generated with openpyxl in pytest temporary directories. Expected cells include leading-zero codes, numeric amounts, literal `NA`, a second sheet, and a single-cell workbook. No fixture needs Microsoft Excel or a live model.

`content-acceptance-it-en.json` is the version-1 synthetic content oracle frozen before local inference. It defines eight documents, twelve queries, eleven supporting passages, six labeled normalization pairs and two live normalization inputs. Generated originals and complete raw outputs belong to new isolated OnlyRag-Live campaigns, rather than this fixture directory. [Acceptance policy and honest failed baseline](../../../docs/content-acceptance.md) distinguish fixture mechanics, real retrieval, independent source review and unqualified desktop/model roles. Do not change expected evidence to match generated answers.

`normalization-whitespace-policy.json` records the explicit 2026-10-02 approval separately from the frozen semantic oracle. Faithful lexical repairs remain semantically safe labels but intentionally require review. New campaigns copy this overlay and report both policy decisions and raw semantic false-rejection counts; old campaigns retain their original policy.

`translation-fidelity-it-en.json` freezes four complete source/expectation pairs before inference: scanned Italian postal instructions, native Italian refund/deadline clauses, English DOCX imperatives and native English storage conditions. The desktop collector retains complete source/output and PDF renders outside the repository. The independent review gate fails on lost or added meaning; export success alone is insufficient. [Translation verification](../../../docs/verification.md#translation-follow-up--2026-10-05).
