# Coding Agent Plan Baseline

`2026-09-07` — Baseline for the Studio, Plan, and clarification-interview reliability work tracked as `CAS-01` through `CAS-28`.

## Evidence classes

Keep these results separate when evaluating a change:

- **Deterministic tests** use mocked model and IPC boundaries. They prove program behavior, not small-model behavior.
- **Repository verification** runs the wider project gates and detects regressions outside the focused flow.
- **Live Ollama probes** use the installed runtime and model. They are nondeterministic and must never be reported as unit-test coverage.

## Preserved observations

The backlog was created with two previously observed results:

- Studio: 5 test files, 45 tests.
- Plan/interview: 4 test files, 24 tests.

The command and exact file list for the historical Studio run were not recorded, so the 5/45 value is preserved as historical evidence only and is not presented as reproduced.

## Reproducible baseline

Run from the repository root in PowerShell:

```powershell
npm run test:fast
npx vitest run src/hooks/usePlanApproval.test.ts src/components/coding/PlanChatApprovalCard.test.ts electron/core/application/agentInterviewAppService.test.ts electron/core/application/planGenerationAppService.test.ts --reporter=verbose
npx vitest run --config vitest.live.config.mts -t "pre-seeded" --reporter=verbose
```

Observed on 2026-09-07:

| Evidence | Result | Meaning |
| :--- | :--- | :--- |
| Fast repository suite | 213 files, 1,824 tests passed | Deterministic repository baseline. |
| Focused Plan/interview suite | 4 files, 25 tests passed | Current reproducible successor to the historical 4/24 observation. |
| Live pre-seeded workspace | 1 passed, 9 skipped; 7.75 s test time | Real `qwen2.5-coder:7b` planning preserved the existing `npm run build` verification and did not add a `package.json` milestone. |

The live probe used `interviewPolicy: 'skip'`; it does not prove recommendation acceptance or end-to-end agent execution.

## Required regression matrix

Each correction must turn the matching scenario into a deterministic regression test that fails against the original defect. Live qualification remains separate.

| Scenario | Original defect to reproduce | Target coverage |
| :--- | :--- | :--- |
| Recommended answers | “Skip and use recommended” discarded the recommended options and planned from the raw request. | Hook flow plus prompt-enrichment service. |
| Interview/planning errors | Transport, IPC, or invalid JSON could be treated as “no questions” and produce a generic executable plan. | Interview service and hook flow. |
| Canonical plan | The renderer discarded milestones compiled with workspace context and reparsed display text. | Plan-generation service and hook flow. |
| Editing/countdown | Auto-proceed could continue while a ready plan was being edited or saved. | Plan panel and approval hook. |
| Seed false/error | Execution could start after plan persistence returned `false` or threw. | Approval hook and IPC contract test. |
| Double start | Concurrent approval callbacks could start execution twice. | Approval hook with a deferred seed. |
| Cancellation | Late interview or plan responses could repopulate state after cancellation. | Hook flow with deferred IPC responses. |
| Session/workspace/request change | In-flight responses, answers, timers, or loading state could contaminate a newer flow. | Hook rerender tests keyed by session, workspace, request, and revision. |

For live qualification, record model tag, runtime settings, cold/warm state, duration, result metrics, and snapshot location. A successful build or the presence of a file alone is not end-to-end proof.
