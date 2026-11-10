import { describe, expect, it } from 'vitest'
import { isBrowserRenderableTarget } from './browserPreviewVerification'

describe('isBrowserRenderableTarget', () => {
  it('accepts an HTML page on disk', () => {
    expect(isBrowserRenderableTarget('index.html')).toBe(true)
    expect(isBrowserRenderableTarget('dist/index.htm')).toBe(true)
  })

  it('accepts a served URL, which had to start to answer', () => {
    expect(isBrowserRenderableTarget('http://localhost:5173')).toBe(true)
    expect(isBrowserRenderableTarget('https://127.0.0.1:3000/tasks')).toBe(true)
  })

  it('accepts documents and images the browser renders as themselves', () => {
    expect(isBrowserRenderableTarget('report.pdf')).toBe(true)
    expect(isBrowserRenderableTarget('assets/logo.svg')).toBe(true)
    expect(isBrowserRenderableTarget('screenshot.png')).toBe(true)
  })

  it('rejects the source files that produced the false verification', () => {
    // The exact target from session-1787471833056-o5fk, steps 41-44.
    expect(isBrowserRenderableTarget('src/pages/Dashboard.tsx')).toBe(false)
    expect(isBrowserRenderableTarget('src/App.tsx')).toBe(false)
    expect(isBrowserRenderableTarget('src/utils/helpers.ts')).toBe(false)
    expect(isBrowserRenderableTarget('src/styles/globals.css')).toBe(false)
    expect(isBrowserRenderableTarget('package.json')).toBe(false)
  })

  it('reads the extension past a query string or fragment', () => {
    expect(isBrowserRenderableTarget('index.html?v=2')).toBe(true)
    expect(isBrowserRenderableTarget('docs/page.html#section')).toBe(true)
  })

  it('rejects a target with no extension at all', () => {
    expect(isBrowserRenderableTarget('dist')).toBe(false)
    expect(isBrowserRenderableTarget('Makefile')).toBe(false)
  })

  it('rejects empty, blank and absent targets', () => {
    expect(isBrowserRenderableTarget('')).toBe(false)
    expect(isBrowserRenderableTarget('   ')).toBe(false)
    expect(isBrowserRenderableTarget(undefined)).toBe(false)
    expect(isBrowserRenderableTarget(null)).toBe(false)
  })

  it('is case-insensitive about the extension', () => {
    expect(isBrowserRenderableTarget('Index.HTML')).toBe(true)
  })
})
