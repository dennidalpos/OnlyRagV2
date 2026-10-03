# Frozen content acceptance

`QUALITY-CONTENT-ACCEPTANCE-01` is complete on 2026-10-02 as a fixed corpus and independent acceptance gate, and removed from the tracker. The application fails that gate. `QUALITY-CONTENT-LIVE-QUALIFICATION-01` retains the failed cases and broader live/desktop qualification; the explicitly approved whitespace-only normalization task is also complete; broader qualification remains tracked.

## Corpus and execution boundary

[Version-1 corpus](../sidecar/tests/fixtures/content-acceptance-it-en.json), SHA256 `f5cbfc6f22c86724583bdd2408dd379e16cc677e79f193e83856c2b2019301dc`, was frozen before inference. It contains eight synthetic documents (TXT, Markdown/code, genuine generated XLSX, CSV and paginated PDF), twelve IT/EN queries, eleven expected supporting passages, six independently labeled source/normalization-output pairs and two real-normalization inputs. Expected evidence includes literal order codes, column meaning, later sheets, page 3 and page 6, paraphrases across languages, conditions, negations, both cancellation alternatives, absent answers, unresolved multi-document contradictions and exact exception code. Five long introductory PDF pages keep page 6 outside the ordinary beginning-only preview.

Generated originals, complete extractions, indexing events, queries, ranks, selected passages, revision-bound locations, requests, raw outputs, source hashes and reviews are retained under `%USERPROFILE%\OnlyRag-Live\content-acceptance-*` (`ONLYRAG_LIVE_ROOT` overrides). Every collection uses a new isolated store; it cannot reuse or migrate a personal index. Generation is restricted to installed `qwen3.5:9b`, thinking off, requested/effective chat context 4096. Actual native `nomic-embed-text:latest` with `nomic-search-v1` supplies vectors. Exact model/runtime identity is captured before execution. [Model profiles](./model-task-baselines.md) and [runtime limits](./model-runtime-fit.md) remain separate.

The Python collector exercises production extraction/indexing/search, not pytest's hash-embedding fixture. It compares dense ranks, full-store pipeline top three, and selected-document pipeline top three separately. The live React harness uses production `useChatEngine` and the real Ollama HTTP client; its IPC facade replays the actual stored retrieval bundle and checks the requested query/document scope/topK. It is an isolated DOM/application-path replay, not a restarted Electron/REST round trip. Repeated passages correctly remain derived and lack an original-location selector; they must not be passed to the original-only navigation endpoint. Unique expected PDF passages have actual original locations.

Six normalization pairs intentionally use declared transport fixtures to measure decisions of the existing conservative guard. Their expected safe/unsafe labels were written independently before execution. The two live normalization cases use the real production normalizer and its existing 25-second budget, 2048-output-token limit and native request options. Missing output is unassessed, not a semantic success or false rejection. No timeout/retry change is allowed to turn a failed campaign into a pass.

Run from the repository:

```powershell
npm run test:live -- scripts/live/contentAcceptance.live.ts
.venv\Scripts\python.exe scripts/live/contentAcceptanceReview.py <retained-campaign-directory>
```

The first command is an evidence collector: successful completion means twelve requests/outputs were captured, not semantic acceptance. The second is the acceptance gate and exits **1** on recorded failures. Infrastructure/partial-collection/hash/review-schema errors also fail instead of silently passing. A reviewer writes `review.json` beside the campaign, naming the independent reviewer, hashing exact `corpus.json`, `preparation.json` and `answers.json`, and recording one content/language/citation decision plus supporting notes per case. Each live normalization output needs a safe/unsafe decision; unavailable output explicitly uses `null` and fails qualification. The evaluated 9B model is never the source of expectations or the sole judge. `acceptance.json` preserves separate counts and hashes.

## Acceptance and critical-path coverage

| Path | Frozen oracle and gate | Explicit limit |
| --- | --- | --- |
| Extraction | Required original cells/clauses and unchanged original hash; compare full retained source/output on failures | Presence checks do not prove full arbitrary-document equivalence. Native OCR/scans/real PDF tables are separate coverage needs. |
| Retrieval | All eleven expected supporting passages must enter both evaluated pipeline shortlists. Report dense recall@1/@3/MRR separately. Absent cases have no invented relevant-passage oracle. | Small declared corpus only; document filtering cannot stand in for whole-store recall. |
| Grounded answers | Every required clause/detail, requested language, immediate supported references and no invented detail; abstain on absent answers and unresolved precedence | Locations/marker validity are mechanics; independent claim-to-source review decides support/completeness. |
| Normalization | Keep semantic false acceptance/rejection against the six frozen labels; compare automatic decisions separately against the retained approved policy, plus complete independent comparison of both real outputs | Faithful lexical repairs intentionally require review. Fixture decisions are distinguished from live model behavior; unavailable output never counts as safe. |
| Context/provenance | Preserve the late page and truthful incomplete-preview notice; original selectors must match revision/page/span; ambiguity stays derived | Complete summaries, wider contexts and desktop navigation remain separate qualifications. |

Do not increase overall coverage floors to hide these gaps. Critical regression coverage needs are literal-cell preservation, malformed-input refusal before embeddings/writes, conservative normalization review/source retention, filter correctness, late-page retrieval, cancellation before dispatch, and reference/support separation. Existing tests cover native mechanics; fixed real-model campaigns and source review cover only their declared content. Larger tables/corpora, OCR variants, additional documents/languages, punctuation/word boundaries, full-document summaries and restarted desktop remain required live coverage.

## Retained pre-fix result — 2026-10-02

Campaign: `content-acceptance-2026-10-02T20-25-20-814Z-6eed60ba`. The earlier `...20-23-43-011Z-9eaf20bb` failed because the new harness requested original navigation for correctly derived repeated text; keep its partial evidence and collection error separate. The corrected collector passes **1 live collection in 112.07s**. Independent source/output review uses the frozen oracle, rather than asking the evaluated model to grade itself. The gate correctly exits **1** with `passed: false`.

| Metric | Pre-fix result |
| --- | --- |
| Extraction critical-content checks | 7/8 documents; CSV loses `0007`, `0008`, literal `NA` |
| Dense recall@1 / recall@3 | 6/11 / 8/11 expected passages |
| Dense MRR | 0.664141 |
| Full-store pipeline recall@3 | 8/11 |
| Selected-document pipeline recall@3 | 10/11 |
| Independent answer content | 9/12 |
| Requested response language | 6/12 |
| Immediate supported citations | 8/12 |
| All three answer criteria | 5/12 |
| Frozen normalization-pair false acceptance / rejection | 2/4 unsafe / 0/2 safe |
| Real normalization | 0/2 assessed; both retain `request_failed` without an output body |

CSV is a reproduced extraction defect, not a model hallucination: source `0007/North/NA` becomes `7/North/nan` before the model sees it. It is corrected in [delimited ingestion](./rag-sidecar.md#csvtsv-literal-integrity--2026-10-02); the failed source, extraction and answer remain unchanged. Cross-language defect reporting ranks its relevant passage **18** in dense search and misses full-store top three; annual-cancellation notice ranks **4** and also misses final top three. Document filtering retrieves both, so successful selected-document answers cannot certify full-store multilingual retrieval.

Page 6 is retrieved, but the answer omits the explicit no-freezing prohibition and does not emit a supplied `[S#]` reference; a free-text filename/page attribution cannot activate source navigation. The exact-code answer adds an unsupported instruction about recalculating an active error. The alternatives/code cases use final source lists instead of references beside the claims. Six answers use Italian despite English question/settings. Correct 21/45-day contradiction handling remains recorded independently from that language failure.

The existing normalization guard accepts the unsafe punctuation pair `The inspector said: the contractor is liable` → `The inspector, said the contractor, is liable`, and the unsafe word split `therapist` → `the rapist`. Ordered alphanumeric equality cannot establish semantic equivalence. Original retention/review protection remains implemented; these failures require a separate policy decision before claiming safe automatic OCR word/punctuation repairs.

The previous retained Nomic preparation corpus and evidence/source-provenance campaigns remain separate baselines. This new corpus does not replace their failed payment/support/storage cases or their mixed-source failure. See [verification history](./verification.md).

## Unchanged-corpus replay after CSV correction

Campaign: `content-acceptance-2026-10-02T20-33-00-561Z-a72af772`. Corpus hash/expectations, model digest, generation context and thinking policy are unchanged. A new isolated store exercises corrected CSV extraction; neither retained campaign is overwritten. The live collector passes **1 collection in 55.39s**; the independent acceptance gate again exits **1**, `passed: false`.

| Metric | Post-fix result |
| --- | --- |
| Extraction critical-content checks | 8/8 documents, originals unchanged |
| Dense recall@1 / recall@3 | 7/11 / 9/11 |
| Dense MRR | 0.754785 |
| Full-store pipeline recall@3 | 9/11 |
| Selected-document pipeline recall@3 | 11/11 |
| Independent answer content | 11/12 |
| Requested response language | 6/12 |
| Immediate supported citations | 8/12 |
| All three answer criteria | 4/12 |
| Frozen normalization-pair false acceptance / rejection | 2/4 unsafe / 0/2 safe |
| Live normalization content/decision | 2/2 complete, independently faithful and accepted; no false acceptance/rejection in these two cases |

The corrected CSV now yields and supports literal `0007/North/NA`. Cross-language defect reporting still misses whole-store top three (dense rank **19**), and annual cancellation still ranks **4** and misses final top three. PDF page-6 no-freezing omission repeats. The replay fixes the prior code-case unsupported extra instruction and the alternatives' final-list reference, but other citation/language placements vary; this does not justify claiming stable model suitability or a global quality improvement. The four jointly accepted answers are later-sheet, absent-penalty, conditional-refund and alternatives. Real normalization captures complete original/output comparisons, with the existing 25-second budget and no added `num_ctx` option; the omitted configured context remains in `DOC-NORMALIZATION-CONTEXT-01`. The preceding two unavailable outputs remain unassessed.

## Approved whitespace-only normalization — 2026-10-02

The user explicitly chose automatic acceptance only for spaces and line wraps preserving words and punctuation. `DOC-NORMALIZATION-AUTO-ACCEPTANCE-01` is implemented and removed from the tracker. Source/candidate token sequences must match exactly, including word boundaries, punctuation, accents, case and identifiers. Only ordinary prose spaces/CR/LF can vary. Code, tables, markup, lists, tabs and other whitespace-sensitive content must remain identical; uncertainty requires review. No custom parser, model judge, new dependency, API, persisted state, migration or timeout/retry change was introduced. The prompt requests the same restricted cleanup; the local guard enforces it independently and no longer removes output code fences before validation. Refusals preserve the complete original in the existing non-indexed review draft, with no embeddings or database writes.

The original corpus bytes, expected answers and semantic-safe/unsafe pair labels remain unchanged. A separate [approved policy overlay](../sidecar/tests/fixtures/normalization-whitespace-policy.json), copied into each new campaign, records expected automatic decisions. Both faithful lexical pairs deliberately require review; their raw semantic false-rejection counts remain visible. Historical campaigns retain their original policy and gate. This explicit approved contract change does not relax retrieval, language, citation, completeness or unsafe-acceptance requirements.

Verification: relevant pre-edit baseline **31 passed in 6.38s**; the previous guard fails **11** newly approved-policy cases. Initial normalizer/ingestion subset **44 passed in 8.38s**, including unsafe punctuation/splitting, faithful lexical refusals, unchanged structure, accepted prose spacing and full-original HTTP refusal with unchanged source/store. Final review additionally blocks spacing changes inside Markdown emphasis/links and parenthesized numbered lists without implementing a parser; **47 passed in 8.40s** and full Python **318 passed in 37.70s**; review/ingestion frontend **16 passed / 3 files in 2.02s**. Native string semantics and generation response fields checked against [Python 3.13](https://docs.python.org/3.13/library/stdtypes.html#str.split) and [Ollama](https://docs.ollama.com/api/generate) on 2026-10-02.

## Unchanged-corpus replay after normalization policy

Campaign: `content-acceptance-2026-10-02T20-48-45-073Z-9c76b4e9`, captured before the final additional emphasis/link/list restriction (separately covered by three native regressions; its six captured pair decisions are unchanged). New isolated store, unchanged corpus, model digest, chat context/thinking and native normalization budgets. The collector passes **1 collection in 55.40s** (total Vitest duration 56.23s). Independent reviewed gate exits **1**, `passed: false`, under the captured `whitespace-only-v1` policy.

| Metric | Approved-policy replay |
| --- | --- |
| Extraction critical-content checks | 8/8; original hashes unchanged |
| Dense recall@1 / recall@3 / MRR | 7/11 / 9/11 / 0.754785 |
| Full-store / selected-document recall@3 | 9/11 / 11/11 |
| Answer content / requested language / immediate supported citations | 10/12 / 6/12 / 7/12 |
| All three answer criteria | 5/12 |
| Frozen unsafe transformations automatically accepted | 0/4 |
| Frozen faithful lexical repairs refused | 2/2, required review under the approved policy |
| Frozen pair automatic decisions | 6/6 match the approved policy |
| Real normalization | 2/2 complete faithful lexical repairs, both correctly refused for review; no unsafe acceptance |

The English normalizer still removes the line-wrap hyphen and the Italian normalizer still fuses `pre sente` and adds an accent, despite the restricted prompt. The guard blocks both rewrites. Original/output comparisons remain retained; faithful lexical repair is not automatic policy compliance. Page 6 again omits the do-not-freeze condition and lacks supplied references; the exact-code answer adds an unsupported rare-case error replacement. Two correct answers cite a separate final paragraph and the later-sheet answer has a free-text attribution without an `[S#]` marker. Six English cases again answer in Italian. Defect/annual-notice whole-store retrieval misses remain. The five jointly accepted cases are paraphrase-cross-language, absent-penalty, conditional-refund, alternatives and unrelated-absent. Variability between replays is recorded, not claimed as stable improvement.
