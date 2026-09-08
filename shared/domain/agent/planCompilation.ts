/**
 * Plan Compilation.
 *
 * Structured interventions pass through the same ordered compilation before execution.
 *
 * The order is load-bearing:
 *  1. normalise    — fold acceptance criteria into the deliverables they qualify, so every
 *                    surviving entry is something that can be shown done or not done.
 *  2. ensure runnable  — append the project's own check as a milestone no write can close.
 *  3. ensure scaffold — prepend only files required by the accepted greenfield stack.
 *
 * The canonical plan is never capped or merged. Turn prompts select a bounded view while
 * persistence and verification retain every intervention identity and command.
 */

import { isCompletionMilestoneTitle, type PlanMilestone } from './planAndSolveGraph'
import { normalizePlanFalsifiability } from './planFalsifiabilityNormalizer'
import { extractDeliverablePaths } from './milestoneDeliverableResolver'
import type { AgentPlan } from '../../types'

/**
 * Appends the milestone a file-shaped plan can never contain: the project's own check passing.
 *
 * Ten of fifteen milestones in the observed plans say "create the file X", and a plan of that
 * shape reaches 100% by writing files. Measured on 2026-08-25: 14/15 verified, `tsc` green over
 * every file, and `vite build` emitting no JavaScript at all — every deliverable present, the
 * application dead. Nothing in the plan could contradict that, because nothing in the plan was
 * about the application working.
 *
 * Appended only when the project actually declares a check, and citing that command verbatim.
 * Inventing one would be the fabricated verification this codebase keeps removing, and the
 * planner prompt already forbids the model from doing exactly that.
 *
 * The entry names no file on purpose, so no write can close it: it closes when `update_plan`
 * runs its command and the command exits 0, or when a passing verification promotes it. It
 * carries a command, so the unprovable-milestone directive correctly leaves it alone.
 */
export function ensureRunnableMilestone(
  milestones: PlanMilestone[],
  verificationCommand?: string | null
): PlanMilestone[] {
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
}

export interface WorkspaceScaffoldFacts {
  isGreenfield: boolean
  requirements: ScaffoldRequirement[]
}

/** Prepends only missing requirements supplied by project discovery. */
export function ensureScaffoldMilestones(
  milestones: PlanMilestone[],
  workspace?: WorkspaceScaffoldFacts | null
): PlanMilestone[] {
  if (!workspace?.isGreenfield || workspace.requirements.length === 0) return milestones

  const named = milestones.flatMap((m) => m.filePaths?.length ? m.filePaths : extractDeliverablePaths(m.title))
  const missing = workspace.requirements.filter((entry) => !named.includes(entry.path))
  if (missing.length === 0) return milestones

  const prepended: PlanMilestone[] = missing.map((entry) => ({
    id: '',
    title: `${entry.title} — \`${entry.path}\``,
    status: 'pending',
    filePaths: [entry.path],
    acceptanceCriteria: [`${entry.path} provides the accepted stack capability.`],
    proposedVerificationCommand: entry.proposedVerificationCommand,
    falsifiableHypothesis: `${entry.path} provides the accepted stack capability.`,
  }))

  return [...prepended, ...milestones].map((m, idx) => ({ ...m, id: `m-${idx + 1}` }))
}

/** Applies canonical normalisation without merging distinct interventions. */
export function compilePlanMilestones(
  milestones: PlanMilestone[],
  verificationCommand?: string | null,
  workspace?: WorkspaceScaffoldFacts | null
): PlanMilestone[] {
  // Closing the session is application control flow, never executable user work. Old persisted
  // plans are still recognised by isCompletionMilestoneTitle, but new canonical revisions drop
  // the synthetic “invoke finish” entry before normalisation and display.
  const operationalMilestones = milestones.filter((milestone) => !isCompletionMilestoneTitle(milestone))
  const compiled = ensureRunnableMilestone(normalizePlanFalsifiability(operationalMilestones), verificationCommand)
  return ensureScaffoldMilestones(compiled, workspace)
}

/**
 * Renders the canonical executable milestones shown in Plan review.
 *
 * The model response is only source material. Compilation can add project entry requirements,
 * attach the real verification command and consolidate criteria, so displaying the raw response
 * would let the user approve a different plan from the one the agent receives.
 */
export function renderPlanMilestones(milestones: readonly PlanMilestone[]): string {
  return milestones
    .map((milestone) => {
      const marker = milestone.status === 'verified'
        ? 'x'
        : milestone.status === 'in_progress'
          ? '>'
          : milestone.status === 'failed'
            ? '!'
            : ' '
      const files = milestone.filePaths?.length ? ` — files: ${milestone.filePaths.map((filePath) => `\`${filePath}\``).join(', ')}` : ''
      const criteria = milestone.acceptanceCriteria?.length ? `\n  - Criteria: ${milestone.acceptanceCriteria.join('; ')}` : ''
      const verification = milestone.verificationCommand
        ? ` — verify: \`${milestone.verificationCommand}\``
        : ''
      const proposed = milestone.proposedVerificationCommand
        ? ` — future check: \`${milestone.proposedVerificationCommand}\``
        : ''
      return `- [${marker}] ${milestone.id}: ${milestone.title}${files}${verification}${proposed}${criteria}`
    })
    .join('\n')
}

/** Renders the immutable structured plan as a review document. */
export function renderAgentPlanMarkdown(plan: Pick<AgentPlan, 'version' | 'objective' | 'decisions' | 'retainedEvidence' | 'milestones' | 'supersededWork'>): string {
  const sections = [`# Plan v${plan.version}`, `## Objective\n${plan.objective}`]
  if (plan.decisions.length > 0) {
    sections.push(`## Decisions and assumptions\n${plan.decisions.map((decision) => `- [${decision.source}] ${decision.statement}${decision.rationale ? ` — ${decision.rationale}` : ''}`).join('\n')}`)
  }
  sections.push(`## Interventions\n${renderPlanMilestones(plan.milestones)}`)
  if (plan.retainedEvidence.length > 0) {
    sections.push(`## Retained evidence\n${plan.retainedEvidence.map((item) => `- ${item.interventionId}: ${item.summary}${item.verificationReferences.length ? ` — ${item.verificationReferences.join('; ')}` : ''}`).join('\n')}`)
  }
  if (plan.supersededWork.length > 0) {
    sections.push(`## Superseded work\n${plan.supersededWork.map((item) => `- ${item.interventionId}: ${item.reason}`).join('\n')}`)
  }
  return sections.join('\n\n')
}
