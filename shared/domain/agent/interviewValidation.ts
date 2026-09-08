import type { InterviewQuestion, UserInterviewAnswer } from '../../types'

type SupportedLanguage = 'it' | 'en' | 'es' | 'fr' | 'de'

const LANGUAGE_MARKERS: Record<SupportedLanguage, ReadonlySet<string>> = {
  it: new Set(['il', 'la', 'una', 'di', 'con', 'per', 'quale', 'preferisci', 'crea', 'aggiungi', 'modifica']),
  en: new Set(['the', 'a', 'an', 'of', 'with', 'for', 'which', 'you', 'prefer', 'create', 'add', 'change']),
  es: new Set(['el', 'la', 'una', 'de', 'con', 'para', 'cuál', 'prefieres', 'crear', 'añadir']),
  fr: new Set(['le', 'la', 'une', 'de', 'avec', 'pour', 'quel', 'préférez', 'créer', 'ajouter']),
  de: new Set(['der', 'die', 'das', 'mit', 'für', 'welche', 'bevorzugen', 'erstellen', 'hinzufügen']),
}

function detectLanguage(text: string): SupportedLanguage | null {
  const words = text.toLocaleLowerCase().match(/[\p{L}]+/gu) || []
  const scores = Object.entries(LANGUAGE_MARKERS).map(([language, markers]) => ({
    language: language as SupportedLanguage,
    score: words.reduce((total, word) => total + Number(markers.has(word)), 0),
  })).sort((left, right) => right.score - left.score)
  return scores[0].score >= 2 && scores[0].score > scores[1].score ? scores[0].language : null
}

export function validateInterviewQuestionLanguage(
  prompt: string,
  questions: readonly InterviewQuestion[]
): string | null {
  const requestLanguage = detectLanguage(prompt)
  if (!requestLanguage) return null
  const mismatch = questions.find((question) => {
    const questionLanguage = detectLanguage(`${question.question} ${question.rationale}`)
    return questionLanguage !== null && questionLanguage !== requestLanguage
  })
  return mismatch ? `Question ${mismatch.id} does not match the request language` : null
}

export type InterviewAnswerValidation =
  | { valid: true; answers: UserInterviewAnswer[] }
  | { valid: false; error: string }

export function validateInterviewAnswers(
  questions: readonly InterviewQuestion[],
  answers: readonly UserInterviewAnswer[]
): InterviewAnswerValidation {
  if (questions.length === 0 && answers.length > 0) return { valid: false, error: 'Expected questions are required' }
  if (answers.length !== questions.length) return { valid: false, error: 'Every current question needs one explicit answer' }

  const expected = new Map(questions.map((question) => [question.id, question]))
  const seen = new Set<string>()
  const normalized: UserInterviewAnswer[] = []
  for (const answer of answers) {
    const questionId = answer.questionId?.trim()
    const selectedOption = answer.selectedOption?.trim()
    if (!questionId || !selectedOption) return { valid: false, error: 'Answer fields must be non-empty' }
    if (seen.has(questionId)) return { valid: false, error: `Duplicate answer ID: ${questionId}` }
    seen.add(questionId)

    const question = expected.get(questionId)
    if (!question) return { valid: false, error: `Unknown or stale question ID: ${questionId}` }
    if (answer.questionText?.trim() !== question.question) {
      return { valid: false, error: `Question text does not match current ID: ${questionId}` }
    }
    if (answer.provenance !== 'explicit' && answer.provenance !== 'accepted_recommendation') {
      return { valid: false, error: `Answer ${questionId} has no explicit confirmation provenance` }
    }

    const recommended = question.options[question.recommendedIndex]
    if (answer.isCustom) {
      if (answer.provenance !== 'explicit') return { valid: false, error: `Custom answer ${questionId} must be explicit` }
    } else if (!question.options.includes(selectedOption)) {
      return { valid: false, error: `Answer ${questionId} is not an available option` }
    } else if (answer.provenance === 'accepted_recommendation' && selectedOption !== recommended) {
      return { valid: false, error: `Answer ${questionId} does not accept the recommended option` }
    }

    normalized.push({ ...answer, questionId, questionText: question.question, selectedOption })
  }
  return { valid: true, answers: normalized }
}
