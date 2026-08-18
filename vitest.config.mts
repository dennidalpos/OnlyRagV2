import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    environmentMatchGlobs: [
      ['electron/**', 'node'],
      ['electron/**/*', 'node'],
      ['src/services/**', 'node'],
      ['src/constants/**', 'node'],
    ],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    include: ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.{ts,tsx}'],
    testTimeout: 5000,
    hookTimeout: 5000,
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
})

