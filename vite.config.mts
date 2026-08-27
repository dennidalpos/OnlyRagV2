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
        vite: {
          build: {
            // `rolldownOptions`, not `rollupOptions`: Vite 8 reads the former, and
            // vite-plugin-electron resolves `build.rolldownOptions || build.rollupOptions`
            // after merging its own defaults — which already set `rolldownOptions`. A
            // `rollupOptions` block here would be silently dropped, and the only symptom
            // would be a bundle of exactly the same size as before.
            rolldownOptions: {
              // depcheck resolves its language parsers at runtime with require('./parser/<name>'),
              // built from a name list evaluated the moment the module is imported. Inlined into
              // dist-electron/main.js that require becomes dist-electron/parser/coffee, which does
              // not exist: the main process threw "App threw an error during load" before writing
              // its second log line, so the installed app died at startup with nothing to go on.
              // Left external it is required from node_modules, which electron-builder does package
              // (node_modules/depcheck/dist/parser/*.js are inside app.asar), and its own relative
              // requires resolve next to it.
              // Playwright resolves browser protocol helpers dynamically. Keeping it in the
              // Electron main bundle makes Rolldown resolve an optional chromium-bidi import
              // that is only needed by one runtime path; the package must remain external so
              // its own Node resolution and browser installation contract stay intact.
              external: ['depcheck', 'playwright', 'playwright-core', 'chromium-bidi'],
            },
          },
        },
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
    emptyOutDir: false,
    chunkSizeWarningLimit: 3000,
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
