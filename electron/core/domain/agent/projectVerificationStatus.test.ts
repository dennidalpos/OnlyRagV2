import { describe, expect, it } from 'vitest'
import { classifyProjectVerification, projectVerificationStatusSchema } from './projectVerificationStatus'

describe('project verification status', () => {
  it('classifies passing and failing evidence explicitly', () => {
    expect(classifyProjectVerification({ hasVerificationCommand: true, passed: true })).toBe('verified')
    expect(classifyProjectVerification({ hasVerificationCommand: true, passed: false })).toBe('failed')
  })

  it('classifies missing or incomplete evidence as unverifiable', () => {
    expect(classifyProjectVerification({ hasVerificationCommand: false })).toBe('unverifiable')
    expect(classifyProjectVerification({ hasVerificationCommand: true })).toBe('unverifiable')
    expect(projectVerificationStatusSchema.parse('unverifiable')).toBe('unverifiable')
    expect(() => projectVerificationStatusSchema.parse('pending')).toThrow()
  })
})
