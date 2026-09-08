import { describe, expect, it } from 'vitest'
import { shouldRunPlanInterview } from './planInterviewPolicy'

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
})
