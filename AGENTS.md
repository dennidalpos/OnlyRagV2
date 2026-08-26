# AGENTS.md — OnlyRag V2

`rules v1.0 · 2026-08-25` · commands verified on `2026-08-26`

## 1. Project
Electron app: local RAG on LanceDB, plus a Coding Agent Studio driving **local Ollama models**
(default `qwen2.5-coder:7b`) in an autonomous tool loop. Fully offline. Must NOT depend on a hosted
LLM, nor mark a milestone verified without a real command exiting 0 (blueprint §6.2).

## 2. Commands

| Purpose | Command |
|---|---|
| Full gate (agent default) | `npm run lint` |
| Unit tests / one file | `npx vitest run [path]` |
| Type check | `npx tsc --noEmit` |
| Python sidecar tests | `npm run test:sidecar` |
| OpenAPI fixture | `npm run generate:openapi` |
| Live agent probe | `npm run test:live` |
| Repository cleanup | `npm run clean` |

`npm run lint` is **not** a linter: it is the whole serial gate — format, typecheck, vitest, build,
bundle smoke. CI runs it plus `test:sidecar`, and nothing else. Runtimes: Node 22–25, Python 3.12.
`npm run package:win` richiede un `.venv` Python 3.12 e produce il sidecar standalone prima di NSIS;
il percorso separato `npm run build` non compila il sidecar.

## 3. Local environment
`npm run test:live` needs Ollama on `127.0.0.1:11434` with the coding model pulled, takes ~5 min,
and **is red on purpose**: it asserts the milestone ratio the blueprint claims and the agent does
not reach. `OLLAMA_*` vars come from the user env; none are needed for the unit gate.

## 4. Structure
`sidecar/` is a Python FastAPI process started by Electron. `userdata_dev/` is a disposable dev
profile.

**Enforced:** `electron/core/domain/` never imports `infrastructure/`. Domain code needing disk or
network takes an injected function — see `classifyModuleDiagnostic` and
`buildDiagnosticFixDirective`, which receive a predicate and a resolver.

## 5. Conventions
Comments explain WHY, citing the evidence. Line endings are mixed: match the file you edit.

## 6. Sensitive areas
`electron/core/domain/agent/` is tuned against measured live runs, each rule stating its evidence
in the comment above it. Read it before rewording a directive: several exist because the opposite
was tried and failed.

## 7. Tracker
`PROJECT_STATUS.json` — strict `{"todos": ["..."]}`, nothing else. Plain strings, prefixed by kind:
`plan:` steps of the task in progress, `bug:` anomalies found, no prefix = backlog. Done, verified or
obsolete → delete the line in the same pass; `plan:` lines never survive the task. No ids, status,
priority or history — **list order carries priority**.

## 8. Docs
`/docs/` is the single source. Architecture, module, API, env or setup change → update its file in
the same pass, delete what is obsolete. No narrative, no restating the code.

## 9. Skills
`skills/<name>/SKILL.md` — read the relevant one before a task in its scope.
`onlyrag-workspace-guidelines` architecture · `agent-security-and-tool-calling` agent loop and tool
parsing · `lancedb-vector-search` embeddings · `fastapi-pydantic-v2` `sidecar/` ·
`react19-modern-patterns` `src/` · `code-quality-and-linting` gate scripts.

## 10. Gotchas
- `logs/coding_agent_audit.log` is append-only, rotates at 10 MB into `.1.log`, and is the evidence
  behind every measurement in the blueprint. `npm run clean:logs` deletes it. Before a live probe,
  record its byte offset and slice from there, or you are reading earlier runs.
- **Counting a directive by its header in the prompt text counts history replay, not emissions.**
  Tool results are re-sent while they survive trimming: one emitted 4 times appears 117 times.
  Count per `TOOL RESULT COMPLETED` record — this has produced two wrong conclusions.
- `test:live` writes workspaces to `~/Desktop/onlyrag_live_*` (~280 MB) and leaves them; the unit
  suite leaks `%TEMP%/onlyrag-*-test-*` directories, thousands over a long session.
