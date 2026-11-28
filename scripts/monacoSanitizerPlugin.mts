import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

/** Monaco vendors its own sanitizer: npm overrides alone cannot replace those bytes. */
export function monacoSanitizerPlugin(): Plugin {
  const require = createRequire(import.meta.url)
  const manifestPath = path.join(path.dirname(require.resolve('dompurify')), '..', 'package.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { version: string }
  if (manifest.version !== '3.4.17') throw new Error('Qualify the Monaco sanitizer before changing its pinned version.')
  const replacement = path.join(path.dirname(manifestPath), 'dist', 'purify.es.mjs').replace(/\\/g, '/')
  return {
    name: 'onlyrag-monaco-sanitizer',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source !== './dompurify/dompurify.js' || !importer?.replace(/\\/g, '/').endsWith('/monaco-editor/esm/vs/base/browser/domSanitize.js')) return null
      return replacement
    },
    generateBundle() {
      const modules = [...this.getModuleIds()].map((id) => id.replace(/\\/g, '/'))
      const vendored = modules.filter((id) => /\/monaco-editor\/.*\/dompurify\/dompurify\.js$/.test(id))
      if (vendored.length) this.error('The unqualified vendored Monaco sanitizer remains in the bundle.')
      if (
        modules.some((id) => id.endsWith('/monaco-editor/esm/vs/base/browser/domSanitize.js')) &&
        !modules.includes(path.resolve(replacement).replace(/\\/g, '/'))
      ) {
        this.error('Monaco did not resolve the qualified sanitizer.')
      }
    },
  }
}
