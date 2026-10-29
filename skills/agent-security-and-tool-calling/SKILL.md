---
name: agent-security-and-tool-calling
description: Apply OnlyRag Coding Agent tool policy when changing agent modes, filesystem or terminal tools, approvals, workspace confinement, or secret handling.
triggers: ["agent tool", "agent mode", "fullaccess", "tool approval", "workspace confinement", "agent security"]
tags: ["coding agent", "tool calling"]
---

# Coding Agent tool policy

- Keep tool arguments within `electron/core/domain/agent/ollamaToolSchemaCatalog.ts` and the active allowlist in `electron/core/domain/agent/turnToolPolicy.ts`. Reject malformed calls.
- Apply the selected mode in `electron/core/domain/agent/agentRuntimeMode.ts`: Ask is read-only; Guided reviews mutations; Auto follows its configured profile. `fullAccess` bypasses application approval and contextual command gates, but not the per-turn tool schema or Ask's read-only catalogue. These are application runtime settings, not permissions for the agent maintaining this repository.
- Under the ordinary profile, preserve path containment, symlink/junction checks, read-version checks and checkpoints in `electron/core/application/agentToolExecutorService.ts` and `electron/core/domain/agent/tools/fs/`.
- Audit the explicit debug-log setting before changing diagnostic payloads; Coding audit and general operational logs have different payload/redaction policies.
- For workspace verification, follow `electron/core/domain/agent/projectVerificationResolver.ts` and `electron/core/infrastructure/process/powerShellCommand.ts`: resolve observed checks, enter the observed project root and restore the shell environment/directory on failure. Acquisition guards are not a network sandbox; verify manager behavior against a controlled registry rather than inferring offline behavior from flags alone.
- Verify policy changes with `npm run test:agent` and targeted executor/verification tests using [verification commands](../code-quality-and-linting/SKILL.md). For interrupted effects and checkpoints, use [agent recovery](../onlyrag-agent-recovery/SKILL.md).
