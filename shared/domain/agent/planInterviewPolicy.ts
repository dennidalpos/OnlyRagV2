import type { UserInterviewAnswer } from '../../types'

const EXPLICIT_INTERVIEW_REQUEST = [
  /\b(chiedimi|fammi scegliere|prima di procedere chiedi|non scegliere (?:un )?default)\b/i,
  /\b(ask me|let me choose|ask before proceeding|do not choose (?:a )?default)\b/i,
]

const DECISION_CUE = /\b(quale|quali|scegliere|scelta|preferisci|meglio|decidere|non so|which|choose|choice|prefer|better|decide|unsure)\b/i
const ALTERNATIVE_CUE = /\b(o|oppure|contro|versus|vs\.?|or)\b/i

/** Runs the interview only when the request exposes a decision the user must make. */
export function shouldRunPlanInterview(
  prompt: string,
  previousDecisions: readonly UserInterviewAnswer[] = []
): boolean {
  const request = prompt.trim()
  if (!request) return false
  if (EXPLICIT_INTERVIEW_REQUEST.some((pattern) => pattern.test(request))) return true

  const hasUnresolvedAlternative = DECISION_CUE.test(request) && ALTERNATIVE_CUE.test(request)
  if (!hasUnresolvedAlternative) return false

  const normalizedRequest = request.toLocaleLowerCase()
  return !previousDecisions.some((decision) => {
    const answer = decision.selectedOption.trim().toLocaleLowerCase()
    return answer.length > 0 && normalizedRequest.includes(answer)
  })
}
