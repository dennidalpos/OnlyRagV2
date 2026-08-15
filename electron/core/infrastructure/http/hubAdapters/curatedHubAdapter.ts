import { HubSkillItem, SkillHubSource } from '../../../domain/skills/skillTypes'
import { ISkillHubAdapter } from './hubAdapterInterface'

export const CURATED_CORE_SKILLS: HubSkillItem[] = [
  {
    id: 'react19-modern-patterns',
    name: 'react19-modern-patterns',
    description: 'React 19 Server Actions, useActionState, useOptimistic, and React Compiler rules.',
    category: 'frontend',
    tags: ['react', 'nextjs', 'frontend', 'hooks'],
    triggers: ['react', 'react 19', 'useactionstate', 'useoptimistic', 'jsx', 'tsx'],
    version: '1.2.0',
    author: 'React Core Community',
    hubId: 'official-core',
    hubName: 'OnlyRag Official Core Hub',
    rawContent: `---
name: react19-modern-patterns
description: "React 19 standard guidelines, useActionState, and async hooks"
version: "1.2.0"
author: "React Core Community"
triggers: ["react", "react 19", "useactionstate", "useoptimistic", "tsx"]
tags: ["react", "frontend", "hooks"]
---

# React 19 Modern Coding Standards

## 1. Asynchronous Forms & State
- Always prefer \`useActionState\` for form submissions instead of manual \`isLoading\`, \`error\`, and \`data\` useState combinations.
- Use \`useOptimistic\` for immediate UI updates before server confirmation.
- Use \`use()\` to read promises or context conditionally inside components.

## 2. Ref Handling & Directives
- Pass \`ref\` directly as a prop in React 19 (no need for \`forwardRef\` wrapper in new components).
- Ensure strict TypeScript typing for all event handlers and component props (avoid \`any\`).
`,
  },
  {
    id: 'typescript-clean-code',
    name: 'typescript-clean-code',
    description: 'Strict TypeScript patterns, no-any guidelines, Discriminated Unions, and error boundary types.',
    category: 'architecture',
    tags: ['typescript', 'clean-code', 'typing'],
    triggers: ['typescript', 'ts', 'type', 'interface', 'generic'],
    version: '2.0.0',
    author: 'TypeScript Guild',
    hubId: 'official-core',
    hubName: 'OnlyRag Official Core Hub',
    rawContent: `---
name: typescript-clean-code
description: "Strict TypeScript guidelines, exhaustive checks, and clean typing"
version: "2.0.0"
author: "TypeScript Guild"
triggers: ["typescript", "ts", "type", "interface"]
tags: ["typescript", "clean-code"]
---

# TypeScript Clean Code & Strict Typing

## 1. Type Safety Principles
- **Forbidden**: Never use \`any\` or generic untyped \`Object\`. Use \`unknown\` with type guards or strict generic constraints.
- **Discriminated Unions**: Prefer tagged union types (\`type Result = { ok: true; value: T } | { ok: false; error: string }\`) over optional error/data pairs.
- **Exhaustive Matching**: Use \`never\` in switch default branches to guarantee exhaustiveness at compile time.

## 2. Immutability & Contracts
- Mark data transfer objects (DTOs) and configuration arrays as \`readonly\`.
- Place domain types in dedicated \`types/\` or domain modules, keeping presentation controllers decoupled from infrastructure models.
`,
  },
  {
    id: 'fastapi-pydantic-v2',
    name: 'fastapi-pydantic-v2',
    description: 'FastAPI standards, async endpoints, Pydantic v2 schemas, and dependency injection.',
    category: 'backend',
    tags: ['python', 'fastapi', 'pydantic', 'backend'],
    triggers: ['fastapi', 'python', 'pydantic', 'uvicorn', 'async def'],
    version: '1.4.0',
    author: 'Python Async WG',
    hubId: 'official-core',
    hubName: 'OnlyRag Official Core Hub',
    rawContent: `---
name: fastapi-pydantic-v2
description: "FastAPI and Pydantic v2 async backend architecture guidelines"
version: "1.4.0"
author: "Python Async WG"
triggers: ["fastapi", "python", "pydantic", "uvicorn"]
tags: ["python", "backend", "fastapi"]
---

# FastAPI & Pydantic v2 Architecture

## 1. Async & Non-Blocking Execution
- Use \`async def\` for I/O bound endpoints that use asynchronous libraries.
- For blocking CPU operations or sync filesystem calls, execute them using \`asyncio.to_thread(...)\` to avoid stalling the event loop.

## 2. Schemas & Dependency Injection
- Define explicit request and response models with Pydantic v2 (\`model_config = ConfigDict(...)\`).
- Use FastAPI \`Depends(...)\` for database sessions, authentication, and service orchestration.
`,
  },
  {
    id: 'lancedb-vector-search',
    name: 'lancedb-vector-search',
    description: 'LanceDB vector embeddings, hybrid full-text search, and embedding index optimization.',
    category: 'database',
    tags: ['lancedb', 'rag', 'embeddings', 'vector-db'],
    triggers: ['lancedb', 'vector', 'embedding', 'rag', 'lance'],
    version: '1.1.0',
    author: 'OnlyRag Team',
    hubId: 'official-core',
    hubName: 'OnlyRag Official Core Hub',
    rawContent: `---
name: lancedb-vector-search
description: "LanceDB embedded vector database and hybrid RAG search patterns"
version: "1.1.0"
author: "OnlyRag Team"
triggers: ["lancedb", "vector", "embedding", "rag"]
tags: ["lancedb", "database", "vector-db"]
---

# LanceDB Vector Database Guidelines

## 1. Embedding & Schema Integrity
- Ensure fixed dimensionality across document chunks (e.g. 768 for nomic-embed-text / bge-large).
- Always normalize vector queries before cosine similarity matching.
- Store metadata (file_path, chunk_index, timestamp) alongside dense vector arrays.

## 2. Query Optimization
- Use IVF-PQ or scalar indices when collection exceeds 50,000 chunks.
- Combine dense vector distance search with BM25 / keyword filtering for high-precision retrieval.
`,
  },
  {
    id: 'appsec-sandboxing-guardrails',
    name: 'appsec-sandboxing-guardrails',
    description: 'Security rules, path traversal protection, secret masking, and safe shell execution.',
    category: 'security',
    tags: ['security', 'appsec', 'guardrails', 'sandboxing'],
    triggers: ['security', 'appsec', 'sandbox', 'traversal', 'secret'],
    version: '1.5.0',
    author: 'Security WG',
    hubId: 'official-core',
    hubName: 'OnlyRag Official Core Hub',
    rawContent: `---
name: appsec-sandboxing-guardrails
description: "Application security guidelines, sandbox containment, and secret shielding"
version: "1.5.0"
author: "Security WG"
triggers: ["security", "appsec", "sandbox", "traversal"]
tags: ["security", "appsec"]
---

# AppSec & Sandboxing Guardrails

## 1. Filesystem & Path Traversal Containment
- Validate all file paths with canonical resolution (\`path.resolve\`) against the workspace root.
- Reject any path attempting parent traversal (\`..\`) outside the project boundaries.

## 2. Credential & Secret Protection
- Never log, echo, or store API keys, tokens, or plaintext passwords in code or logs.
- Enforce \`.env.example\` patterns and environment variable isolation.
`,
  },
  {
    id: 'tailwind-css-v4',
    name: 'tailwind-css-v4',
    description: 'Tailwind CSS v4 guidelines, modern CSS @theme, color tokens, and container queries.',
    category: 'frontend',
    tags: ['tailwind', 'css', 'design', 'styling'],
    triggers: ['tailwind', 'css', 'theme', 'style', 'responsive'],
    version: '1.0.0',
    author: 'Modern Web Guild',
    hubId: 'official-core',
    hubName: 'OnlyRag Official Core Hub',
    rawContent: `---
name: tailwind-css-v4
description: "Tailwind CSS v4 pure CSS configuration and modern design tokens"
version: "1.0.0"
author: "Modern Web Guild"
triggers: ["tailwind", "css", "theme", "styling"]
tags: ["tailwind", "css", "frontend"]
---

# Tailwind CSS v4 Best Practices

## 1. Configuration & @theme Directives
- In Tailwind v4, use \`@import "tailwindcss";\` at the top of your main CSS file (\`src/index.css\`). DO NOT write \`@tailwind base; @tailwind components; @tailwind utilities;\`.
- In Tailwind v4, configure tokens directly in your main CSS file using \`@theme\` variables instead of \`tailwind.config.js\`.
- Use HSL or modern CSS color tokens with CSS custom properties (\`--color-primary\`, \`--color-surface\`).

## 2. Dynamic & Fluid Design
- Use Container Queries (\`@container\`) for modular sub-components.
- Ensure accessible focus rings (\`focus-visible:ring-2\`) and adequate tap targets (min 44px).
`,
  },
  {
    id: 'python-data-engineering',
    name: 'python-data-engineering',
    description: 'Pandas, Polars, DuckDB, memory-efficient data processing, and arrow pipelines.',
    category: 'database',
    tags: ['python', 'polars', 'duckdb', 'pandas', 'data'],
    triggers: ['pandas', 'polars', 'duckdb', 'dataframe', 'arrow', 'parquet'],
    version: '1.1.0',
    author: 'Data Engineering WG',
    hubId: 'official-core',
    hubName: 'OnlyRag Official Core Hub',
    rawContent: `---
name: python-data-engineering
description: "High-performance Python data engineering with Polars, DuckDB, and Arrow"
version: "1.1.0"
author: "Data Engineering WG"
triggers: ["pandas", "polars", "duckdb", "dataframe", "parquet"]
tags: ["python", "data", "polars", "duckdb"]
---

# Python Data Engineering Standards

## 1. Polars & DuckDB over Pandas
- For datasets > 100MB, default to Polars with lazy execution (\`scan_parquet\`, \`scan_csv\`).
- Use DuckDB SQL queries for complex analytical joins and aggregations directly on disk.

## 2. Streaming & Memory Limits
- Process large datasets in batches or chunks using Arrow record batches to keep RAM usage constant.
`,
  },
  {
    id: 'electron-clean-architecture',
    name: 'electron-clean-architecture',
    description: 'Layered architecture in Electron, IPC typed contracts, sidecar resilience, and zero legacy rules.',
    category: 'architecture',
    tags: ['electron', 'architecture', 'ipc', 'clean-code'],
    triggers: ['electron', 'ipc', 'main', 'preload', 'sidecar', 'architecture'],
    version: '1.3.0',
    author: 'OnlyRag Architects',
    hubId: 'official-core',
    hubName: 'OnlyRag Official Core Hub',
    rawContent: `---
name: electron-clean-architecture
description: "Clean layered architecture standards for Electron and sidecar processes"
version: "1.3.0"
author: "OnlyRag Architects"
triggers: ["electron", "ipc", "preload", "sidecar", "architecture"]
tags: ["electron", "architecture", "clean-code"]
---

# Electron Clean Layered Architecture

## 1. Layer Separation
- **Presentation**: UI components & IPC handlers only.
- **Application**: Orchestration services coordinating domain and infrastructure.
- **Domain**: Pure business rules and models. No Electron or Node.js imports.
- **Infrastructure**: File system, HTTP, processes, and database.

## 2. IPC Safety
- Expose strictly typed APIs via \`contextBridge.exposeInMainWorld\`.
- Never expose raw \`ipcRenderer\` directly to the UI layer.
`,
  },
]

export class CuratedHubAdapter implements ISkillHubAdapter {
  canHandle(source: SkillHubSource): boolean {
    return source.type === 'builtin' || source.id === 'official-core'
  }

  async fetchSkills(source: SkillHubSource): Promise<HubSkillItem[]> {
    return CURATED_CORE_SKILLS.map((skill) => ({
      ...skill,
      hubId: source.id,
      hubName: source.name,
    }))
  }
}
