import { z } from 'zod'

export const projectVerificationStatusSchema = z.enum(['verified', 'failed', 'unverifiable'])
export type ProjectVerificationStatus = z.infer<typeof projectVerificationStatusSchema>

export interface ProjectVerificationOutcome {
  hasVerificationCommand: boolean
  passed?: boolean
}

/** Classifies verification evidence without treating a missing check as a passing result. */
export function classifyProjectVerification(outcome: ProjectVerificationOutcome): ProjectVerificationStatus {
  if (!outcome.hasVerificationCommand || outcome.passed === undefined) return 'unverifiable'
  return outcome.passed ? 'verified' : 'failed'
}
