import type { AgentToolCall, SupportedToolName } from '../domain/agent/agentTypes'
import type { AgentTaskResult } from '../domain/agent/agentTypes'
import type { AgentApprovalPayload, AgentApprovalReason, AgentGuardEvent, AppSettings } from '../../../shared/types'
import type { AgentProgressPolicy } from '../domain/agent/agentProgressPolicy'
import { recordGuardEvent } from '../domain/agent/agentGuardEvents'
import type { ApplicationClosureOutcome, ApplicationClosureRequest } from './agentOrchestratorApplicationClosureTypes'
import type { AgentExecutionMode } from '../../../shared/types'
import type { AgentRuntimeModeFsm } from '../domain/agent/agentRuntimeMode'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import { AgentToolExecutorService, agentToolExecutorService } from './agentToolExecutorService'
import { buildInstallCommand } from '../domain/agent/devToolchain'
import { shellCommandHasEgress } from '../domain/agent/offlineStrictPolicy'
import { checkCommandSecurity } from '../domain/agent/commandSecurity'
import type { ApprovalResponse } from './agentOrchestratorTypes'
import path from 'node:path'
import { parseShellFileRead } from '../domain/agent/shellFileRead'

import { type EmitLog, emitLocalizedLog } from './agentOrchestratorTypes'

type RequestApproval = (payload: AgentApprovalPayload) => Promise<ApprovalResponse>

export interface ToolGateContext {
  parsedTool: AgentToolCall
  agentMode: AgentExecutionMode
  fsmMode: AgentRuntimeModeFsm
  workspacePath: string | null
  stepCount: number
  episodicCompactor: EpisodicMemoryCompactor
  emitLog: EmitLog
  requestApproval: RequestApproval
  capabilityPolicyMode: AppSettings['capabilityPolicyMode']
  allowedToolsForTurn?: readonly SupportedToolName[]
  requiredReadPath?: string
  runOwnedPaths?: readonly string[]
}

export type ToolGateResult =
  | {
      outcome: 'denied'
      /** Why the call was refused, sent back to the model as the tool result. */
      feedback: string
      /** Set when the application's turn policy (not the user) refused the call: it spends a step without progress. */
      policyDenial?: 'turn_policy'
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
async function gateGitCommit(ctx: ToolGateContext): Promise<AgentToolCall | { denied: string }> {
  const { parsedTool, episodicCompactor, emitLog, requestApproval, stepCount } = ctx
  let preview
  try {
    preview = agentToolExecutorService.previewGitCommit(ctx.workspacePath || process.cwd(), ctx.runOwnedPaths)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const feedback = `[GIT COMMIT NOT POSSIBLE] ${message}`
    episodicCompactor.recordStep({ step: stepCount, tool: 'git_commit', status: 'BLOCKED', summary: message }, feedback)
    emitLocalizedLog(emitLog, 'info', { key: 'gitCommitBlocked', params: { error: message } })
    return { denied: feedback }
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
    const feedback =
      '[USER DENIED] The user declined this git_commit. Do not propose the same commit again; continue without committing or ask the user what they want instead.'
    episodicCompactor.recordStep({ step: stepCount, tool: 'git_commit', status: 'BLOCKED', summary: 'User denied git_commit approval' }, feedback)
    emitLocalizedLog(emitLog, 'info', { key: 'gitCommitDenied' })
    return { denied: feedback }
  }
  return { ...parsedTool, parameters: commitParameters }
}

function approvalTypeForTool(tool: string): AgentApprovalPayload['type'] {
  if (tool === 'run_command' || tool === 'ensure_tool') return 'terminal_cmd'
  if (['web_search', 'fetch_web_content', 'open_in_browser', 'validate_visual_artifact'].includes(tool)) return 'network_request'
  if (tool === 'download_file') return 'download_file'
  if (tool === 'delete_file') return 'delete_file'
  if (tool === 'multi_replace_file_content') return 'multi_replace'
  if (tool === 'replace_file_content') return 'replace_chunk'
  return 'write_file'
}

function requiresNetworkConsent(tool: AgentToolCall, workspacePath: string | null): boolean {
  if (['web_search', 'fetch_web_content', 'download_file', 'ensure_tool'].includes(tool.tool)) return true
  if (tool.tool === 'open_in_browser') return /^https?:\/\//i.test(String(tool.parameters.url || ''))
  if (tool.tool !== 'run_command') return false
  const command = String(tool.parameters.command || '')
  return shellCommandHasEgress(command, AgentToolExecutorService.localNpxBinaries(command, workspacePath))
}

type ContextualConsent = {
  toolCallForExecution: AgentToolCall
  commandApprovalGranted: boolean
  policyConsent?: { requested: boolean; granted: boolean; consentId: string }
}

/** Collects every approval reason for one action and asks exactly once. */
async function gateContextualConsent(ctx: ToolGateContext): Promise<ContextualConsent | { denied: string } | undefined> {
  let toolCall = ctx.parsedTool
  let commandApprovalGranted = false
  if (toolCall.tool === 'run_command') {
    const security = checkCommandSecurity(
      String(toolCall.parameters.command || ''),
      ctx.workspacePath,
      agentToolExecutorService.currentShellDirectory(ctx.workspacePath),
    )
    if (!security.isAllowed) {
      const feedback = `[COMMAND SAFETY DENIED] ${security.blockedReason || 'Command rejected.'} The command was not run. Rewrite it as a simpler command, or use the dedicated file tools instead of the shell.`
      ctx.episodicCompactor.recordStep({ step: ctx.stepCount, tool: 'run_command', status: 'BLOCKED', summary: feedback }, feedback)
      emitLocalizedLog(ctx.emitLog, 'info', { key: 'commandBlocked', params: { reason: security.blockedReason || { key: 'commandUnsafe' } } })
      return { denied: feedback }
    }
    commandApprovalGranted = Boolean(security.requiresApproval)
    toolCall = { ...toolCall, parameters: { ...toolCall.parameters, command: security.sanitizedCommand } }
  }

  const requiresNetwork = ctx.capabilityPolicyMode === 'network-approved' && requiresNetworkConsent(toolCall, ctx.workspacePath)
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
      commandApprovalGranted && 'workspace_mutation',
      requiresNetwork && 'network_access',
      requiresInstall && 'external_installation',
      requiresGuided && 'guided_review',
    ].filter((reason): reason is AgentApprovalReason => Boolean(reason)),
  })
  if (!approval.approved) {
    const feedback = `[USER DENIED] The user declined ${toolCall.tool} on "${target}". It was not executed. Do not retry the same call; continue another way, or use "ask" if the task cannot proceed without it.`
    ctx.episodicCompactor.recordStep({ step: ctx.stepCount, tool: toolCall.tool, status: 'BLOCKED', summary: 'User denied contextual approval' }, feedback)
    emitLocalizedLog(ctx.emitLog, 'info', { key: 'actionDenied', params: { tool: toolCall.tool } })
    return { denied: feedback }
  }
  return {
    toolCallForExecution: agentToolExecutorService.reconcileHunkApproval(toolCall, approval.approvedHunkIndices, ctx.workspacePath),
    commandApprovalGranted,
    policyConsent: requiresNetwork ? { requested: true, granted: true, consentId: `consent-${Date.now()}-${ctx.stepCount}` } : undefined,
  }
}

function denyFsm(ctx: ToolGateContext): string {
  const { parsedTool, fsmMode, episodicCompactor, emitLog, stepCount } = ctx
  const allowedToolsList = fsmMode.filterAllowedTools([parsedTool.tool]).join(', ') || 'read-only tools only'
  const feedback = `[FSM PERMISSION DENIED] Tool "${parsedTool.tool}" is not permitted in ${fsmMode.getMode()} mode. Allowed tools: ${allowedToolsList}. Switch to GUIDED or AUTO mode to execute mutating operations.`
  episodicCompactor.recordStep(
    { step: stepCount, tool: parsedTool.tool, status: 'BLOCKED', summary: `FSM denied: ${parsedTool.tool} in ${fsmMode.getMode()} mode` },
    feedback,
  )
  emitLocalizedLog(emitLog, 'info', { key: 'modeToolBlocked', params: { mode: fsmMode.getMode(), tool: parsedTool.tool } })
  return feedback
}

/** Applies phase constraints, strict Ask read-only permissions, contextual consent, and the always-on git_commit gate. */
export async function runToolGates(ctx: ToolGateContext): Promise<ToolGateResult> {
  if (ctx.requiredReadPath) {
    const requested = String(ctx.parsedTool.parameters.filePath || '')
    const root = ctx.workspacePath ? path.resolve(ctx.workspacePath) : process.cwd()
    if (ctx.parsedTool.tool !== 'read_file' || path.resolve(root, requested) !== path.resolve(root, ctx.requiredReadPath)) {
      // The refresh is read-only and fully determined, so the application performs it instead of
      // refusing whatever else the model proposed: denying it cost 18 steps and a no_mutation stop
      // when qwen2.5-coder:7b kept proposing writes (full-task run 7, 2026-09-24).
      emitLocalizedLog(ctx.emitLog, 'info', { key: 'versionReadByApp', params: { path: ctx.requiredReadPath, proposed: ctx.parsedTool.tool } })
      return { outcome: 'allowed', toolCallForExecution: { tool: 'read_file', parameters: { filePath: ctx.requiredReadPath } } }
    }
  }

  // A shell command that only prints one workspace file runs as read_file: same text, plus the
  // [FILE VERSION] a later overwrite needs, and no command approval for a read (shellFileRead.ts).
  const shellRead = ctx.parsedTool.tool === 'run_command' ? parseShellFileRead(String(ctx.parsedTool.parameters.command || '')) : null
  const shellReadAllowed = !ctx.allowedToolsForTurn || ctx.allowedToolsForTurn.includes('run_command') || ctx.allowedToolsForTurn.includes('read_file')
  if (shellRead && ctx.workspacePath && shellReadAllowed) {
    const root = path.resolve(ctx.workspacePath)
    const absolute = path.resolve(root, shellRead)
    if (absolute.startsWith(`${root}${path.sep}`)) {
      const filePath = path.relative(root, absolute).replace(/\\/g, '/')
      emitLocalizedLog(ctx.emitLog, 'info', { key: 'shellReadAsReadFile', params: { path: filePath, command: String(ctx.parsedTool.parameters.command) } })
      return { outcome: 'allowed', toolCallForExecution: { tool: 'read_file', parameters: { filePath } } }
    }
  }

  if (ctx.allowedToolsForTurn && !ctx.allowedToolsForTurn.includes(ctx.parsedTool.tool)) {
    const allowed = ctx.allowedToolsForTurn.join(', ') || 'none'
    const feedback = `[TURN TOOL POLICY DENIED] Tool "${ctx.parsedTool.tool}" is not available for this phase. Available now: ${allowed}.`
    ctx.episodicCompactor.recordStep(
      { step: ctx.stepCount, tool: ctx.parsedTool.tool, status: 'BLOCKED', summary: `Turn policy denied: ${ctx.parsedTool.tool}` },
      feedback,
    )
    emitLocalizedLog(ctx.emitLog, 'info', { key: 'phaseToolBlocked', params: { tool: ctx.parsedTool.tool } })
    return { outcome: 'denied', feedback, policyDenial: 'turn_policy' }
  }

  // Ask is a hard read-only boundary. Network or command consent must never turn a
  // disallowed mutating tool into an executable one.
  if (ctx.agentMode === 'ask' && !ctx.fsmMode.isToolAllowed(ctx.parsedTool.tool)) {
    return { outcome: 'denied', feedback: denyFsm(ctx) }
  }

  let approvalGranted = false
  let toolCallForExecution: AgentToolCall = ctx.parsedTool
  let policyConsent: { requested: boolean; granted: boolean; consentId: string } | undefined
  let commandApprovalGranted = false
  const contextualConsent = await gateContextualConsent(ctx)
  if (contextualConsent && 'denied' in contextualConsent) return { outcome: 'denied', feedback: contextualConsent.denied }
  if (contextualConsent) {
    approvalGranted = true
    toolCallForExecution = contextualConsent.toolCallForExecution
    policyConsent = contextualConsent.policyConsent
    commandApprovalGranted = contextualConsent.commandApprovalGranted
  }

  if (ctx.parsedTool.tool === 'git_commit') {
    const approvedCommit = await gateGitCommit(ctx)
    if ('denied' in approvedCommit) return { outcome: 'denied', feedback: approvedCommit.denied }
    toolCallForExecution = approvedCommit
    approvalGranted = true
  }

  if (!approvalGranted && !ctx.fsmMode.isToolAllowed(ctx.parsedTool.tool)) {
    return { outcome: 'denied', feedback: denyFsm(ctx) }
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
