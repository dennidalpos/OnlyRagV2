import { describe, expect, it } from 'vitest'
import { explicitAlternativeInterviewFallback, shouldRunPlanInterview } from './planInterviewPolicy'

describe('shouldRunPlanInterview', () => {
  it('sends clear implementation requests directly to planning', () => {
    expect(shouldRunPlanInterview('Correggi il timeout nel repository di audit')).toBe(false)
    expect(shouldRunPlanInterview('Add CSV export using the existing service')).toBe(false)
  })

  it('interviews when an explicit unresolved alternative changes the result', () => {
    expect(shouldRunPlanInterview('Quale persistenza scegliere: SQLite o file JSON?')).toBe(true)
    expect(shouldRunPlanInterview('Which renderer should we choose, canvas or SVG?')).toBe(true)
  })

  it('honors an explicit request to ask without requiring alternatives syntax', () => {
    expect(shouldRunPlanInterview('Prima di procedere chiedimi quale comportamento preferisco')).toBe(true)
  })

  it('does not repeat an alternative already resolved in the request', () => {
    expect(shouldRunPlanInterview('Meglio SQLite o JSON? Usa SQLite.', [{
      questionId: 'storage',
      questionText: 'Quale persistenza?',
      selectedOption: 'SQLite',
      provenance: 'explicit',
    }])).toBe(false)
  })

  it('extracts explicit Italian and English alternatives deterministically', () => {
    expect(explicitAlternativeInterviewFallback(
      'Prima di procedere chiedimi se usare localStorage oppure file JSON.'
    )[0]).toMatchObject({
      options: ['localStorage', 'file JSON'],
      recommendedIndex: 0,
    })
    expect(explicitAlternativeInterviewFallback('Ask me whether to use SQLite or IndexedDB.')[0].options)
      .toEqual(['SQLite', 'IndexedDB'])
    expect(explicitAlternativeInterviewFallback('Correggi il timeout.')).toEqual([])
  })
})
