import { describe, expect, it } from 'vitest'
import { isPathWithinRoot } from './pathContainment'

describe('path containment', () => {
  it('accepts descendants and optionally the root itself', () => {
    expect(isPathWithinRoot('D:/workspace', 'D:/workspace/src/App.tsx')).toBe(true)
    expect(isPathWithinRoot('D:/workspace', 'D:/workspace')).toBe(true)
    expect(isPathWithinRoot('D:/workspace', 'D:/workspace', false)).toBe(false)
  })

  it('rejects traversal and sibling prefixes', () => {
    expect(isPathWithinRoot('D:/workspace', 'D:/workspace/../secret.txt')).toBe(false)
    expect(isPathWithinRoot('D:/workspace', 'D:/workspace-copy/file.txt')).toBe(false)
  })
})
