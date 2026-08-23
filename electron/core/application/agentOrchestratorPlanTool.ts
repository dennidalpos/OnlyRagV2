import { checkCommandSecurity } from '../domain/agent/commandSecurity'
import { checkVerificationCommandSafety, unsafeVerificationNote } from '../domain/agent/verificationCommandSafety'
import { GoalDecompositionPlanner } from '../domain/agent/planAndSolveGraph'
import { resolveMilestoneUpdate } from '../domain/agent/milestoneUpdateAuthority'
import { resolveMilestoneDeliverableStatus } from '../domain/agent/milestoneDeliverableResolver'
import { createWorkspaceDeliverableProbe } from '../infrastructure/filesystem/workspaceDeliverableProbe'
import { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import { agentToolExecutorService } from './agentToolExecutorService'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import type { AgentToolCall, AgentLogEntry } from '../domain/agent/agentTypes'
import type { PlanMilestone } from '../domain/agent/planAndSolveGraph'
import type { AppSettings } from '../../../src/types'

type EmitLog = (
  type: 'info' | 'tool_call' | 'terminal' | 'approval_request',
  message: string,
  detail?: string,
  meta?: Partial<AgentLogEntry>
) => void

export interface UpdatePlanToolContext {
  parsedTool: AgentToolCall
  goalPlanner: GoalDecompositionPlanner
  workspacePath: string | null
  emitLog: EmitLog
  emitStepUpdate: (statusText?: string) => void
  episodicCompactor: EpisodicMemoryCompactor
  persistCurrentState: () => Promise<void>
  settings: AppSettings
  sessionId: string
  stepCount: number
  maxStepsLabel: string
}

/**
 * Handles the orchestrator-level `update_plan` pseudo-tool: the model's explicit handle on
 * plan progression. A model declaring a milestone "verified" is just self-reported prose
 * unless the milestone carries a verificationCommand — when it does, this runs that command
 * for real (through the workspace's persistent shell) instead of trusting the claim, and lets
 * the actual exit code decide the status. Closes the loophole where a model marks its own
 * work verified with no check.
 *
 * Always resolves (never throws); the caller's loop should `continue` after awaiting this.
 */
export async function handleUpdatePlanTool(ctx: UpdatePlanToolContext): Promise<void> {
  const { parsedTool, goalPlanner, workspacePath, emitLog, emitStepUpdate, episodicCompactor, persistCurrentState, settings, sessionId, stepCount, maxStepsLabel } = ctx

  const milestoneRef = String(parsedTool.parameters?.milestoneId || '')
  const nextStatus = String(parsedTool.parameters?.status || '') as PlanMilestone['status']
  const notes = parsedTool.parameters?.notes ? String(parsedTool.parameters.notes) : undefined

  let planFeedback: string
  let planLog: string
  let updateFailed = false

  if (!goalPlanner.hasPlan()) {
    updateFailed = true
    planFeedback = `[UPDATE_PLAN REJECTED] There is no execution plan in this session yet, so milestone '${milestoneRef}' cannot be updated. Produce a plan checklist first, or continue executing tools directly.`
    planLog = 'update_plan rejected: no active execution plan'
  } else {
    const targetMilestone = goalPlanner.findMilestone(milestoneRef)
    let effectiveStatus = nextStatus
    let effectiveNotes = notes
    let verificationRanLog: string | null = null
    /** Set when the milestone's declared proof was refused without being executed. */
    let refusedVerification: { command: string; note: string } | null = null

    if (nextStatus === 'verified' && targetMilestone?.verificationCommand) {
      const verifyCmd = targetMilestone.verificationCommand
      // Re-checked here and not only at plan ingestion: a plan can arrive from a restored
      // session or from the user editing the checklist in the UI, and executing a mutating
      // "verification" is what rewrote the agent's own source in session-1787497654743-4enx.
      const safety = checkVerificationCommandSafety(verifyCmd)
      const secCheck = safety.isSafe ? checkCommandSecurity(verifyCmd) : null

      if (!safety.isSafe) {
        refusedVerification = {
          command: verifyCmd,
          note: unsafeVerificationNote(verifyCmd, safety.reason || 'it is not a check'),
        }
      } else if (secCheck && !secCheck.isAllowed) {
        effectiveStatus = 'failed'
        effectiveNotes = `Verification command blocked by security policy: ${secCheck.blockedReason}`
        verificationRanLog = `🔒 Verification command blocked: ${verifyCmd}`
      } else if (secCheck) {
        const shell = agentToolExecutorService.getOrCreateShellSession(workspacePath)
        const verifyRes = await shell.execute(
          secCheck.sanitizedCommand,
          (chunk) => emitLog('terminal', chunk.trim()),
          undefined,
          60000
        )
        const passed = verifyRes.code === 0 && !verifyRes.timedOut
        effectiveStatus = passed ? 'verified' : 'failed'
        const outputTail = (verifyRes.stdout || verifyRes.stderr || '').trim().slice(-1500)
        effectiveNotes = passed
          ? `Auto-verified by running: ${verifyCmd}`
          : `Verification command failed (exit ${verifyRes.code}): ${verifyCmd}\n${outputTail}`
        verificationRanLog = passed
          ? `✅ Verification command passed: ${verifyCmd}`
          : `❌ Verification command failed (exit ${verifyRes.code}): ${verifyCmd}`
      }
    }

    // A refused proof is its own answer, handled before the status machinery: the milestone
    // keeps the status it had, so routing this through resolveMilestoneUpdate would come back
    // as a "no-op" rejection and the model would never learn that its declared verification
    // is the problem. The note goes on the milestone so the plan says so too.
    if (refusedVerification && targetMilestone) {
      updateFailed = true
      goalPlanner.updateMilestone(targetMilestone.id, targetMilestone.status, refusedVerification.note)
      planFeedback =
        `[UPDATE_PLAN REJECTED: VERIFICATION REFUSED] Milestone '${milestoneRef}' declares \`${refusedVerification.command}\` as its proof, and that command was NOT executed: ${refusedVerification.note}\n` +
        `A verification command must be able to FAIL and must not write the workspace. Run a real check via run_command (a build, a test, a typecheck) and mark the milestone only after it passes.`
      planLog = `🚫 Verifica rifiutata senza eseguirla: ${refusedVerification.command}`
    } else {
      // Evidence on disk outranks the model's self-report: see milestoneUpdateAuthority.ts.
      // Checked after the verificationCommand run above, so a command that genuinely failed can
      // still record a failure, and before the write, so a rejected update never lands.
      const authorityVerdict = targetMilestone
        ? resolveMilestoneUpdate({
            current: targetMilestone,
            requestedStatus: effectiveStatus,
            requestedNotes: effectiveNotes,
            deliverableStatus: workspacePath
              ? resolveMilestoneDeliverableStatus(targetMilestone.title, createWorkspaceDeliverableProbe(workspacePath))
              : 'not_applicable',
          })
        : null

      if (authorityVerdict?.kind === 'reject') {
        updateFailed = true
        planFeedback = authorityVerdict.directive
        planLog = `update_plan rejected: ${authorityVerdict.reason}`
      } else if (goalPlanner.updateMilestone(milestoneRef, effectiveStatus, effectiveNotes ?? `Set to '${effectiveStatus}' by the model at step ${stepCount}.`)) {
        const progress = goalPlanner.getProgressSummary()
        const mismatchNote =
          effectiveStatus !== nextStatus
            ? ` [Model claimed '${nextStatus}' but real verification set it to '${effectiveStatus}' — do not report this milestone done until it actually is.]`
            : ''
        planFeedback = `[PLAN UPDATED] Milestone '${milestoneRef}' is now ${effectiveStatus}.${mismatchNote} Progress: ${progress.completed}/${progress.total} verified (${progress.percentage}%).`
        planLog = verificationRanLog || `📋 Plan updated: ${milestoneRef} → ${effectiveStatus} (${progress.completed}/${progress.total} verified)`
      } else {
        updateFailed = true
        const known = goalPlanner.getMilestones().map((m) => `${m.id}: ${m.title}`).join(' | ')
        planFeedback = `[UPDATE_PLAN REJECTED] No milestone matches '${milestoneRef}'. Known milestones: ${known}. Use the exact milestone id.`
        planLog = `update_plan rejected: unknown milestone '${milestoneRef}'`
      }
    }
  }

  episodicCompactor.recordStep(
    {
      step: stepCount,
      tool: 'update_plan',
      target: milestoneRef,
      status: updateFailed ? 'FAILURE' : 'SUCCESS',
      summary: planLog,
    },
    planFeedback
  )
  emitLog('info', planLog)
  emitStepUpdate(`Step ${stepCount}/${maxStepsLabel}`)
  if (settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logToolResult(sessionId, stepCount, 'update_plan', planFeedback)
  }
  await persistCurrentState()
}
