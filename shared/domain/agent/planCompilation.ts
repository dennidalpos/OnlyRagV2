import { isCompletionMilestoneTitle, type PlanMilestone } from './planAndSolveGraph'
import { normalizePlanFalsifiability } from './planFalsifiabilityNormalizer'
import { extractDeliverablePaths } from './milestoneDeliverableResolver'
import type { AgentPlan } from '../../types'

/** Appends the milestone a file-shaped plan can never contain: the project's own check passing. */
export function ensureRunnableMilestone(milestones: PlanMilestone[], verificationCommand?: string | null): PlanMilestone[] {
  if (!verificationCommand) return milestones
  const alreadyProven = milestones.some((m) => m.verificationCommand === verificationCommand)
  if (alreadyProven) return milestones

  const operational = milestones.filter((m) => !isCompletionMilestoneTitle(m))
  const insertAt = operational.length
  const entry: PlanMilestone = {
    id: `m-${insertAt + 1}`,
    title: `Verify the application builds and runs end to end`,
    status: 'pending',
    verificationCommand,
    acceptanceCriteria: [`${verificationCommand} exits with code 0.`],
    verificationReferences: [verificationCommand],
    falsifiableHypothesis: `\`${verificationCommand}\` exits 0 over the project as it stands.`,
  }

  // Before the closing report milestone, which the finish tool owns.
  const closing = milestones.slice(insertAt)
  return [...milestones.slice(0, insertAt), entry, ...closing.map((m, i) => ({ ...m, id: `m-${insertAt + 2 + i}` }))]
}

/** What the workspace already provides, so this module never guesses at disk state. */
export interface ScaffoldRequirement {
  path: string
  title: string
  proposedVerificationCommand?: string
  /** Replaces the generic "provides the accepted stack capability" criterion. */
  acceptanceCriteria?: string[]
  /**
   * 'end' appends the requirement after the model's milestones: a behavioral test can only be
   * written once the code it exercises exists. Default 'start' (scaffold files come first).
   */
  placement?: 'start' | 'end'
}

export interface WorkspaceScaffoldFacts {
  isGreenfield: boolean
  requirements: ScaffoldRequirement[]
}

/** Prepends only missing requirements supplied by project discovery. */
export function ensureScaffoldMilestones(milestones: PlanMilestone[], workspace?: WorkspaceScaffoldFacts | null): PlanMilestone[] {
  if (!workspace?.isGreenfield || workspace.requirements.length === 0) return milestones

  const named = milestones.flatMap((m) => (m.filePaths?.length ? m.filePaths : extractDeliverablePaths(m.title)))
  const missing = workspace.requirements.filter((entry) => !named.includes(entry.path))
  if (missing.length === 0) return milestones

  const toMilestone = (entry: ScaffoldRequirement): PlanMilestone => {
    const criteria = entry.acceptanceCriteria?.length ? entry.acceptanceCriteria : [`${entry.path} provides the accepted stack capability.`]
    return {
      id: '',
      title: `${entry.title} — \`${entry.path}\``,
      status: 'pending',
      filePaths: [entry.path],
      acceptanceCriteria: criteria,
      proposedVerificationCommand: entry.proposedVerificationCommand,
      falsifiableHypothesis: criteria[0],
    }
  }
  const prepended = missing.filter((entry) => entry.placement !== 'end').map(toMilestone)
  const appended = missing.filter((entry) => entry.placement === 'end').map(toMilestone)

  return [...prepended, ...milestones, ...appended].map((m, idx) => ({ ...m, id: `m-${idx + 1}` }))
}

/** Applies canonical normalisation without merging distinct interventions. */
export function compilePlanMilestones(
  milestones: PlanMilestone[],
  verificationCommand?: string | null,
  workspace?: WorkspaceScaffoldFacts | null,
): PlanMilestone[] {
  // Closing the session is application control flow, never executable user work.
  const operationalMilestones = milestones.filter((milestone) => !isCompletionMilestoneTitle(milestone))
  const compiled = ensureRunnableMilestone(normalizePlanFalsifiability(operationalMilestones), verificationCommand)
  return ensureScaffoldMilestones(compiled, workspace)
}

/** Renders the canonical executable milestones shown in Plan review. */
export function renderPlanMilestones(milestones: readonly PlanMilestone[]): string {
  return milestones
    .map((milestone) => {
      const marker = milestone.status === 'verified' ? 'x' : milestone.status === 'in_progress' ? '>' : milestone.status === 'failed' ? '!' : ' '
      const files = milestone.filePaths?.length ? ` — files: ${milestone.filePaths.map((filePath) => `\`${filePath}\``).join(', ')}` : ''
      const criteria = milestone.acceptanceCriteria?.length ? `\n  - Criteria: ${milestone.acceptanceCriteria.join('; ')}` : ''
      const verification = milestone.verificationCommand ? ` — verify: \`${milestone.verificationCommand}\`` : ''
      const proposed = milestone.proposedVerificationCommand ? ` — future check: \`${milestone.proposedVerificationCommand}\`` : ''
      return `- [${marker}] ${milestone.id}: ${milestone.title}${files}${verification}${proposed}${criteria}`
    })
    .join('\n')
}

/** Renders the immutable structured plan as a review document. */
export function renderAgentPlanMarkdown(
  plan: Pick<AgentPlan, 'version' | 'objective' | 'decisions' | 'retainedEvidence' | 'milestones' | 'supersededWork'>,
): string {
  const sections = [`# Plan v${plan.version}`, `## Objective\n${plan.objective}`]
  if (plan.decisions.length > 0) {
    sections.push(
      `## Decisions and assumptions\n${plan.decisions.map((decision) => `- [${decision.source}] ${decision.statement}${decision.rationale ? ` — ${decision.rationale}` : ''}`).join('\n')}`,
    )
  }
  sections.push(`## Interventions\n${renderPlanMilestones(plan.milestones)}`)
  if (plan.retainedEvidence.length > 0) {
    sections.push(
      `## Retained evidence\n${plan.retainedEvidence.map((item) => `- ${item.interventionId}: ${item.summary}${item.verificationReferences.length ? ` — ${item.verificationReferences.join('; ')}` : ''}`).join('\n')}`,
    )
  }
  if (plan.supersededWork.length > 0) {
    sections.push(`## Superseded work\n${plan.supersededWork.map((item) => `- ${item.interventionId}: ${item.reason}`).join('\n')}`)
  }
  return sections.join('\n\n')
}
