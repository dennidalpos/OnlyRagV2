import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { createFixtureDirectory } from './scripts/test/fixtureRuntime.mjs'

const reportDirectory = createFixtureDirectory('onlyrag-browser-report-')

export default defineConfig({
  test: {
    reporters: ['default', 'json'],
    outputFile: { json: path.join(reportDirectory, 'vitest.json') },
    environment: 'node',
    include: ['scripts/e2e/agentBrowser.e2e.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
})
