import { describe, it, expect, beforeEach } from 'vitest'
import {
  acquireBodyScrollLock,
  releaseBodyScrollLock,
  getBodyScrollLockCount,
} from './bodyScrollLock'

describe('bodyScrollLock', () => {
  beforeEach(() => {
    // Drain any lock a previous test left behind, then reset the page's own style.
    while (getBodyScrollLockCount() > 0) releaseBodyScrollLock()
    document.body.style.overflow = ''
  })

  it('freezes scrolling on the first lock', () => {
    acquireBodyScrollLock()

    expect(document.body.style.overflow).toBe('hidden')
    expect(getBodyScrollLockCount()).toBe(1)
  })

  it('restores scrolling once the only lock is released', () => {
    acquireBodyScrollLock()
    releaseBodyScrollLock()

    expect(document.body.style.overflow).toBe('')
    expect(getBodyScrollLockCount()).toBe(0)
  })

  it('keeps scrolling frozen while a stacked modal still holds a lock', () => {
    // The skill hub opens the skill editor, which opens the custom-hub guide.
    acquireBodyScrollLock()
    acquireBodyScrollLock()
    acquireBodyScrollLock()

    releaseBodyScrollLock()
    expect(document.body.style.overflow).toBe('hidden')

    releaseBodyScrollLock()
    expect(document.body.style.overflow).toBe('hidden')

    releaseBodyScrollLock()
    expect(document.body.style.overflow).toBe('')
  })

  it("restores the page's own overflow rather than blanking it", () => {
    document.body.style.overflow = 'scroll'

    acquireBodyScrollLock()
    expect(document.body.style.overflow).toBe('hidden')

    releaseBodyScrollLock()
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('ignores a release with no lock held instead of going negative', () => {
    releaseBodyScrollLock()

    expect(getBodyScrollLockCount()).toBe(0)
    expect(document.body.style.overflow).toBe('')
  })

  it('re-locks correctly after a full release cycle', () => {
    acquireBodyScrollLock()
    releaseBodyScrollLock()
    acquireBodyScrollLock()

    expect(document.body.style.overflow).toBe('hidden')
    expect(getBodyScrollLockCount()).toBe(1)
  })
})
