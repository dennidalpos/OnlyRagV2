---
name: react19-modern-patterns
description: "React 19 Server Actions, useActionState, useOptimistic, and React Compiler rules."
version: "1.2.0"
author: "React Core Community"
triggers: ["react", "react 19", "useactionstate", "useoptimistic", "jsx", "tsx"]
tags: ["react", "nextjs", "frontend", "hooks"]
origin_hub: "OnlyRag Official Core Hub"
origin_hub_id: "official-core"
origin_checksum: "451e97de1ba9bc75"
is_modified: false
---

# React 19 Modern Coding Standards

## 1. Asynchronous Forms & State
- Always prefer `useActionState` for form submissions instead of manual `isLoading`, `error`, and `data` useState combinations.
- Use `useOptimistic` for immediate UI updates before server confirmation.
- Use `use()` to read promises or context conditionally inside components.

## 2. Ref Handling & Directives
- Pass `ref` directly as a prop in React 19 (no need for `forwardRef` wrapper in new components).
- Ensure strict TypeScript typing for all event handlers and component props (avoid `any`).
