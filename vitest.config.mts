import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// Application identity injected from package.json — consumed by src/constants/appMetadata.ts.
// The About dialog needs the real version/author, not the i18n field labels.
const pkg = JSON.parse(readFileSync(path.resolve(rootDir, 'package.json'), 'utf-8'))
const authorName = String(pkg.author || '').replace(/\s*<[^>]*>\s*/g, '').trim()
const authorUrl = (String(pkg.author || '').match(/<([^>]+)>/) || [])[1] || ''
const appDefines = {
  __APP_VERSION__: JSON.stringify(pkg.version || '0.0.0'),
  __APP_AUTHOR__: JSON.stringify(authorName || 'OnlyRag Contributors'),
  __APP_REPOSITORY_URL__: JSON.stringify(
    authorUrl.startsWith('http') ? `${authorUrl.replace(/\/$/, '')}/OnlyRagV2` : 'https://github.com/dennidalpos/OnlyRagV2'
  ),
}

export default defineConfig({
  define: appDefines,
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
    // Test files declare different Electron/application mock factories. Per-file module
    // isolation prevents those factories from leaking through the shared module cache.
    isolate: true,
    include: ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,tsx,mts}'],
    testTimeout: 5000,
    hookTimeout: 5000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.{ts,tsx}', 'electron/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        'src/main.tsx',
        'electron/main.ts',
        'electron/preload.ts',
      ],
      thresholds: {
        statements: 45,
        branches: 40,
        functions: 35,
        lines: 45,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
})

