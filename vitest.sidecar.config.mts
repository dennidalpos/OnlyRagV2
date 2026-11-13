import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFixtureDirectory } from './scripts/test/fixtureRuntime.mjs'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const reportDirectory = createFixtureDirectory('onlyrag-sidecar-report-')

export default defineConfig({
  test: {
    reporters: ['default', 'json'],
    outputFile: { json: path.join(reportDirectory, 'vitest.json') },
    environment: 'node',
    include: ['scripts/e2e/sidecarOwnership.live.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 90_000,
    hookTimeout: 20_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
})
