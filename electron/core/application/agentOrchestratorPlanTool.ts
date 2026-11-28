import { checkCommandSecurity } from '../domain/agent/commandSecurity'
import { DiagnosticOutputReducer } from '../domain/agent/diagnosticOutputReducer'
import { buildDiagnosticFixAdvice } from '../domain/agent/compilerDiagnosticDirective'
import { renderAdvice } from '../domain/agent/diagnosticAdvice'
import { checkVerificationCommandSafety, unsafeVerificationNote } from '../../../shared/domain/agent/verificationCommandSafety'
import { GoalDecompositionPlanner } from '../../../shared/domain/agent/planAndSolveGraph'
import { resolveMilestoneUpdate } from '../domain/agent/milestoneUpdateAuthority'
import { promotionNote, requiresVisualEvidence, WEB_UI_SMOKE_VERIFICATION } from '../domain/agent/milestoneVerificationPromotion'
import { findUnsatisfiedDeliverables, resolveMilestoneDeliverableStatus } from '../../../shared/domain/agent/milestoneDeliverableResolver'
import { captureMilestoneFileEvidence, captureWorkspaceVersion, createWorkspaceDeliverableProbe } from '../infrastructure/filesystem/workspaceDeliverableProbe'
import { missingAcceptanceDirectories, unreachableUiDeliverables } from '../infrastructure/filesystem/workspaceUiReachability'
import { discoverProjectProfile } from '../infrastructure/filesystem/projectProfileDiscovery'
import { resolvePrimaryProfileVerificationTargets } from '../domain/agent/projectProfileVerificationResolver'
import { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import { agentToolExecutorService } from './agentToolExecutorService'
import { verifyWebUi } from '../infrastructure/process/webUiSmokeVerifier'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import type { AgentToolCall } from '../domain/agent/agentTypes'
import type { EmitLog } from './agentOrchestratorTypes'
import type { PlanMilestone } from '../../../shared/domain/agent/planAndSolveGraph'
import type { AppSettings } from '../../../shared/types'

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
  signal?: AbortSignal
}

/** Handles the orchestrator-level `update_plan` pseudo-tool: the model's explicit handle on plan progression. */
export async function handleUpdatePlanTool(ctx: UpdatePlanToolContext): Promise<void> {
  const {
    parsedTool,
    goalPlanner,
    workspacePath,
    emitLog,
    emitStepUpdate,
    episodicCompactor,
    persistCurrentState,
    settings,
    sessionId,
    stepCount,
    maxStepsLabel,
  } = ctx

  const milestoneRef = String(parsedTool.parameters?.milestoneId || '')
  const nextStatus = String(parsedTool.parameters?.status || '') as PlanMilestone['status']
  const notes = parsedTool.parameters?.notes ? String(parsedTool.parameters.notes) : undefined

  let planFeedback: string
  let planLog: string
  let updateFailed = false

  const targetMilestone = goalPlanner.findMilestone(milestoneRef)
  const activeMilestone = goalPlanner.getActiveMilestone()
  if (!goalPlanner.hasPlan()) {
    updateFailed = true
    planFeedback = `[UPDATE_PLAN REJECTED] There is no execution plan in this session yet, so milestone '${milestoneRef}' cannot be updated. Produce a plan checklist first, or continue executing tools directly.`
    planLog = 'update_plan rejected: no active execution plan'
  } else if (targetMilestone && targetMilestone.status !== 'verified' && targetMilestone.status !== 'failed' && activeMilestone?.id !== targetMilestone.id) {
    updateFailed = true
    planFeedback = `[UPDATE_PLAN REJECTED: OUT OF ORDER] Complete and verify milestone '${activeMilestone?.id}' before updating '${targetMilestone.id}'. Work on one milestone at a time.`
    planLog = `update_plan rejected: '${targetMilestone.id}' is not the active milestone`
  } else {
    let effectiveStatus = nextStatus
    let effectiveNotes = notes
    let verificationRanLog: string | null = null
    /** Set when the milestone's declared proof was refused without being executed, or failed execution. */
    let refusedVerification: { command: string; note: string; failed?: boolean } | null = null

    const disconnected = nextStatus === 'verified' && targetMilestone && workspacePath ? unreachableUiDeliverables(workspacePath, targetMilestone) : []
    const missingDirectories = nextStatus === 'verified' && targetMilestone && workspacePath ? missingAcceptanceDirectories(workspacePath, targetMilestone) : []
    const primary = workspacePath ? resolvePrimaryProfileVerificationTargets(discoverProjectProfile(workspacePath))[0] : undefined
    const verifyCmd = targetMilestone?.verificationCommand || (nextStatus === 'verified' && primary?.command ? primary.command : undefined)

    if (missingDirectories.length > 0) {
      refusedVerification = {
        command: 'acceptance criteria',
        note: `Required source directories are missing: ${missingDirectories.join(', ')}. Create and connect them before verification.`,
      }
    } else if (disconnected.length > 0) {
      refusedVerification = {
        command: 'application entrypoint',
        note: `The declared UI module is not used by the application: ${disconnected.join(', ')}. Connect it through the active route or layout before verification.`,
      }
    } else if (nextStatus === 'verified' && targetMilestone && !verifyCmd) {
      refusedVerification = {
        command: 'project verification',
        note: 'A file on disk is not verification evidence. Run the project check; the application promotes the active milestone only after it passes.',
      }
    } else if (nextStatus === 'verified' && targetMilestone && verifyCmd) {
      // Re-checked here and not only at plan ingestion: a plan can arrive from a restored session or from the user editing the checklist in the UI, and executing a mutating "verification" is what rewrote the agent's own source in session-1787497654743-4enx.
      const safety = checkVerificationCommandSafety(verifyCmd)
      const secCheck = !safety.isSafe
        ? null
        : settings.fullAccess
          ? { isAllowed: true, requiresApproval: false, sanitizedCommand: verifyCmd }
          : checkCommandSecurity(verifyCmd, workspacePath)

      if (primary?.kind === 'typecheck' && /(?:^|\s)(?:eslint|npm run lint)\b/i.test(verifyCmd)) {
        refusedVerification = {
          command: verifyCmd,
          note: `Lint alone is insufficient for this TypeScript project. Run ${primary.command} and the build before closing.`,
        }
      } else if (!safety.isSafe) {
        refusedVerification = {
          command: verifyCmd,
          note: unsafeVerificationNote(verifyCmd, safety.reason || 'it is not a check'),
        }
      } else if (secCheck && (!secCheck.isAllowed || secCheck.requiresApproval)) {
        effectiveStatus = 'failed'
        effectiveNotes = `Verification command blocked by security policy: ${secCheck.blockedReason}`
        verificationRanLog = `🔒 Verification command blocked: ${verifyCmd}`
      } else if (secCheck) {
        const shell = agentToolExecutorService.getOrCreateShellSession(workspacePath)
        const verifyRes = await shell.execute(secCheck.sanitizedCommand, (chunk) => emitLog('terminal', chunk.trim()), undefined, 60000, ctx.signal)
        const workspaceVersion = verifyRes.code === 0 && !verifyRes.timedOut && workspacePath ? captureWorkspaceVersion(workspacePath) : undefined
        const passed = verifyRes.code === 0 && !verifyRes.timedOut && Boolean(workspaceVersion)
        const visual = passed && requiresVisualEvidence(targetMilestone) ? await verifyWebUi(workspacePath!, goalPlanner.getMilestones(), ctx.signal) : null
        const visualPassed = !visual || visual.status === 'passed'
        const proofCommand = visual ? WEB_UI_SMOKE_VERIFICATION : verifyCmd
        effectiveStatus = passed && visualPassed ? 'verified' : 'failed'
        // Both streams, not whichever is non-empty: a failed verification writes its banner to stdout and its reason to stderr, and selecting one hands the model a note that says the milestone failed without saying why.
        const outputTail = DiagnosticOutputReducer.composeCommandOutput(verifyRes.stdout, verifyRes.stderr, verifyRes.code).slice(-1500)
        effectiveNotes =
          passed && visualPassed ? promotionNote(proofCommand) : `Verification command failed (exit ${verifyRes.code}): ${verifyCmd}\n${outputTail}`
        if (passed && visualPassed && workspaceVersion) {
          targetMilestone.verificationCommand = verifyCmd
          targetMilestone.verificationEvidence = { command: proofCommand, passed: true, checkedAt: new Date().toISOString(), workspaceVersion }
        } else if (visual && !visualPassed) {
          refusedVerification = {
            command: WEB_UI_SMOKE_VERIFICATION,
            note: `${visual.detail || 'Browser verification did not pass.'} Fix the rendered application before marking this milestone verified.`,
            failed: true,
          }
        } else if (!passed) {
          const diagnostic = buildDiagnosticFixAdvice(outputTail)
          refusedVerification = {
            command: verifyCmd,
            note: `Verification command failed (exit ${verifyRes.code}): ${verifyCmd}\n${outputTail}\n${diagnostic ? renderAdvice(diagnostic) : 'Fix the reported errors in the workspace before marking the milestone verified.'}`,
            failed: true,
          }
        }
        verificationRanLog = passed ? `✅ Verification command passed: ${verifyCmd}` : `❌ Verification command failed (exit ${verifyRes.code}): ${verifyCmd}`
      }
    }

    // A refused or failing proof is its own answer, handled before the status machinery: the milestone keeps the status it had, so routing this through resolveMilestoneUpdate would come back as a "no-op" or "contradicted" rejection and the model would never learn that its declared verification failed
    if (refusedVerification && targetMilestone) {
      updateFailed = true
      goalPlanner.updateMilestone(targetMilestone.id, targetMilestone.status, refusedVerification.note)
      planFeedback = refusedVerification.failed
        ? `[UPDATE_PLAN REJECTED: VERIFICATION FAILED] Milestone '${milestoneRef}' verification \`${refusedVerification.command}\` failed:\n${refusedVerification.note}`
        : `[UPDATE_PLAN REJECTED: VERIFICATION REFUSED] Milestone '${milestoneRef}' declares \`${refusedVerification.command}\` as its proof, and that command was NOT executed: ${refusedVerification.note}\n` +
          `A verification command must be able to FAIL and must not write the workspace. Run a real check via run_command (a build, a test, a typecheck) and mark the milestone only after it passes.`
      planLog = refusedVerification.failed
        ? `❌ Verifica fallita: ${refusedVerification.command}`
        : `🚫 Verifica rifiutata senza eseguirla: ${refusedVerification.command}`
    } else {
      // Evidence on disk outranks the model's self-report: see milestoneUpdateAuthority.ts.
      const probe = workspacePath ? createWorkspaceDeliverableProbe(workspacePath) : null
      const authorityVerdict = targetMilestone
        ? resolveMilestoneUpdate({
            current: targetMilestone,
            requestedStatus: effectiveStatus,
            requestedNotes: effectiveNotes,
            deliverableStatus: probe ? resolveMilestoneDeliverableStatus(targetMilestone, probe) : 'not_applicable',
            unsatisfiedDeliverables: probe ? findUnsatisfiedDeliverables(targetMilestone, probe) : undefined,
          })
        : null

      if (authorityVerdict?.kind === 'reject') {
        updateFailed = true
        planFeedback = authorityVerdict.directive
        planLog = `update_plan rejected: ${authorityVerdict.reason}`
      } else if (
        goalPlanner.updateMilestone(milestoneRef, effectiveStatus, effectiveNotes ?? `Set to '${effectiveStatus}' by the model at step ${stepCount}.`)
      ) {
        if (effectiveStatus === 'verified' && workspacePath && targetMilestone) {
          const fileEvidence = captureMilestoneFileEvidence(workspacePath, targetMilestone)
          if (fileEvidence) targetMilestone.fileEvidence = fileEvidence
        }
        const progress = goalPlanner.getProgressSummary()
        const mismatchNote =
          effectiveStatus !== nextStatus
            ? ` [Model claimed '${nextStatus}' but real verification set it to '${effectiveStatus}' — do not report this milestone done until it actually is.]`
            : ''
        planFeedback = `[PLAN UPDATED] Milestone '${milestoneRef}' is now ${effectiveStatus}.${mismatchNote} Progress: ${progress.completed}/${progress.total} verified (${progress.percentage}%).`
        planLog = verificationRanLog || `📋 Plan updated: ${milestoneRef} → ${effectiveStatus} (${progress.completed}/${progress.total} verified)`
      } else {
        updateFailed = true
        const known = goalPlanner
          .getMilestones()
          .map((m) => `${m.id}: ${m.title}`)
          .join(' | ')
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
    planFeedback,
  )
  emitLog('info', planLog)
  emitStepUpdate(`Step ${stepCount}/${maxStepsLabel}`)
  if (settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logToolResult(sessionId, stepCount, 'update_plan', planFeedback)
  }
  await persistCurrentState()
}
