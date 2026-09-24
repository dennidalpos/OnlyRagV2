import type { AgentToolCall, SupportedToolName } from '../domain/agent/agentTypes'
import type { AgentTaskResult } from '../domain/agent/agentTypes'
import type { AgentGuardEvent } from '../../../shared/types'
import type { AgentProgressPolicy } from '../domain/agent/agentProgressPolicy'
import { recordGuardEvent } from '../domain/agent/agentGuardEvents'
import type { ApplicationClosureOutcome, ApplicationClosureRequest } from './agentOrchestratorApplicationClosureTypes'
import type { AgentExecutionMode } from '../../../shared/types'
import type { AgentRuntimeModeFsm } from '../domain/agent/agentRuntimeMode'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import { agentToolExecutorService } from './agentToolExecutorService'
import { buildInstallCommand } from '../domain/agent/devToolchain'
import { shellCommandHasEgress } from '../domain/agent/offlineStrictPolicy'
import { checkCommandSecurity } from '../domain/agent/commandSecurity'
import type { ApprovalResponse } from './agentOrchestratorTypes'
import path from 'node:path'

import type { AgentLogEntry } from '../domain/agent/agentTypes'

type EmitLog = (type: 'info' | 'tool_call' | 'terminal' | 'approval_request', message: string, detail?: string, meta?: Partial<AgentLogEntry>) => void
type RequestApproval = (payload: Record<string, unknown>) => Promise<ApprovalResponse>

export interface ToolGateContext {
  parsedTool: AgentToolCall
  agentMode: AgentExecutionMode
  fsmMode: AgentRuntimeModeFsm
  workspacePath: string | null
  stepCount: number
  episodicCompactor: EpisodicMemoryCompactor
  emitLog: EmitLog
  requestApproval: RequestApproval
  capabilityPolicyMode?: 'offline-strict' | 'local-only' | 'network-approved'
  allowedToolsForTurn?: readonly SupportedToolName[]
  requiredReadPath?: string
  runOwnedPaths?: readonly string[]
  isIsolatedWorkspace?: boolean
}

export type ToolGateResult =
  | {
      outcome: 'denied'
      feedback?: string
      /** Set when the application's turn policy (not the user) refused the call: it spends a step without progress. */
      policyDenial?: 'turn_policy' | 'version_recovery'
    }
  | {
      outcome: 'allowed'
      toolCallForExecution: AgentToolCall
      policyConsent?: { requested: boolean; granted: boolean; consentId: string }
      commandApprovalGranted?: boolean
    }

const MUTATING_TOOLS_REQUIRING_GUIDED_APPROVAL = [
  'create_directory',
  'copy_file',
  'move_file',
  'run_command',
  'run_tests',
  'write_file',
  'replace_file_content',
  'multi_replace_file_content',
  'delete_file',
  'download_file',
  'ensure_tool',
  'rollback_workspace',
  'rollback_last_step',
]

/** Always-Confirm Gate: git_commit rewrites shared git history, a harder-to-reverse action than an in-workspace file edit, so it ALWAYS requires explicit user approval regardless of agent mode (unlike write_file/delete_file, which execute autonomously in AGENT mo */
async function gateGitCommit(ctx: ToolGateContext): Promise<AgentToolCall | null> {
  const { parsedTool, episodicCompactor, emitLog, requestApproval, stepCount } = ctx
  let preview
  try {
    preview = agentToolExecutorService.previewGitCommit(ctx.workspacePath || process.cwd(), ctx.runOwnedPaths)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    episodicCompactor.recordStep({ step: stepCount, tool: 'git_commit', status: 'BLOCKED', summary: message }, message)
    emitLog('info', `Git commit bloccato: ${message}`)
    return null
  }
  const commitParameters = {
    ...parsedTool.parameters,
    commitPaths: preview.paths,
    commitDiff: preview.diffText,
    commitDiffHash: preview.diffHash,
  }
  const approval = await requestApproval({
    type: 'git_commit',
    target: parsedTool.parameters.commitMessage || 'Git Commit',
    contentOrCmd: parsedTool.parameters.commitMessage || '',
    parameters: commitParameters,
  })
  if (!approval.approved) {
    const feedback = `[USER DENIED] L'utente ha rifiutato il git_commit proposto. Non ripetere questo esatto commit; proponi un'alternativa o chiedi chiarimenti.`
    episodicCompactor.recordStep({ step: stepCount, tool: 'git_commit', status: 'BLOCKED', summary: 'User denied git_commit approval' }, feedback)
    emitLog('info', `🚫 git_commit rifiutato dall'utente.`)
    return null
  }
  return { ...parsedTool, parameters: commitParameters }
}

function approvalTypeForTool(tool: string): string {
  if (tool === 'run_command' || tool === 'ensure_tool') return 'terminal_cmd'
  if (tool === 'download_file') return 'download_file'
  if (tool === 'delete_file') return 'delete_file'
  if (tool === 'multi_replace_file_content') return 'multi_replace'
  if (tool === 'replace_file_content') return 'replace_chunk'
  return 'write_file'
}

function requiresNetworkConsent(tool: AgentToolCall): boolean {
  if (['web_search', 'fetch_web_content', 'download_file', 'ensure_tool'].includes(tool.tool)) return true
  if (tool.tool === 'open_in_browser') return /^https?:\/\//i.test(String(tool.parameters.url || ''))
  return tool.tool === 'run_command' && shellCommandHasEgress(String(tool.parameters.command || ''))
}

type ContextualConsent = {
  toolCallForExecution: AgentToolCall
  commandApprovalGranted: boolean
  policyConsent?: { requested: boolean; granted: boolean; consentId: string }
}

/** Collects every approval reason for one action and asks exactly once. */
async function gateContextualConsent(ctx: ToolGateContext): Promise<ContextualConsent | 'denied' | undefined> {
  let toolCall = ctx.parsedTool
  let commandApprovalGranted = false
  if (toolCall.tool === 'run_command') {
    const security = checkCommandSecurity(String(toolCall.parameters.command || ''), ctx.workspacePath)
    if (!security.isAllowed) {
      const feedback = `[COMMAND SAFETY DENIED] ${security.blockedReason || 'Command rejected.'}`
      ctx.episodicCompactor.recordStep({ step: ctx.stepCount, tool: 'run_command', status: 'BLOCKED', summary: feedback }, feedback)
      ctx.emitLog('info', `🔒 Comando bloccato: ${security.blockedReason || 'non sicuro'}`)
      return 'denied'
    }
    commandApprovalGranted = Boolean(security.requiresApproval)
    toolCall = { ...toolCall, parameters: { ...toolCall.parameters, command: security.sanitizedCommand } }
  }

  const requiresNetwork = ctx.capabilityPolicyMode === 'network-approved' && requiresNetworkConsent(toolCall)
  const requiresInstall = toolCall.tool === 'ensure_tool'
  const requiresGuided = ctx.agentMode === 'guided' && MUTATING_TOOLS_REQUIRING_GUIDED_APPROVAL.includes(toolCall.tool)
  if (!commandApprovalGranted && !requiresNetwork && !requiresInstall && !requiresGuided) return undefined

  const toolName = String(toolCall.parameters.toolName || '')
  const target =
    toolCall.parameters.filePath || toolCall.parameters.command || toolCall.parameters.url || toolCall.parameters.query || toolName || 'Target Action'
  const contentOrCmd =
    (requiresInstall ? buildInstallCommand(toolName) : undefined) ||
    toolCall.parameters.command ||
    toolCall.parameters.url ||
    toolCall.parameters.targetContent ||
    toolCall.parameters.content ||
    ''
  const approval = await ctx.requestApproval({
    type: approvalTypeForTool(toolCall.tool),
    target,
    contentOrCmd,
    replacement: toolCall.parameters.replacementContent,
    replacements: toolCall.parameters.replacements,
    parameters: toolCall.parameters,
    reasons: [
      commandApprovalGranted && 'workspace mutation',
      requiresNetwork && 'network access',
      requiresInstall && 'external installation',
      requiresGuided && 'Guided review',
    ].filter(Boolean),
  })
  if (!approval.approved) {
    const feedback = `[USER DENIED] L'utente ha rifiutato l'azione proposta (${toolCall.tool} su "${target}").`
    ctx.episodicCompactor.recordStep({ step: ctx.stepCount, tool: toolCall.tool, status: 'BLOCKED', summary: 'User denied contextual approval' }, feedback)
    ctx.emitLog('info', `🚫 Azione rifiutata dall'utente: ${toolCall.tool}`)
    return 'denied'
  }
  return {
    toolCallForExecution: agentToolExecutorService.reconcileHunkApproval(toolCall, approval.approvedHunkIndices, ctx.workspacePath),
    commandApprovalGranted,
    policyConsent: requiresNetwork ? { requested: true, granted: true, consentId: `consent-${Date.now()}-${ctx.stepCount}` } : undefined,
  }
}

function denyFsm(ctx: ToolGateContext) {
  const { parsedTool, fsmMode, episodicCompactor, emitLog, stepCount } = ctx
  const allowedToolsList = fsmMode.filterAllowedTools([parsedTool.tool]).join(', ') || 'read-only tools only'
  const feedback = `[FSM PERMISSION DENIED] Tool "${parsedTool.tool}" is not permitted in ${fsmMode.getMode()} mode. Allowed tools: ${allowedToolsList}. Switch to GUIDED or AUTO mode to execute mutating operations.`
  episodicCompactor.recordStep(
    { step: stepCount, tool: parsedTool.tool, status: 'BLOCKED', summary: `FSM denied: ${parsedTool.tool} in ${fsmMode.getMode()} mode` },
    feedback,
  )
  emitLog('info', `🔒 [${fsmMode.getMode()}] Tool blocked: ${parsedTool.tool}`)
}

/** Applies phase constraints, strict Ask read-only permissions, contextual consent, and the always-on git_commit gate. */
export async function runToolGates(ctx: ToolGateContext): Promise<ToolGateResult> {
  if (ctx.allowedToolsForTurn && !ctx.allowedToolsForTurn.includes(ctx.parsedTool.tool)) {
    const allowed = ctx.allowedToolsForTurn.join(', ') || 'none'
    const feedback = `[TURN TOOL POLICY DENIED] Tool "${ctx.parsedTool.tool}" is not available for this phase. Available now: ${allowed}.`
    ctx.episodicCompactor.recordStep(
      { step: ctx.stepCount, tool: ctx.parsedTool.tool, status: 'BLOCKED', summary: `Turn policy denied: ${ctx.parsedTool.tool}` },
      feedback,
    )
    ctx.emitLog('info', `🧰 Tool blocked by current phase: ${ctx.parsedTool.tool}`)
    return { outcome: 'denied', feedback, policyDenial: 'turn_policy' }
  }

  if (ctx.requiredReadPath) {
    const requested = String(ctx.parsedTool.parameters.filePath || '')
    const root = ctx.workspacePath ? path.resolve(ctx.workspacePath) : process.cwd()
    if (ctx.parsedTool.tool !== 'read_file' || path.resolve(root, requested) !== path.resolve(root, ctx.requiredReadPath)) {
      const feedback = `[FILE VERSION RECOVERY DENIED] Read "${ctx.requiredReadPath}" before proposing another edit.`
      ctx.episodicCompactor.recordStep(
        { step: ctx.stepCount, tool: ctx.parsedTool.tool, status: 'BLOCKED', summary: 'Required version refresh was not performed' },
        feedback,
      )
      ctx.emitLog('info', `🔒 Lettura versione richiesta: ${ctx.requiredReadPath}`)
      return { outcome: 'denied', feedback, policyDenial: 'version_recovery' }
    }
  }

  // Ask is a hard read-only boundary. Network or command consent must never turn a
  // disallowed mutating tool into an executable one.
  if (ctx.agentMode === 'ask' && !ctx.fsmMode.isToolAllowed(ctx.parsedTool.tool)) {
    denyFsm(ctx)
    return { outcome: 'denied' }
  }

  let approvalGranted = false
  let toolCallForExecution: AgentToolCall = ctx.parsedTool
  let policyConsent: { requested: boolean; granted: boolean; consentId: string } | undefined
  let commandApprovalGranted = false
  if (ctx.isIsolatedWorkspace && ctx.parsedTool.tool === 'git_commit') {
    const feedback =
      '[ISOLATED WORKSPACE] Git commits are disabled during an isolated run. Publish the reviewed workspace changes first, then commit them from the user workspace.'
    ctx.episodicCompactor.recordStep(
      { step: ctx.stepCount, tool: 'git_commit', status: 'BLOCKED', summary: 'Git commit deferred until workspace publication' },
      feedback,
    )
    ctx.emitLog('info', 'Git commit rinviato: pubblica prima le modifiche isolate.')
    return { outcome: 'denied' }
  }
  const contextualConsent = await gateContextualConsent(ctx)
  if (contextualConsent === 'denied') return { outcome: 'denied' }
  if (contextualConsent) {
    approvalGranted = true
    toolCallForExecution = contextualConsent.toolCallForExecution
    policyConsent = contextualConsent.policyConsent
    commandApprovalGranted = contextualConsent.commandApprovalGranted
  }

  if (ctx.parsedTool.tool === 'git_commit') {
    const approvedCommit = await gateGitCommit(ctx)
    if (!approvedCommit) return { outcome: 'denied' }
    toolCallForExecution = approvedCommit
    approvalGranted = true
  }

  if (!approvalGranted && !ctx.fsmMode.isToolAllowed(ctx.parsedTool.tool)) {
    denyFsm(ctx)
    return { outcome: 'denied' }
  }

  return { outcome: 'allowed', toolCallForExecution, policyConsent, commandApprovalGranted }
}

/**
 * A call refused by the turn policy is a step without progress: it is recorded as a `tool_policy`
 * guard and spends the same no-mutation budget as an executed read, so a model that keeps calling
 * a blocked tool stops on `no_mutation` instead of burning the whole step budget.
 */
export async function recordToolPolicyDenial(
  state: { guardEvents: AgentGuardEvent[]; progress: AgentProgressPolicy },
  stepCount: number,
  closeApplicationRun: (request: ApplicationClosureRequest) => Promise<ApplicationClosureOutcome>,
): Promise<AgentTaskResult | null> {
  recordGuardEvent(state.guardEvents, 'tool_policy', 'advise', stepCount)
  const stop = state.progress.onStepExecuted(false)
  if (!stop) return null
  const closure = await closeApplicationRun({ trigger: 'guard_stop', guard: stop.guard, reason: stop.reason })
  return closure.outcome === 'closed' ? closure.result : null
}
