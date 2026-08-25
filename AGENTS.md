# AGENTS.md — <project name>

`rules v6.0 · 2026-08-25` · commands verified on `<YYYY-MM-DD>`

> Repo facts only, not derivable from the manifest, file tree or code · only commands you actually
> ran · delete unused sections · cap ~2500 characters once filled.

## 1. Project
What it does, who uses it, what it must NOT do.

## 2. Commands

| Purpose | Command |
|---|---|
| Setup | `...` |
| Dev run | `...` |
| Tests — fast (agent default) | `...` |
| Tests — full | `...` |
| A single test / one file | `...` |
| Lint / format | `...` |
| Type check | `...` |
| Build | `...` |

Pinned runtimes and versions: `...`
Never install on your own: `...`

## 3. Local environment
- Ports and services occupied locally, not to be killed: `...`
- Env vars the commands need — names only — and where to get them: `...`

## 4. Structure
- Paths whose purpose is not obvious from their name: `...`
- Layering rules actually enforced here (delete if none): `...`

## 5. Conventions
Only deviations from the language's standard: naming, error handling, config, logs, commits.

## 6. Sensitive areas
Not to touch without permission: migrations, feature flags, integrations, fragile or counter-intuitive spots.

## 7. Tracker
`PROJECT_STATUS.json` — strict `{"todos": ["..."]}`, nothing else. Plain strings, prefixed by kind:
`plan:` steps of the task in progress, `bug:` anomalies found, no prefix = backlog. Done, verified or
obsolete → delete the line in the same pass; `plan:` lines never survive the task. No ids, status,
priority or history.

## 8. Docs
`/docs/` is the single source. Architecture, module, API, env or setup change → update its file in the same pass, delete what is obsolete. No narrative, no restating the code.

## 9. Skills
`skills/<name>/SKILL.md` — read the relevant one before a task in its scope.

| Skill | When to use it |
|---|---|
| `...` | `...` |

## 10. Gotchas
What would trip up a fresh agent and is written nowhere else.
