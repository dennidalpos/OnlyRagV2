import { describe, expect, it } from 'vitest'
import {
  interviewPhaseResponseSchema,
  planningPhaseResponseSchema,
  renderPlanningResponse,
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

  it('rejects plan milestones without evidence', () => {
    const result = validateStructuredContent(
      '{"milestones":[{"id":"m-1","objective":"Inspect code"}]}',
      planningPhaseResponseSchema
    )
    expect(result.status).toBe('invalid')
  })

  it('derives the Ollama format and canonical checklist from the planning schema', () => {
    const format = toOllamaJsonSchema(planningPhaseResponseSchema)
    expect(format.type).toBe('object')

    const planText = renderPlanningResponse({
      milestones: [{ id: 'm-1', objective: 'Login works', filePath: 'src/auth.ts', verificationCommand: 'npm test' }],
    })
    expect(planText).toBe('- [ ] m-1: Login works — `src/auth.ts` — verify: `npm test`')
  })
})
