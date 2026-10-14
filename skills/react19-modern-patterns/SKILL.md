---
name: react19-modern-patterns
description: Change OnlyRag React renderer components, hooks, async UI state, or responsive desktop, tablet, and phone layouts.
triggers: ["react renderer", "react hook", "tsx", "responsive layout", "useTranslation.ts", "document editor"]
tags: ["react", "frontend"]
---

# React renderer

- Keep UI in `src/`; call privileged operations through `src/services/electronApi.ts` and the typed `window.electronAPI` preload bridge.
- Place workflow and asynchronous state in hooks/services; let components render typed state and emit user intent.
- Ignore stale asynchronous results, preserve cancellation ownership, and expose loading/error state and keyboard access.
- Check layouts at 1920×1080, tablet widths and phone widths when UI geometry changes.
- Run `npm run typecheck` and targeted Vitest tests; DOM-dependent tests outside the DOM project declare `// @vitest-environment happy-dom`.
