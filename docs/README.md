# OnlyRag V2 — Documentation Index

This directory is the documentation source of truth for the repository. Each topic has one
canonical page; cross-links should point to that page instead of duplicating the same guidance.

## Canonical sources

| Topic | Authoritative source | Scope |
| --- | --- | --- |
| Installation, environment, hardware, commands and packaging | [`setup-and-env.md`](./setup-and-env.md) | Prerequisites, Ollama configuration, development/test/quality commands and Windows packaging |
| System architecture and data flows | [`architecture.md`](./architecture.md) | Electron, React, Python sidecar, RAG, agent loop and persistence topology |
| Module ownership and layer boundaries | [`modules.md`](./modules.md) | Presentation, application, domain and infrastructure responsibilities |
| REST and Electron IPC contracts | [`api.md`](./api.md) | Endpoint/channel behavior, payloads and error contracts |
| Operational observability and diagnostics | [`observability.md`](./observability.md) | Logging, metrics, retention and known diagnostic gaps |
| Live agent quality assurance | [`agent-live-testing.md`](./agent-live-testing.md) | Live prerequisites, scenarios, isolation and log interpretation |
| External libraries and custom domain implementations | [`libraries-and-domain-implementations.md`](./libraries-and-domain-implementations.md) | Dependency rationale and domain-level substitutions |
| Dependency and vulnerability snapshot | [`dependency-audit.md`](./dependency-audit.md) | Point-in-time audit results, false positives and follow-up |
| Quality gates and CI verification | [`quality-gates.md`](./quality-gates.md) | Lint/format limitations, type-check, coverage and reproducible CI policy |

## Contract and maintenance rules

- The machine-readable sidecar contract is [`../sidecar/contracts/openapi-2.3.0.json`](../sidecar/contracts/openapi-2.3.0.json); regenerate it with `npm run generate:openapi` rather than editing it manually.
- Commands in documentation must exist in [`../package.json`](../package.json). `npm run docs:check` validates local Markdown links and `npm run` references.
- `setup-and-env.md` owns the command catalog. Other pages should link there when they need to refer to a build, test, cleanup or audit command.
- `api.md` owns public REST/IPC behavior. `architecture.md` may explain why a contract exists, but must not define a competing payload or channel list.
- `dependency-audit.md` is a dated snapshot, not a replacement for the current dependency manifest or a claim that an audit remains current indefinitely.

## Suggested reading paths

- New contributor: [`setup-and-env.md`](./setup-and-env.md) → [`architecture.md`](./architecture.md) → [`modules.md`](./modules.md).
- API integrator: [`api.md`](./api.md) → [`../sidecar/contracts/openapi-2.3.0.json`](../sidecar/contracts/openapi-2.3.0.json).
- Coding-agent maintainer: [`architecture.md`](./architecture.md) → [`agent-live-testing.md`](./agent-live-testing.md) → [`observability.md`](./observability.md).
- Dependency review: [`libraries-and-domain-implementations.md`](./libraries-and-domain-implementations.md) → [`dependency-audit.md`](./dependency-audit.md).
- Quality review: [`quality-gates.md`](./quality-gates.md) → [`setup-and-env.md`](./setup-and-env.md).
