---
name: react19-modern-patterns
description: Renderer rules for the React 19 OnlyRag V2 desktop app.
---

# React Renderer

- Keep UI in `src/`; use `window.electronAPI` for Main-process work.
- Put workflow and asynchronous state in hooks/services; components render typed state and emit user intent.
- Derive state where possible, ignore stale asynchronous results, and preserve keyboard and loading/error accessibility.
- Do not introduce direct Node, filesystem or Sidecar access from the Renderer.
- Verify a changed component or hook with `npm run typecheck` and the relevant Vitest target.
