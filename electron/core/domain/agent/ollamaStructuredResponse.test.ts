import { describe, expect, it } from 'vitest'
import {
  interviewPhaseResponseSchema,
  planningPhaseResponseSchema,
  toOllamaJsonSchema,
  validateStructuredContent,
} from './ollamaStructuredResponse'

describe('Ollama structured phase responses', () => {
  it('accepts the explicit no-question interview result', () => {
    const result = validateStructuredContent(
      '{"hasQuestions":false,"questions":[]}',
      interviewPhaseResponseSchema
    )
    expect(result.status).toBe('valid')
  })

  it('keeps JSON validity distinct from semantic schema validity', () => {
    const result = validateStructuredContent(
      '{"hasQuestions":true,"questions":[]}',
      interviewPhaseResponseSchema
    )

    expect(result.status).toBe('invalid')
  })

  it('rejects an out-of-range recommendation', () => {
    const result = validateStructuredContent(JSON.stringify({
      hasQuestions: true,
      questions: [{ id: 'q1', question: 'Framework?', rationale: 'Changes the implementation.', options: ['A', 'B'], recommendedIndex: 2 }],
    }), interviewPhaseResponseSchema)

    expect(result.status).toBe('invalid')
  })

  it('rejects more than two interview questions', () => {
    const question = { id: 'q', question: 'Choice?', rationale: 'Changes behavior.', options: ['A', 'B'], recommendedIndex: 0 }
    const result = validateStructuredContent(JSON.stringify({
      hasQuestions: true,
      questions: [question, { ...question, id: 'q2' }, { ...question, id: 'q3' }],
    }), interviewPhaseResponseSchema)
    expect(result.status).toBe('invalid')
  })

  it('rejects duplicate question IDs and options', () => {
    const question = { id: 'q', question: 'Choice?', rationale: 'Changes behavior.', options: ['A', 'a'], recommendedIndex: 0 }
    const duplicateOptions = validateStructuredContent(JSON.stringify({ hasQuestions: true, questions: [question] }), interviewPhaseResponseSchema)
    expect(duplicateOptions.status).toBe('invalid')

    const validOptions = { ...question, options: ['A', 'B'] }
    const duplicateIds = validateStructuredContent(JSON.stringify({ hasQuestions: true, questions: [validOptions, validOptions] }), interviewPhaseResponseSchema)
    expect(duplicateIds.status).toBe('invalid')
  })

  it('rejects plan interventions without evidence', () => {
    const result = validateStructuredContent(
      JSON.stringify({ objective: 'Inspect code', assumptions: [], interventions: [{ id: 'm-1', objective: 'Inspect code', filePaths: [], acceptanceCriteria: ['Known result'] }], supersededWork: [] }),
      planningPhaseResponseSchema
    )
    expect(result.status).toBe('invalid')
  })

  it('derives an Ollama JSON schema for the structured plan', () => {
    const format = toOllamaJsonSchema(planningPhaseResponseSchema)
    expect(format.type).toBe('object')
    expect(format.properties).toEqual(expect.objectContaining({ objective: expect.any(Object), interventions: expect.any(Object) }))
  })
})
