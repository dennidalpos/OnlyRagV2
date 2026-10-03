# Local model task baselines

`MODEL-TASK-QUALITY-BASELINES-01` is complete as a profile definition on 2026-10-02. These are candidates for qualification, independent of the development computer. No profile is certified by its parameter count, upstream benchmark, download size or memory-fit badge. Actual role/hardware qualification remains in `LOCAL-MODEL-ROLE-QUALIFICATION-01`.

## Product profiles

| Profile | Roles and local suite | Declared hardware to qualify | Initial effective context and limits |
| --- | --- | --- | --- |
| Limited entry | `qwen3.5:4b` for basic document questions; `qwen3-embedding:0.6b`; native RapidOCR | 16 GB RAM, supported GPU with 8 GB VRAM, SSD | 8K generation. Explicitly limited; complete technical/legal translation, optional Vision and autonomous coding are unqualified. CPU-only is a separate latency profile. |
| Document baseline | `qwen3.5:9b` shared by chat and translation; `qwen3-embedding:0.6b`; native RapidOCR. Vision is optional and separately qualified. | 32 GB RAM, supported GPU with 12 GB VRAM, modern 6-8-core CPU, SSD, approximately 30 GB free before documents/backups | Start at 16K; measure 32K separately. Guided coding only with the existing qualification warnings. This is the candidate baseline for the document product. |
| Strong document workstation | `qwen3.5:27b` for document chat/translation; the same encoder and native OCR | 64 GB RAM, 24-32 GB supported GPU VRAM, SSD, approximately 60 GB free before corpus/checkpoints | Qualify 16K and 32K independently. Larger context and model size do not prove completeness or fidelity. Live stronger-model work remains deferred. |
| Coding workstation | `qwen3-coder:30b`; alternatively separately qualified `qwen3.5:27b`; document encoder/OCR only when needed | 64 GB RAM, 24 GB supported GPU VRAM as a lower candidate, preferably 32 GB or more, SSD | Qualify 32K and 64K with full independent repo outcomes. Minimum viable hardware and autonomous reliability are unknown. This definition does not resume deferred campaigns. |

Hardware figures are project evaluation targets, not vendor guarantees or measured minimum requirements. Sum actual simultaneously loaded weights, context/state/cache, encoder, OCR providers, desktop and OS headroom; do not interpret artifact bytes as peak VRAM. CPU offload can be feasible but needs its own speed measurement. The [runtime-fit policy](./model-runtime-fit.md) preserves uncertainty for unsupported hybrid layouts.

## Artifact identity and primary sources

Checked on 2026-10-02 against official Ollama tag pages and registry manifests/config blobs. The SHA256 below hashes the exact registry manifest body; it is the model identity, not the weight-blob digest. Tags can move. Qualification must capture the installed `/api/tags` digest and `/api/show` quantization at run time and compare them with this snapshot. A changed digest or preparation policy requires new qualification; encoder/store changes also require the approved backup/rebuild boundary.

| Tag | Quantization | Manifest SHA256 | Artifact layers, decimal GB | License/model card |
| --- | --- | --- | --- | --- |
| [`qwen3.5:4b`](https://ollama.com/library/qwen3.5:4b) | Q4_K_M | `2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd` | 3.390 | [Apache-2.0 / Qwen](https://huggingface.co/Qwen/Qwen3.5-4B) |
| [`qwen3.5:9b`](https://ollama.com/library/qwen3.5:9b) | Q4_K_M | `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7` | 6.594 | [Apache-2.0 / Qwen](https://huggingface.co/Qwen/Qwen3.5-9B) |
| [`qwen3.5:27b`](https://ollama.com/library/qwen3.5:27b) | Q4_K_M | `7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e` | 17.420 | [Apache-2.0 / Qwen](https://huggingface.co/Qwen/Qwen3.5-27B) |
| [`qwen3-coder:30b`](https://ollama.com/library/qwen3-coder:30b) | Q4_K_M | `06c1097efce0431c2045fe7b2e5108366e43bee1b4603a7aded8f21689e90bca` | 18.557 | [Apache-2.0 / Qwen](https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct) |
| [`qwen3-embedding:0.6b`](https://ollama.com/library/qwen3-embedding:0.6b) | Q8_0 | `ac6da0dfba84a81fdbfbaf330198c33cd77c4cdfc53e8bc50eb581914a15621d` | 0.639 | [Apache-2.0 / Qwen](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B) |

The encoder candidate has 1024 native dimensions and task-specific query instructions; OnlyRag's versioned preparation policy is in [RAG/Sidecar](./rag-sidecar.md). Its captured-request fixtures are implementation evidence; it has no installed/live qualification in the retained campaign. The Coder model has approximately 30B total and 3B active parameters; weight memory follows the total model, not only active parameters. Upstream context limits are ceilings; the product windows above are workload targets.

Native OCR means [RapidOCR](https://github.com/RapidAI/RapidOCR) with local ONNX assets, rather than an extra generative OCR model. Current development packages are RapidOCR **3.9.2** and ONNX Runtime GPU **1.29.0**; package versions do not identify the recognition/detection weights. Every OCR campaign must capture actual asset paths/SHA256, dictionary, configured language/model variant, provider, driver and package versions. [Official model list](https://rapidai.github.io/RapidOCRDocs/main/model_list/) documents available language/model variants. OCR assets and redistributed dependency notices still require the separate distribution-license inventory.

## Qualification by role

Freeze the corpus, prompts, expected evidence and acceptance rules before generating answers. Keep raw failures and score retrieval separately from answers. The evaluated model must not generate its own expected results or serve as the sole judge.

| Role | Required evidence | Acceptance for the declared corpus |
| --- | --- | --- |
| Document extraction/OCR | Original binary/hash, page/table/late-section expected content, extracted output, active OCR asset/provider identity | No silent loss of critical rows, names, numbers, negations or late pages. Report omissions/truncation explicitly; a rendered export alone cannot pass. |
| Normalization | Retained complete original/output pairs, accept/refuse decision and reasons | Report false acceptance and false rejection separately. Independently compare clauses, conditions, punctuation/segmentation and entities; conservative entity checks are insufficient. |
| Retrieval | Actual native encoder/store provenance, unfiltered and document-filtered ranks, exact-code/paraphrase/IT-EN cases | Report dense and final-pipeline recall@1/@3 and MRR independently. All frozen critical expected passages must reach the evaluated shortlist; keep failures without changing the oracle. |
| Grounded chat | Actual retrieved chunks, full request/output, source selectors and independent claim-to-passage review | Correct complete supported details and conditions, abstention on absent evidence, explicit unresolved contradictions and requested language. Valid source locations alone cannot pass. |
| Translation | Complete source/output comparisons in both languages and additional documents | No invented signature/name/number, omitted sentence/alternative/condition/deadline, or changed delivery meaning. Thinking modes are separate configurations; preserve current retries/timeouts. |
| Optional Vision | Frozen images/pages and independent transcription/understanding expectations | Measure content accuracy and whether native OCR fallback was used; no qualification inherited from text-only chat. |
| Coding | Independent complete-task tests/builds and rendered app checks | Retained TaskLab sequence requirements apply. Partial tool calls/probe success are insufficient. Exhausted planning diagnosis needs an approved new strategy first. |

For each qualified configuration record OS, CPU, RAM, GPU/VRAM, driver/backend, Ollama version, tag/digest/quantization, requested and observed context, thinking, cache/batch/parallel/keep-alive settings, corpus size and store/preparation identity. Capture cold/hot first-output latency, prefill/evaluation counts/durations, sustained tokens/s, peak RAM/VRAM and retrieval p50/p95. Include overlapping chat/encoder/OCR workloads. Timing thresholds from the audit remain proposed until measured on the declared hardware. Do not reuse one development-PC result as proof for every product profile.

## Current evidence and rollout boundary

Fresh metadata reads confirm local Ollama **0.35.1** and installed `qwen3.5:9b` Q4_K_M with the matching digest above. The permitted live encoder is `nomic-embed-text:latest`, F16, digest `0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f`. Its [upstream card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) is English-oriented; the retained IT/EN preparation campaign failed dense recall@3 (10/12) and pipeline recall@3 (9/12). Real 9B source cases have supported-detail successes and a retained mixed-source failure; English response consistency still fails. These are bounded observations, not profile certification. See [verification](./verification.md).

The shipped [starter catalog](../shared/domain/hardware/hardwareModelCatalog.ts) still selects 3B chat/translation/coding models and Nomic independently of hardware. This profile-definition task does not silently replace that UI policy or saved settings. `UX-FIRST-USE-SIMPLIFICATION-01` owns the explicit first-use presentation/selection change and small-model limitations, following corpus/coverage decisions. New downloads, stronger-model runs, personal-setting changes and encoder migration are separate decisions. Distribution licensing remains in `DISTRIBUTION-LICENSE-POLICY-01`.
