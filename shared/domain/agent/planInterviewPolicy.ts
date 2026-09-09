import type { UserInterviewAnswer } from '../../types'
import type { InterviewQuestion } from '../../types'

const EXPLICIT_INTERVIEW_REQUEST = [
  /\b(chiedimi|fammi scegliere|prima di procedere chiedi|non scegliere (?:un )?default)\b/i,
  /\b(ask me|let me choose|ask before proceeding|do not choose (?:a )?default)\b/i,
]

const DECISION_CUE = /\b(quale|quali|scegliere|scelta|preferisci|meglio|decidere|non so|which|choose|choice|prefer|better|decide|unsure)\b/i
const ALTERNATIVE_CUE = /\b(o|oppure|contro|versus|vs\.?|or)\b/i

const EXPLICIT_ALTERNATIVE_PATTERNS = [
  /\b(?:se\s+usare|tra|fra)\s+(.{1,80}?)\s+(?:oppure|o|contro|versus|vs\.?)\s+(.{1,80}?)(?:[?.!]|$)/i,
  /\b(?:whether\s+to\s+use|between)\s+(.{1,80}?)\s+(?:or|versus|vs\.?)\s+(.{1,80}?)(?:[?.!]|$)/i,
  /:\s*(.{1,80}?)\s+(?:oppure|o|or|versus|vs\.?)\s+(.{1,80}?)(?:[?.!]|$)/i,
]

/** Builds one stable question when the request itself supplies both alternatives. */
export function explicitAlternativeInterviewFallback(prompt: string): InterviewQuestion[] {
  const match = EXPLICIT_ALTERNATIVE_PATTERNS.map((pattern) => pattern.exec(prompt)).find(Boolean)
  if (!match) return []
  const options = [match[1], match[2]].map((option) => option.trim().replace(/[,;:]$/, ''))
  if (options.some((option) => !option) || options[0].toLocaleLowerCase() === options[1].toLocaleLowerCase()) return []
  const italian = /\b(chiedimi|usare|tra|fra|oppure|quale)\b/i.test(prompt)
  return [{
    id: 'explicit-alternative-1',
    question: italian ? 'Quale alternativa vuoi usare?' : 'Which alternative should be used?',
    rationale: italian
      ? 'La scelta modifica il risultato richiesto.'
      : 'This choice changes the requested result.',
    options,
    recommendedIndex: 0,
  }]
}

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
