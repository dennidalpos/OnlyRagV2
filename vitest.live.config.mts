import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

/**
 * Live agent runs — a separate config on purpose.
 *
 * These "tests" drive the real orchestrator against a real Ollama model and a real workspace
 * on disk. They take minutes, need a running Ollama, and are not assertions about the code:
 * they are the only way to observe how a small model actually reacts to a guard's wording,
 * which no unit test can tell you (see docs/agent-live-testing.md).
 *
 * Kept out of `vitest.config.mts` because the default suite runs with `isolate: false` and a
 * shared working directory: a live run sitting inside `electron/**` gets collected by the
 * normal suite, runs alongside it for minutes, and tears down temp directories other tests are
 * still using. That produced 29 phantom failures once — all of them attributed, at first, to
 * the change under test.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/live/**/*.live.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    isolate: false,
    testTimeout: 3_600_000,
    hookTimeout: 600_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
})
