import { describe, it, expect } from 'vitest'
import { parseVersionNotFound, buildVersionNotFoundDirective } from './npmVersionNotFound'

/** Verbatim from run 17 of 2026-08-25, which the circuit breaker stopped at step 15. */
const ETARGET_OUTPUT = [
  'npm error code ETARGET',
  'npm error notarget No matching version found for @types/react@^19.3.5.',
  'npm error notarget In most cases you or one of your dependencies are requesting',
].join('\n')

describe('parseVersionNotFound', () => {
  it('names the package and the range npm refused, scope included', () => {
    expect(parseVersionNotFound(ETARGET_OUTPUT)).toEqual({ packageName: '@types/react', requestedRange: '^19.3.5' })
  })

  it('handles an unscoped package', () => {
    const out = 'npm error notarget No matching version found for vite@^99.0.0.'
    expect(parseVersionNotFound(out)).toEqual({ packageName: 'vite', requestedRange: '^99.0.0' })
  })

  it('stays out of every other failure', () => {
    expect(parseVersionNotFound('npm error code ERESOLVE\nnpm error ERESOLVE unable to resolve')).toBeNull()
    expect(parseVersionNotFound('Cannot find module react')).toBeNull()
    expect(parseVersionNotFound('')).toBeNull()
  })
})

describe('buildVersionNotFoundDirective', () => {
  it('names the version the registry actually publishes', () => {
    const directive = buildVersionNotFoundDirective({ packageName: '@types/react', requestedRange: '^19.3.5' }, '19.2.18')

    expect(directive).toContain('the current version is 19.2.18')
    expect(directive).toContain('npm install @types/react@19.2.18')
    expect(directive).toContain('do NOT guess another number')
  })

  it('never invents a number when the registry could not be reached', () => {
    // Guessing here would be the same defect that caused the failure in the first place.
    const directive = buildVersionNotFoundDirective({ packageName: '@types/react', requestedRange: '^19.3.5' })

    expect(directive).toContain('could not be reached')
    expect(directive).toContain('npm install @types/react')
    expect(directive).not.toMatch(/@types\/react@[0-9]/)
  })
})
