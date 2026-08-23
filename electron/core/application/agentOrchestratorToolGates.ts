import type { AgentToolCall } from '../domain/agent/agentTypes'
import type { AgentExecutionMode } from '../../../src/types'
import type { AgentRuntimeModeFsm } from '../domain/agent/agentRuntimeMode'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import { agentToolExecutorService } from './agentToolExecutorService'
import { buildInstallCommand } from '../domain/agent/devToolchain'
import type { ApprovalResponse } from './agentOrchestratorTypes'

import type { AgentLogEntry } from '../domain/agent/agentTypes'

type EmitLog = (
  type: 'info' | 'tool_call' | 'terminal' | 'approval_request',
  message: string,
  detail?: string,
  meta?: Partial<AgentLogEntry>
) => void
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
}

export type ToolGateResult =
  | { outcome: 'denied' }
  | { outcome: 'allowed'; toolCallForExecution: AgentToolCall }

const MUTATING_TOOLS_REQUIRING_ASK_APPROVAL = [
  'run_command',
  'write_file',
  'replace_file_content',
  'multi_replace_file_content',
  'delete_file',
  'download_file',
  'ensure_tool',
]

/**
 * Always-Confirm Gate: git_commit rewrites shared git history, a harder-to-reverse action
 * than an in-workspace file edit, so it ALWAYS requires explicit user approval regardless of
 * agent mode (unlike write_file/delete_file, which execute autonomously in AGENT mode and are
 * only approval-gated in ASK mode below). PLAN mode never reaches this point for any tool
 * (handled by the caller's early return), so no special-casing is needed for it here.
 */
async function gateGitCommit(ctx: ToolGateContext): Promise<boolean> {
  const { parsedTool, episodicCompactor, emitLog, requestApproval, stepCount } = ctx
  const approval = await requestApproval({
    type: 'git_commit',
    target: parsedTool.parameters.commitMessage || 'Git Commit',
    contentOrCmd: parsedTool.parameters.commitMessage || '',
    parameters: parsedTool.parameters,
  })
  if (!approval.approved) {
    const feedback = `[USER DENIED] L'utente ha rifiutato il git_commit proposto. Non ripetere questo esatto commit; proponi un'alternativa o chiedi chiarimenti.`
    episodicCompactor.recordStep({ step: stepCount, tool: 'git_commit', status: 'BLOCKED', summary: 'User denied git_commit approval' }, feedback)
    emitLog('info', `🚫 git_commit rifiutato dall'utente.`)
    return false
  }
  return true
}

function approvalTypeForTool(tool: string): string {
  if (tool === 'run_command' || tool === 'ensure_tool') return 'terminal_cmd'
  if (tool === 'download_file') return 'download_file'
  if (tool === 'delete_file') return 'delete_file'
  if (tool === 'multi_replace_file_content') return 'multi_replace'
  if (tool === 'replace_file_content') return 'replace_chunk'
  return 'write_file'
}

/**
 * ASK Mode Human-Approval Gate: mutating tools are submitted for explicit user approval
 * instead of being executed or flatly denied. Must run BEFORE the FSM Tool Permission Gate:
 * ASK mode's allowedTools set deliberately excludes mutating tools (see agentRuntimeMode.ts),
 * so if this check ran after the FSM gate it would never be reached (FSM would already have
 * denied the call), silently breaking the approval UI despite the prompt/UI contract promising
 * it (promptPresets.ts: "modifying actions ... are submitted for user approval").
 */
async function gateAskModeMutation(ctx: ToolGateContext): Promise<{ toolCallForExecution: AgentToolCall } | 'denied' | 'not-mutating'> {
  const { parsedTool, episodicCompactor, emitLog, requestApproval, stepCount, workspacePath } = ctx
  if (!MUTATING_TOOLS_REQUIRING_ASK_APPROVAL.includes(parsedTool.tool)) return 'not-mutating'

  const approvalTarget = parsedTool.parameters.filePath || parsedTool.parameters.command || parsedTool.parameters.url || 'Target Action'
  const approval = await requestApproval({
    // ensure_tool is surfaced as the literal winget command it would run: approving a
    // system-level install should show exactly what is about to be executed, and it
    // reuses the existing terminal approval path end to end.
    type: approvalTypeForTool(parsedTool.tool),
    target: approvalTarget,
    contentOrCmd:
      (parsedTool.tool === 'ensure_tool' ? buildInstallCommand(String(parsedTool.parameters.toolName || '')) : undefined) ||
      parsedTool.parameters.command ||
      parsedTool.parameters.url ||
      parsedTool.parameters.targetContent ||
      parsedTool.parameters.content ||
      '',
    replacement: parsedTool.parameters.replacementContent,
    replacements: parsedTool.parameters.replacements,
    parameters: parsedTool.parameters,
  })
  if (!approval.approved) {
    const feedback = `[USER DENIED] L'utente ha rifiutato l'azione proposta (${parsedTool.tool} su "${approvalTarget}"). Non ripetere questa esatta azione; proponi un'alternativa o chiedi chiarimenti.`
    episodicCompactor.recordStep({ step: stepCount, tool: parsedTool.tool, status: 'BLOCKED', summary: 'User denied approval' }, feedback)
    emitLog('info', `🚫 Azione rifiutata dall'utente: ${parsedTool.tool}`)
    return 'denied'
  }
  const toolCallForExecution = agentToolExecutorService.reconcileHunkApproval(parsedTool, approval.approvedHunkIndices, workspacePath)
  return { toolCallForExecution }
}

function denyFsm(ctx: ToolGateContext) {
  const { parsedTool, fsmMode, episodicCompactor, emitLog, stepCount } = ctx
  const feedback = `[FSM PERMISSION DENIED] Tool "${parsedTool.tool}" is not permitted in ${fsmMode.getMode()} mode. Allowed tools: ${[...Array.from(Object.values(fsmMode.filterAllowedTools([parsedTool.tool as any])))].join(', ') || 'read-only tools only'}. Switch to AGENT mode to execute mutating operations.`
  episodicCompactor.recordStep({ step: stepCount, tool: parsedTool.tool, status: 'BLOCKED', summary: `FSM denied: ${parsedTool.tool} in ${fsmMode.getMode()} mode` }, feedback)
  emitLog('info', `🔒 [${fsmMode.getMode()}] Tool blocked: ${parsedTool.tool}`)
}

/**
 * Runs, in order: the always-on git_commit approval gate, the ASK-mode mutating-tool approval
 * gate, then the FSM tool-permission gate (skipped for a tool just explicitly approved by
 * either gate above). Mirrors the exact gate ordering from the original inline loop body —
 * see the gate doc-comments above for why each one must run where it does.
 */
export async function runToolGates(ctx: ToolGateContext): Promise<ToolGateResult> {
  let approvalGranted = false
  let toolCallForExecution: AgentToolCall = ctx.parsedTool

  if (ctx.parsedTool.tool === 'git_commit') {
    if (!(await gateGitCommit(ctx))) return { outcome: 'denied' }
    approvalGranted = true
  }

  if (ctx.agentMode === 'ask') {
    const askResult = await gateAskModeMutation(ctx)
    if (askResult === 'denied') return { outcome: 'denied' }
    if (askResult !== 'not-mutating') {
      approvalGranted = true
      toolCallForExecution = askResult.toolCallForExecution
    }
  }

  if (!approvalGranted && !ctx.fsmMode.isToolAllowed(ctx.parsedTool.tool as any)) {
    denyFsm(ctx)
    return { outcome: 'denied' }
  }

  return { outcome: 'allowed', toolCallForExecution }
}
