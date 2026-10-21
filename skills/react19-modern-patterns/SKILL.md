---
name: react19-modern-patterns
description: Change OnlyRag React renderer components, hooks, async UI ownership, or Windows desktop layouts.
triggers: ["react renderer", "react hook", "tsx", "responsive layout", "useTranslation.ts", "document editor"]
tags: ["react", "frontend"]
---

# React renderer

- Keep UI in `src/`; call privileged operations through `src/services/electronApi.ts` and the typed `window.electronAPI` preload bridge.
- For asynchronous workflows, bind results to the current task/document revision. Inspect `src/hooks/useTranslationOwnership.test.tsx` and `src/hooks/useIngestionNativeFile.test.tsx` for cancellation and late-result cases.
- Check geometry on the supported 1920×1080 desktop, including keyboard, focus and zoom behavior required by AGENTS.md. Use `src/components/common/Tooltip.tsx` and the shared help entries in `src/i18n/locales/` when changing contextual help.
- Run `npm run typecheck` and targeted Vitest tests. `vitest.config.mts` assigns renderer tests to `dom`/happy-dom; service, Main, shared and script tests use `node`. Use `// @vitest-environment happy-dom` only for a DOM-dependent test otherwise assigned to Node ([Vitest environment reference](https://vitest.dev/guide/environment.html)); use the installed version and local config to verify version-specific behavior.
- `scripts/test/nodeSetup.ts` owns a temporary userData root per Node test file before application imports. Preserve this setup when testing persistence; a partial mock importing the original resolver can reach development storage.
