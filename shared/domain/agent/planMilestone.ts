export interface PlanMilestone {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'verified' | 'failed'
  filePaths?: string[]
  acceptanceCriteria?: string[]
  verificationReferences?: string[]
  sourceInterventionId?: string
  falsifiableHypothesis?: string
  verificationCommand?: string
  proposedVerificationCommand?: string
  notes?: string
}
