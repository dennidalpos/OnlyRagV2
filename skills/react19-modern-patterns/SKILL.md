---
name: react19-modern-patterns
description: Change OnlyRag React renderer components, hooks, async UI ownership, or Windows desktop layouts.
triggers: ["react renderer", "react hook", "tsx", "responsive layout", "useTranslation.ts", "document editor"]
tags: ["react", "frontend"]
---

# React renderer

- Keep UI in `src/`; call privileged operations through `src/services/electronApi.ts` and the typed `window.electronAPI` preload bridge.
- For asynchronous workflows, bind results to the current task/document revision. Inspect `src/hooks/useTranslationOwnership.test.tsx` and `src/hooks/useIngestionNativeFile.test.tsx` for cancellation and late-result cases.
- Use `src/components/common/Tooltip.tsx` and the shared help catalog in `src/i18n/locales/` for contextual help. Modal help belongs to the active modal layer; preserve focus, Escape behavior and visible operational messages. Desktop geometry and accessibility requirements remain in AGENTS.md.
- `vitest.config.mts` assigns renderer tests to `dom`/happy-dom; service, Main, shared and script tests use `node`. Use `// @vitest-environment happy-dom` only for a DOM-dependent test otherwise assigned to Node ([Vitest 4.1.11 environment reference](https://github.com/vitest-dev/vitest/blob/v4.1.11/docs/guide/environment.md)). Use [verification commands](../code-quality-and-linting/SKILL.md) for invocation and storage isolation.
- For assembled UI flows, `npm run test:ux` builds and runs the deterministic Electron harness; `npm run test:tooltips` checks help/focus with controlled fixtures. These commands exercise real UI with simulated services and do not qualify responses from configured models.
