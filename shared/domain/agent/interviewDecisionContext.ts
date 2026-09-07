import type { InterviewQuestion, UserInterviewAnswer } from '../../types'

const DECISION_LABELS: Record<NonNullable<UserInterviewAnswer['provenance']>, string> = {
  explicit: 'EXPLICIT USER ANSWER',
  accepted_recommendation: 'ACCEPTED RECOMMENDATION',
  unconfirmed_assumption: 'UNCONFIRMED ASSUMPTION',
}

/** Builds the choices represented by the interview's "use recommended" action. */
export function createAcceptedRecommendationAnswers(
  questions: InterviewQuestion[]
): UserInterviewAnswer[] {
  return questions.map((question) => ({
    questionId: question.id,
    questionText: question.question,
    selectedOption: question.options[question.recommendedIndex] || question.options[0] || '',
    isCustom: false,
    provenance: 'accepted_recommendation',
  }))
}

/**
 * Produces the exact task text shared by planning, persistence and execution.
 * The original request remains verbatim and decisions carry machine-visible provenance.
 */
export function composeInterviewDecisionPrompt(
  originalPrompt: string,
  answers: UserInterviewAnswer[]
): string {
  if (answers.length === 0) return originalPrompt

  const formattedDecisions = answers
    .map((answer) => {
      const provenance = answer.provenance || 'explicit'
      const customLabel = answer.isCustom ? ' (Custom)' : ''
      return `- [${DECISION_LABELS[provenance]}] ${answer.questionText}: ${answer.selectedOption}${customLabel}`
    })
    .join('\n')

  return (
    `[ORIGINAL USER REQUEST]\n${originalPrompt}\n\n` +
    `[INTERVIEW DECISIONS]\n${formattedDecisions}`
  )
}

