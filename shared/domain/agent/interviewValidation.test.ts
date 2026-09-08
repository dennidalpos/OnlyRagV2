import { describe, expect, it } from 'vitest'
import type { InterviewQuestion } from '../../types'
import { validateInterviewAnswers, validateInterviewQuestionLanguage } from './interviewValidation'

const questions: InterviewQuestion[] = [{
  id: 'storage',
  question: 'Quale persistenza preferisci?',
  rationale: 'La scelta cambia portabilità e gestione dei dati.',
  options: ['SQLite', 'File JSON'],
  recommendedIndex: 0,
}]

describe('interview validation', () => {
  it('accepts a free response only with explicit provenance', () => {
    expect(validateInterviewAnswers(questions, [{
      questionId: 'storage',
      questionText: 'Quale persistenza preferisci?',
      selectedOption: 'PostgreSQL locale',
      isCustom: true,
      provenance: 'explicit',
    }])).toMatchObject({ valid: true })
  })

  it('rejects stale IDs, implicit defaults and invalid options', () => {
    expect(validateInterviewAnswers(questions, [{
      questionId: 'old', questionText: 'Vecchia?', selectedOption: 'SQLite', provenance: 'explicit',
    }])).toMatchObject({ valid: false, error: expect.stringContaining('stale') })
    expect(validateInterviewAnswers(questions, [{
      questionId: 'storage', questionText: questions[0].question, selectedOption: 'SQLite', provenance: 'unconfirmed_assumption',
    }])).toMatchObject({ valid: false, error: expect.stringContaining('confirmation') })
    expect(validateInterviewAnswers(questions, [{
      questionId: 'storage', questionText: questions[0].question, selectedOption: 'Redis', provenance: 'explicit',
    }])).toMatchObject({ valid: false, error: expect.stringContaining('available') })
  })

  it('rejects a question in a different detectable language', () => {
    expect(validateInterviewQuestionLanguage('Crea una pagina con filtri', [{
      ...questions[0],
      question: 'Which storage do you prefer?',
      rationale: 'The choice changes the data format and portability.',
    }])).toContain('language')
  })
})
