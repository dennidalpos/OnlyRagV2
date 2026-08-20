import { defineConfig } from 'vite'
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
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'

export default defineConfig({
  define: appDefines,
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        entry: 'electron/main.ts',
      },
      preload: {
        input: 'electron/preload.ts',
      },
      renderer: {},
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@monaco-editor') || id.includes('monaco-editor')) {
              return 'monaco-vendor'
            }
            if (id.includes('gpt-tokenizer')) {
              return 'tokenizer-vendor'
            }
            if (id.includes('@tanstack')) {
              return 'virtual-vendor'
            }
            if (id.includes('lucide-react')) {
              return 'icons-vendor'
            }
            if (id.includes('react') || id.includes('react-dom')) {
              return 'react-vendor'
            }
            return 'vendor'
          }
        },
      },
    },
  },
})
