import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { logger } from '../../../diagnostics'
import { sanitizeLogMessage } from '../../../logRedactor'
import { AgentRunMetrics } from '../../domain/agent/agentRunMetrics'
import { createHash } from 'node:crypto'

/** Below this, eliding a shared prefix costs more in explanation than it saves. */
const MIN_ELIDABLE_PREFIX_CHARS = 400

export class CodingAgentLogger {
  private logFilePath: string
  private maxSizeBytes: number
  private maxRetainedFiles: number
  /** Previous turn prompt of each live session, kept to elide the part the next one repeats. */
  private previousPromptBySession = new Map<string, { step: number; prompt: string }>()
  private runMetricsBySession = new Map<string, AgentRunMetrics>()
  private payloadCaptureBySession = new Map<string, boolean>()

  constructor(options?: { logFilePath?: string; maxSizeBytes?: number; maxRetainedFiles?: number }) {
    const baseDir = app && typeof app.getPath === 'function' ? app.getPath('userData') : process.cwd()
    const logDir = path.join(baseDir, 'logs')
    if (!fs.existsSync(logDir)) {
      try {
        fs.mkdirSync(logDir, { recursive: true })
      } catch (err: any) {
        console.error('Failed creating log directory for coding agent audit:', err)
      }
    }
    this.logFilePath = options?.logFilePath || path.join(logDir, 'coding_agent_audit.log')
    this.maxSizeBytes = options?.maxSizeBytes ?? 10 * 1024 * 1024
    this.maxRetainedFiles = Math.max(1, options?.maxRetainedFiles ?? 2)
    this.cleanupRetainedFiles()
  }

  public getLogFilePath(): string {
    return this.logFilePath
  }

  public configureRetention(maxRetainedFiles: number): void {
    this.maxRetainedFiles = Math.max(1, Math.min(5, Math.floor(maxRetainedFiles)))
    this.cleanupRetainedFiles()
  }

  private includesPayload(sessionId: string): boolean {
    return this.payloadCaptureBySession.get(sessionId) === true
  }

  private static payloadSummary(label: string, value: string): string {
    const digest = createHash('sha256').update(value).digest('hex').slice(0, 12)
    return `${label}: [payload omitted] | Chars: ${value.length} | SHA-256: ${digest}`
  }

  /** Returns every persisted audit entry for one session, including rotated files. */
  public readSessionAuditLog(sessionId: string): string {
    if (!sessionId) return ''
    try {
      const logDir = path.dirname(this.logFilePath)
      const files = [
        ...Array.from({ length: this.maxRetainedFiles - 1 }, (_, index) =>
          path.join(logDir, `coding_agent_audit.${this.maxRetainedFiles - 1 - index}.log`)),
        this.logFilePath,
      ]
      const entries = files.flatMap((filePath) => {
        if (!fs.existsSync(filePath)) return []
        return fs.readFileSync(filePath, 'utf-8')
          .split(/\n={80}\n/)
          .filter((entry) => entry.includes(`Session: ${sessionId}`) || entry.includes(`Session ID: ${sessionId}`))
      })
      return entries.join('\n================================================================================\n').trim()
    } catch (err: any) {
      logger.log('WARN', 'CodingAgentLogger', `Failed reading audit log for session ${sessionId}: ${err?.message}`)
      return ''
    }
  }

  public clearAuditLog(): boolean {
    try {
      if (fs.existsSync(this.logFilePath)) {
        fs.writeFileSync(this.logFilePath, '', 'utf-8')
      }
      const logDir = path.dirname(this.logFilePath)
      for (let index = 1; index < this.maxRetainedFiles; index++) {
        const retainedFile = path.join(logDir, `coding_agent_audit.${index}.log`)
        if (fs.existsSync(retainedFile)) fs.writeFileSync(retainedFile, '', 'utf-8')
      }
      this.previousPromptBySession.clear()
      this.payloadCaptureBySession.clear()
      return true
    } catch (err: any) {
      logger.log('WARN', 'CodingAgentLogger', `Failed clearing audit log: ${err?.message}`)
      return false
    }
  }

  public removeSessionFromAuditLog(sessionId: string): boolean {
    if (!sessionId || typeof sessionId !== 'string') return false
    try {
      const logFiles = [
        this.logFilePath,
        path.join(path.dirname(this.logFilePath), 'coding_agent_audit.1.log'),
      ]

      for (const filePath of logFiles) {
        if (!fs.existsSync(filePath)) continue
        const raw = fs.readFileSync(filePath, 'utf-8')
        if (!raw.includes(sessionId)) continue

        const entries = raw.split(/\n={80}\n/)
        const filtered = entries.filter(
          (entry) => !entry.includes(`Session: ${sessionId}`) && !entry.includes(`Session ID: ${sessionId}`)
        )
        const cleaned = filtered.join('\n================================================================================\n')
        fs.writeFileSync(filePath, cleaned, 'utf-8')
      }
      return true
    } catch (err: any) {
      logger.log('WARN', 'CodingAgentLogger', `Failed removing session ${sessionId} from audit log: ${err?.message}`)
      return false
    }
  }

  private rotateIfNeeded(): void {
    try {
      if (!fs.existsSync(this.logFilePath)) return
      const stats = fs.statSync(this.logFilePath)
      if (stats.size >= this.maxSizeBytes) {
        const logDir = path.dirname(this.logFilePath)
        this.cleanupRetainedFiles()
        try {
          for (let index = this.maxRetainedFiles - 1; index >= 2; index--) {
            const source = path.join(logDir, `coding_agent_audit.${index - 1}.log`)
            const target = path.join(logDir, `coding_agent_audit.${index}.log`)
            if (fs.existsSync(target)) fs.unlinkSync(target)
            if (fs.existsSync(source)) fs.renameSync(source, target)
          }
          if (this.maxRetainedFiles > 1) fs.renameSync(this.logFilePath, path.join(logDir, 'coding_agent_audit.1.log'))
          else fs.writeFileSync(this.logFilePath, '', 'utf-8')
        } catch {
          fs.writeFileSync(this.logFilePath, '', 'utf-8')
        }
      }
    } catch (err: any) {
      console.error('CodingAgentLogger rotation failed:', err)
    }
  }

  private metricsFor(sessionId: string): AgentRunMetrics {
    let metrics = this.runMetricsBySession.get(sessionId)
    if (!metrics) {
      metrics = new AgentRunMetrics(sessionId)
      this.runMetricsBySession.set(sessionId, metrics)
    }
    return metrics
  }

  private cleanupRetainedFiles(): void {
    const logDir = path.dirname(this.logFilePath)
    try {
      for (const entry of fs.readdirSync(logDir)) {
        const match = entry.match(/^coding_agent_audit\.(\d+)\.log$/)
        if (match && Number(match[1]) >= this.maxRetainedFiles) fs.unlinkSync(path.join(logDir, entry))
      }
    } catch (err: any) {
      logger.log('WARN', 'CodingAgentLogger', `Failed cleaning retained audit logs: ${err?.message}`)
    }
  }

  private writeEntry(sectionHeader: string, bodyContent: string): void {
    try {
      this.rotateIfNeeded()
      const timestamp = new Date().toISOString()
      const formatted = `\n================================================================================\n[${timestamp}] ${sanitizeLogMessage(sectionHeader)}\n================================================================================\n${sanitizeLogMessage(bodyContent).trim()}\n`
      fs.appendFileSync(this.logFilePath, formatted, 'utf-8')
    } catch (err: any) {
      logger.log('WARN', 'CodingAgentLogger', `Failed writing agent audit log: ${err?.message}`)
    }
  }

  public logSessionStart(
    sessionId: string,
    userTask: string,
    mode: string,
    model: string,
    workspacePath?: string | null,
    includePayloads = false,
  ): void {
    this.payloadCaptureBySession.set(sessionId, includePayloads)
    const workspaceDetail = includePayloads
      ? `Workspace Path: ${workspacePath || 'Standalone'}`
      : CodingAgentLogger.payloadSummary('Workspace Path', workspacePath || 'Standalone')
    const content = [
      `Session ID: ${sessionId}`,
      `Starting Mode: ${mode.toUpperCase()}`,
      `Active Model: ${model}`,
      workspaceDetail,
      includePayloads ? `User Task:\n"""\n${userTask}\n"""` : CodingAgentLogger.payloadSummary('User Task', userTask),
    ].filter(Boolean).join('\n')

    this.writeEntry(`[AGENT SESSION START] Session: ${sessionId}`, content)
  }

  public logModeTransition(
    sessionId: string,
    fromMode: string,
    toMode: string,
    reason?: string
  ): void {
    const content = `Session ID: ${sessionId}
Mode Changed: ${fromMode.toUpperCase()} ➔ ${toMode.toUpperCase()}
${reason ? (this.includesPayload(sessionId) ? `Reason: ${reason}` : CodingAgentLogger.payloadSummary('Reason', reason)) : ''}`
    this.writeEntry(`[AGENT MODE TRANSITION] Session: ${sessionId}`, content)
  }

  public logPlanGeneration(
    sessionId: string,
    prompt: string,
    milestonesCount: number,
    mode: string
  ): void {
    const promptDetail = this.includesPayload(sessionId)
      ? `Source Prompt: "${prompt.slice(0, 300)}"`
      : CodingAgentLogger.payloadSummary('Source Prompt', prompt)
    const content = `Session ID: ${sessionId}
Mode: ${mode.toUpperCase()}
Generated Plan Milestones Count: ${milestonesCount}
${promptDetail}`
    this.writeEntry(`[PLAN GENERATION FLOW] Session: ${sessionId}`, content)
  }

  public logSkillsMatched(sessionId: string, skills: string[]): void {
    const content = `Session ID: ${sessionId}\nMatched Skills (${skills.length}):\n${skills.map((s) => `- ${s}`).join('\n') || 'None'}`
    this.writeEntry(`[SKILLS ACTIVATED] Session: ${sessionId}`, content)
  }

  /** Length of the longest prefix `a` and `b` share. */
  private static commonPrefixLength(a: string, b: string): number {
    const limit = Math.min(a.length, b.length)
    let i = 0
    while (i < limit && a.charCodeAt(i) === b.charCodeAt(i)) i++
    return i
  }

  public logTurnPrompt(
    sessionId: string,
    step: number,
    model: string,
    numCtx: number,
    prompt: string
  ): void {
    const header = `Session ID: ${sessionId} | Step: ${step} | Target Model: ${model} | Context Limit: ${numCtx}`
    if (!this.includesPayload(sessionId)) {
      this.writeEntry(
        `[STEP ${step} - PROMPT SENT TO LLM] Session: ${sessionId}`,
        `${header}\n${CodingAgentLogger.payloadSummary('Turn Prompt', prompt)}`,
      )
      return
    }
    const previous = this.previousPromptBySession.get(sessionId)
    this.previousPromptBySession.set(sessionId, { step, prompt })

    if (previous === undefined) {
      this.writeEntry(
        `[STEP ${step} - PROMPT SENT TO LLM] Session: ${sessionId}`,
        `${header} | Baseline: full prompt (${prompt.length} chars)
Turn Prompt Payload:
\`\`\`
${prompt.slice(0, 15000)}
\`\`\``
      )
      return
    }

    // Snap the boundary back to a line start: a raw character prefix cuts mid-token, so a delta would open with "2 with new trajectory" instead of the whole "PLAN: step 2 ..." line, and the reader cannot tell what changed without fetching the baseline.
    const rawShared = CodingAgentLogger.commonPrefixLength(previous.prompt, prompt)
    const sharedChars = prompt.lastIndexOf('\n', Math.max(0, rawShared - 1)) + 1

    if (sharedChars < MIN_ELIDABLE_PREFIX_CHARS) {
      this.writeEntry(
        `[STEP ${step} - PROMPT SENT TO LLM] Session: ${sessionId}`,
        `${header} | Diverged from step ${previous.step} (${prompt.length} chars)
Turn Prompt Payload:
\`\`\`
${prompt.slice(0, 15000)}
\`\`\``
      )
      return
    }

    const tail = prompt.slice(sharedChars)
    this.writeEntry(
      `[STEP ${step} - PROMPT SENT TO LLM] Session: ${sessionId}`,
      `${header} | Total: ${prompt.length} chars
[First ${sharedChars} chars identical to step ${previous.step}'s prompt — see that entry for ${sessionId}]
Turn Prompt Delta:
\`\`\`
${tail.slice(0, 15000)}
\`\`\``
    )
  }

  public logLlmResponse(sessionId: string, step: number, rawResponse: string): void {
    const content = this.includesPayload(sessionId) ? `Session ID: ${sessionId} | Step: ${step}
LLM Streamed Output:
\`\`\`
${rawResponse}
\`\`\`` : `Session ID: ${sessionId} | Step: ${step}\n${CodingAgentLogger.payloadSummary('LLM Streamed Output', rawResponse)}`
    this.writeEntry(`[STEP ${step} - LLM RESPONSE] Session: ${sessionId}`, content)
  }

  public logToolCall(
    sessionId: string,
    step: number,
    tool: string,
    parameters: Record<string, any>,
    explanation?: string
  ): void {
    this.metricsFor(sessionId).recordToolCall()
    const content = this.includesPayload(sessionId) ? `Session ID: ${sessionId} | Step: ${step}
Invoked Tool: ${tool}
Explanation: ${explanation || 'None provided'}
Parameters:
${JSON.stringify(parameters, null, 2)}` : `Session ID: ${sessionId} | Step: ${step}
Invoked Tool: ${tool}
Parameter Keys: ${Object.keys(parameters).sort().join(', ') || 'None'}
${CodingAgentLogger.payloadSummary('Tool Parameters', JSON.stringify(parameters))}`
    this.writeEntry(`[STEP ${step} - TOOL EXECUTION INITIATED] ${tool}`, content)
  }

  public logToolResult(
    sessionId: string,
    step: number,
    tool: string,
    result: string,
    isTerminal?: boolean,
    terminalDetail?: string
  ): void {
    if (tool === 'unparsed_tool' || tool === 'no_tool_detected' || result.includes('[TOOL PARSER REJECTION DIAGNOSTIC]')) {
      this.metricsFor(sessionId).recordInvalidTool()
    }
    const succeeded = !/\[TERMINAL AUTO-HEALING DIAGNOSTICS LOG\]|Security Violation|\[POLICY BLOCK\]|^Error:/i.test(result || '')
    this.metricsFor(sessionId).recordToolResult(succeeded, result, tool)
    const content = this.includesPayload(sessionId) ? `Session ID: ${sessionId} | Step: ${step} | Tool: ${tool} | IsTerminal: ${Boolean(isTerminal)}
Execution Result:
\`\`\`
${result}
\`\`\`
${terminalDetail ? `\nTerminal Raw Output:\n\`\`\`\n${terminalDetail}\n\`\`\`` : ''}` : `Session ID: ${sessionId} | Step: ${step} | Tool: ${tool} | IsTerminal: ${Boolean(isTerminal)}
Succeeded: ${succeeded}
${CodingAgentLogger.payloadSummary('Tool Result', `${result}${terminalDetail || ''}`)}`
    this.writeEntry(`[STEP ${step} - TOOL RESULT COMPLETED] ${tool}`, content)
  }

  /** Records one milestone changing status, with what caused it. */
  public logMilestoneTransition(
    sessionId: string,
    step: number,
    milestoneId: string,
    milestoneTitle: string,
    fromStatus: string,
    toStatus: string,
    cause: string
  ): void {
    if (toStatus.toLowerCase() === 'verified' && !/build|test|typecheck|lint|run_tests/i.test(cause)) {
      this.metricsFor(sessionId).recordFalseVerified()
    }
    const content = this.includesPayload(sessionId) ? `Session ID: ${sessionId} | Step: ${step}
Milestone: ${milestoneId} — ${milestoneTitle}
Transition: ${fromStatus.toUpperCase()} -> ${toStatus.toUpperCase()}
Cause: ${cause}` : `Session ID: ${sessionId} | Step: ${step}
Milestone: ${milestoneId}
Transition: ${fromStatus.toUpperCase()} -> ${toStatus.toUpperCase()}
${CodingAgentLogger.payloadSummary('Milestone Payload', `${milestoneTitle}\n${cause}`)}`
    this.writeEntry(`[STEP ${step} - MILESTONE ${milestoneId}: ${fromStatus.toUpperCase()} -> ${toStatus.toUpperCase()}] Session: ${sessionId}`, content)
  }

  public logPlanMilestoneUpdate(
    sessionId: string,
    step: number,
    milestones: { id: string; title: string; status: string; notes?: string }[],
    statusText?: string
  ): void {
    if (!milestones || milestones.length === 0) return
    const completed = milestones.filter((m) => m.status === 'verified').length
    const progressPercent = Math.round((completed / milestones.length) * 100)

    const milestoneLines = milestones
      .map((m, idx) => {
        let icon = '[ ]'
        if (m.status === 'verified') icon = '[x]'
        else if (m.status === 'in_progress') icon = '[>]'
        else if (m.status === 'failed') icon = '[!]'
        return this.includesPayload(sessionId)
          ? `${idx + 1}. ${icon} ${m.title} — Status: ${m.status.toUpperCase()}${m.notes ? ` (${m.notes})` : ''}`
          : `${idx + 1}. ${icon} ${m.id} — Status: ${m.status.toUpperCase()}`
      })
      .join('\n')

    const content = `Session ID: ${sessionId} | Step: ${step} | Progress: ${completed}/${milestones.length} (${progressPercent}%)${statusText ? ` | ${statusText}` : ''}
Structured Execution Plan Milestones:
${milestoneLines}`
    this.writeEntry(`[STEP ${step} - PLAN MILESTONES STATE] Session: ${sessionId}`, content)
  }

  public logLoopIntervention(
    sessionId: string,
    step: number,
    tool: string,
    target: string | undefined,
    repeatCount: number,
    interventionMessage: string
  ): void {
    const content = this.includesPayload(sessionId) ? `Session ID: ${sessionId} | Step: ${step} | Blocked Tool: ${tool} | Target: ${target || 'N/A'} | Duplicate Count: ${repeatCount}
Intervention Strategy Delivered to LLM:
\`\`\`
${interventionMessage}
\`\`\`` : `Session ID: ${sessionId} | Step: ${step} | Blocked Tool: ${tool} | Duplicate Count: ${repeatCount}
${CodingAgentLogger.payloadSummary('Intervention Payload', `${target || ''}\n${interventionMessage}`)}`
    this.writeEntry(`[STEP ${step} - LOOP INTERVENTION PREVENTED] ${tool}`, content)
  }

  public logSessionEnd(sessionId: string, totalSteps: number, success: boolean, summary: string): void {
    // The anchor exists only to elide repeated prompt text within one live session; keeping
    // it after the session ends would leak a full prompt per session for the process lifetime.
    this.previousPromptBySession.delete(sessionId)
    const metrics = this.metricsFor(sessionId)
    metrics.recordTaskOutcome(success)
    const content = `Session ID: ${sessionId}
Status: ${success ? 'COMPLETED' : 'STOPPED/FAILED'}
Total Steps: ${totalSteps}
Run Metrics:
${JSON.stringify(metrics.snapshot(), null, 2)}
${this.includesPayload(sessionId) ? `Final Summary:\n"""\n${summary}\n"""` : CodingAgentLogger.payloadSummary('Final Summary', summary)}`
    this.writeEntry(`[AGENT SESSION END] Session: ${sessionId}`, content)
    this.runMetricsBySession.delete(sessionId)
    this.payloadCaptureBySession.delete(sessionId)
  }
}

export const codingAgentLogger = new CodingAgentLogger()
