# Architecture Patterns

- Electron Main owns desktop IPC and process lifecycle; the React renderer uses typed IPC contracts, while the Python Sidecar owns ingestion and retrieval.
- Persistent document and agent state requires explicit ownership, backup/readback and refusal on invalid existing data. `docs/architecture.md`, `docs/rag-sidecar.md` and `docs/agent-runtime.md` describe the boundaries.

# Decisions & Trade-offs

- Greenfield cleanup may remove obsolete code, but retained live-campaign evidence, original documents, personal stores and migration backups are protected until their separate acceptance or disposal decision.
- The tracker contains only open work. Dated verification and audit documents retain historical results.

# Lessons Learned & Gotchas

- A passing build or deterministic fixture does not certify content quality, an installed desktop, real-model behavior or power-loss durability. Preserve these distinctions in acceptance claims.
- Diagnostic scripts should resolve transitive packages through their declaring direct dependency; direct imports of a transitive package fail `knip` and depend on lockfile hoisting.
