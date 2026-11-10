import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { UPSTREAM_MODULES } from './AboutModal'

describe('About dependency baseline', () => {
  it('shows locked versions rather than obsolete minima, wrapper versions or removed libraries', () => {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
    const pins = readFileSync('sidecar/constraints.txt', 'utf8')
    for (const [label, name] of [
      ['Electron', 'electron'],
      ['React 19', 'react'],
      ['Vite', 'vite'],
      ['Monaco Editor', 'monaco-editor'],
      ['TypeScript Compiler API', 'typescript'],
    ]) {
      expect(UPSTREAM_MODULES.find((item) => item.name === label)?.version).toBe(`v${lock.packages[`node_modules/${name}`].version}`)
    }
    const pillow = pins.match(/^pillow==(.+)$/m)?.[1].trim()
    expect(pillow).toBeTruthy()
    expect(UPSTREAM_MODULES.find((item) => item.name === 'OpenCV & Pillow')?.version).toContain(`v${pillow}`)
    expect(UPSTREAM_MODULES.every((item) => !/[?>=]/.test(item.version))).toBe(true)
    expect(UPSTREAM_MODULES.some((item) => item.name === 'Fast-Levenshtein' || item.name === 'Ignore')).toBe(false)
  })
})
