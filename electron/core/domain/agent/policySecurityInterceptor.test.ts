import { describe, it, expect } from 'vitest'
import { PolicyBasedSecurityInterceptor } from './policySecurityInterceptor'

describe('PolicyBasedSecurityInterceptor', () => {
  it('should DENY dangerous destructive commands', () => {
    const res = PolicyBasedSecurityInterceptor.evaluatePolicy('run_command', { command: 'rm -rf /' }, 'agent')
    expect(res.action).toBe('DENY')
  })

  it('should REQUIRE_HUMAN_APPROVAL for mutating tools in ASK mode', () => {
    const res = PolicyBasedSecurityInterceptor.evaluatePolicy('write_file', { filePath: 'app.ts' }, 'ask')
    expect(res.action).toBe('REQUIRE_HUMAN_APPROVAL')
  })

  it('should DENY mutating tools in PLAN mode', () => {
    const res = PolicyBasedSecurityInterceptor.evaluatePolicy('write_file', { filePath: 'app.ts' }, 'plan')
    expect(res.action).toBe('DENY')
  })

  it('should ALLOW safe read operations in AGENT mode', () => {
    const res = PolicyBasedSecurityInterceptor.evaluatePolicy('read_file', { filePath: 'app.ts' }, 'agent')
    expect(res.action).toBe('ALLOW')
  })
})
