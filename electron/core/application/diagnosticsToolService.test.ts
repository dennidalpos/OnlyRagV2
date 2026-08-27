import { describe, expect, it } from 'vitest'
import { DiagnosticsToolService } from './diagnosticsToolService'

describe('DiagnosticsToolService ask', () => {
  const service = new DiagnosticsToolService()

  it('prefers the explicit question and returns the stable result contract', () => {
    const result = service.executeAsk({ question: 'Which database should I use?', query: 'ignored' }, 'ignored')

    expect(result).toEqual({
      outputForHistory: 'Agent requested clarification: "Which database should I use?"',
      logMessage: 'Agent Question: Which database should I use?',
      logDetail: 'Which database should I use?',
    })
  })

  it('supports query and explanation aliases before using the default fallback', () => {
    expect(service.executeAsk({ query: 'What is the target?' }).logDetail).toBe('What is the target?')
    expect(service.executeAsk({}, 'Please clarify the target.').logDetail).toBe('Please clarify the target.')
    expect(service.executeAsk({}).logDetail).toBe('Clarification requested from user.')
  })
})
