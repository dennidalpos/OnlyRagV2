import { describe, expect, it } from 'vitest'

// Guards vitest.config.mts: Main-process tests must run in Node, not in a browser-like DOM.
describe('test environment', () => {
  it('runs electron tests without a DOM', () => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
  })
})
