import { describe, it, expect } from 'vitest'
import { EphemeralSubAgentDispatcher } from './ephemeralSubAgentDispatcher'

describe('EphemeralSubAgentDispatcher', () => {
  it('should construct isolated sub-agent prompt', () => {
    const prompt = EphemeralSubAgentDispatcher.buildSubAgentPrompt({
      role: 'RESEARCHER',
      taskDescription: 'Find all exports of AuthToken',
      contextSnippet: 'export class AuthToken {}',
      maxTokenBudget: 500,
    })

    expect(prompt).toContain('[SUB-AGENT WORKER ROLE: RESEARCHER]')
    expect(prompt).toContain('Find all exports of AuthToken')
    expect(prompt).toContain('Token Cap: 500 tokens.')
  })

  it('should format sub-agent report for parent context', () => {
    const report = EphemeralSubAgentDispatcher.formatSubAgentReport({
      success: true,
      summary: 'Found 2 occurrences of AuthToken',
      discoveredFacts: ['src/auth.ts: export class AuthToken', 'src/index.ts: export * from ./auth'],
      tokensUsed: 120,
    })

    expect(report).toContain('[SUB-AGENT REPORT: SUCCESS]')
    expect(report).toContain('Found 2 occurrences of AuthToken')
    expect(report).toContain('src/auth.ts')
  })
})
