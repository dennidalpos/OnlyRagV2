import { describe, expect, it } from 'vitest'
import { formatAgentTextIt, mapAgentLocalizedStrings, renderAgentLines } from './agentMainText'

describe('agentMainText', () => {
  it('renders the Italian fallback with nested parameters', () => {
    expect(
      formatAgentTextIt({
        key: 'closureEvidence',
        params: { evidence: { key: 'evidenceGuardStop', params: { guard: 'no_mutation', evidence: { key: 'evidenceBehavioralPassed' } } } },
      }),
    ).toBe('Evidenza: Run fermato dal guard "no_mutation". Controllo comportamentale superato.')
  })

  it('joins localized and verbatim lines', () => {
    expect(renderAgentLines([{ key: 'closureCompleted', params: { count: 1 } }, { text: '- Build' }])).toBe('Completato (1):\n- Build')
  })

  it('maps verbatim strings only, leaving keys and numbers alone', () => {
    const mapped = mapAgentLocalizedStrings(
      {
        message: { key: 'closureReason', params: { reason: 'token=secret' } },
        detail: [{ text: 'token=secret' }, { key: 'closureCompleted', params: { count: 2 } }],
      },
      (value) => value.replace('secret', '[redacted]'),
    )

    expect(mapped).toEqual({
      message: { key: 'closureReason', params: { reason: 'token=[redacted]' } },
      detail: [{ text: 'token=[redacted]' }, { key: 'closureCompleted', params: { count: 2 } }],
    })
  })
})
