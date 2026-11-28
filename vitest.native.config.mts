import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { createFixtureDirectory } from './scripts/test/fixtureRuntime.mjs'

const reportDirectory = createFixtureDirectory('onlyrag-native-report-')

export default defineConfig({
  test: {
    reporters: ['default', 'json'],
    outputFile: { json: path.join(reportDirectory, 'vitest.json') },
    environment: 'node',
    include: ['scripts/e2e/nativeProjectVerification.probe.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
})
