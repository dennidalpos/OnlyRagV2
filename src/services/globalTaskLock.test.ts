import { describe, it, expect, beforeEach } from 'vitest'
import { acquireGlobalTaskLock, releaseGlobalTaskLock, peekGlobalTaskLock } from './globalTaskLock'

describe('globalTaskLock', () => {
  beforeEach(() => {
    // Reset shared module-level state between tests.
    for (let holder = peekGlobalTaskLock(); holder; holder = peekGlobalTaskLock()) releaseGlobalTaskLock(holder)
  })

  it('grants the lock to the first module that acquires it', () => {
    expect(peekGlobalTaskLock()).toBeNull()
    expect(acquireGlobalTaskLock('coding')).toBe(true)
    expect(peekGlobalTaskLock()).toBe('coding')
  })

  it('denies acquisition to a different module while the lock is held', () => {
    expect(acquireGlobalTaskLock('ingestion')).toBe(true)
    expect(acquireGlobalTaskLock('coding')).toBe(false)
    expect(acquireGlobalTaskLock('translation')).toBe(false)
    expect(peekGlobalTaskLock()).toBe('ingestion')
  })

  it('is re-entrant for the module that already holds the lock', () => {
    expect(acquireGlobalTaskLock('translation')).toBe(true)
    expect(acquireGlobalTaskLock('translation')).toBe(true)
    expect(peekGlobalTaskLock()).toBe('translation')
  })

  it('frees the lock on release, allowing another module to acquire it', () => {
    acquireGlobalTaskLock('coding')
    releaseGlobalTaskLock('coding')
    expect(peekGlobalTaskLock()).toBeNull()
    expect(acquireGlobalTaskLock('ingestion')).toBe(true)
  })

  it('ignores a stale release from a module that does not currently hold the lock', () => {
    acquireGlobalTaskLock('ingestion')
    // A superseded/late release from a different module must not clobber the real holder.
    releaseGlobalTaskLock('coding')
    expect(peekGlobalTaskLock()).toBe('ingestion')
  })

  it('stays held until every holder of the same module has released', () => {
    // Document and in-place translation both hold 'translation'; one finishing must not free the other.
    acquireGlobalTaskLock('translation')
    acquireGlobalTaskLock('translation')
    releaseGlobalTaskLock('translation')
    expect(peekGlobalTaskLock()).toBe('translation')
    expect(acquireGlobalTaskLock('coding')).toBe(false)
    releaseGlobalTaskLock('translation')
    expect(peekGlobalTaskLock()).toBeNull()
  })
})
