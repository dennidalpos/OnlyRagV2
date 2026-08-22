import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { logger } from '../../../diagnostics'
import type { ComplexityRouteResult } from '../../domain/agent/complexityEvaluator'

export interface ModelTiersConfig {
  fastModel?: string
  standardModel?: string
  deepReasoningModel?: string
  heavyModel?: string
  useComplexityRouting?: boolean
  hardwareProfile?: string
}

export class CodingAgentLogger {
  private logFilePath: string
  private maxSizeBytes = 10 * 1024 * 1024 // 10 MB per audit log

  constructor() {
    const baseDir = app && typeof app.getPath === 'function' ? app.getPath('userData') : process.cwd()
    const logDir = path.join(baseDir, 'logs')
    if (!fs.existsSync(logDir)) {
      try {
        fs.mkdirSync(logDir, { recursive: true })
      } catch (err: any) {
        console.error('Failed creating log directory for coding agent audit:', err)
      }
    }
    this.logFilePath = path.join(logDir, 'coding_agent_audit.log')
  }

  public getLogFilePath(): string {
    return this.logFilePath
  }

  public clearAuditLog(): boolean {
    try {
      if (fs.existsSync(this.logFilePath)) {
        fs.writeFileSync(this.logFilePath, '', 'utf-8')
      }
      const logDir = path.dirname(this.logFilePath)
      const oldFile = path.join(logDir, 'coding_agent_audit.1.log')
      if (fs.existsSync(oldFile)) {
        fs.writeFileSync(oldFile, '', 'utf-8')
      }
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
        const oldFile = path.join(logDir, 'coding_agent_audit.1.log')
        try {
          if (fs.existsSync(oldFile)) {
            fs.unlinkSync(oldFile)
          }
          fs.renameSync(this.logFilePath, oldFile)
        } catch {
          fs.writeFileSync(this.logFilePath, '', 'utf-8')
        }
      }
    } catch (err: any) {
      console.error('CodingAgentLogger rotation failed:', err)
    }
  }

  private writeEntry(sectionHeader: string, bodyContent: string): void {
    try {
      this.rotateIfNeeded()
      const timestamp = new Date().toISOString()
      const formatted = `\n================================================================================\n[${timestamp}] ${sectionHeader}\n================================================================================\n${bodyContent.trim()}\n`
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
    tiersConfig?: ModelTiersConfig,
    initialComplexity?: ComplexityRouteResult
  ): void {
    const tierLines = tiersConfig ? [
      `Complexity Routing Active: ${tiersConfig.useComplexityRouting !== false ? 'YES' : 'NO'}`,
      `Hardware Profile: ${tiersConfig.hardwareProfile || 'Auto'}`,
      `Configured Model Tiers Matrix:`,
      `  🟢 Fast Tier: ${tiersConfig.fastModel || 'default'}`,
      `  🔵 Standard Tier: ${tiersConfig.standardModel || model}`,
      `  🟣 Deep Reasoning Tier: ${tiersConfig.deepReasoningModel || 'default'}`,
      `  🔶 Heavy Escalation Tier: ${tiersConfig.heavyModel || 'none'}`,
    ].join('\n') : ''

    const complexityLines = initialComplexity ? [
      `Initial Complexity Route Result:`,
      `  Tier: ${initialComplexity.tier.toUpperCase()} (${initialComplexity.tierName})`,
      `  Selected Model: ${initialComplexity.modelName}`,
      `  Reasoning: ${initialComplexity.reasoning}`,
      `  Is Escalated: ${Boolean(initialComplexity.isEscalated)} | Is Fallback: ${Boolean(initialComplexity.isFallback)}`,
    ].join('\n') : ''

    const content = [
      `Session ID: ${sessionId}`,
      `Starting Mode: ${mode.toUpperCase()}`,
      `Active Model: ${model}`,
      `Workspace Path: ${workspacePath || 'Standalone'}`,
      tierLines,
      complexityLines,
      `User Task:`,
      `"""`,
      `${userTask}`,
      `"""`,
    ].filter(Boolean).join('\n')

    this.writeEntry(`[AGENT SESSION START] Session: ${sessionId}`, content)
  }

  public logComplexityRouting(
    sessionId: string,
    step: number,
    routing: ComplexityRouteResult,
    targetModel: string
  ): void {
    const content = `Session ID: ${sessionId} | Step: ${step}
Routing Tier: ${routing.tier.toUpperCase()} (${routing.tierName})
Target Model: ${targetModel}
Reasoning: ${routing.reasoning}
Is Escalated: ${Boolean(routing.isEscalated)} | Is Fallback: ${Boolean(routing.isFallback)}`
    this.writeEntry(`[STEP ${step} - COMPLEXITY ROUTING EVALUATED] Session: ${sessionId}`, content)
  }

  public logModelEscalation(
    sessionId: string,
    step: number,
    fromModel: string,
    toModel: string,
    reason: string,
    tierLabel?: string
  ): void {
    const content = `Session ID: ${sessionId} | Step: ${step}
Escalated From: ${fromModel}
Escalated To: ${toModel}${tierLabel ? ` (${tierLabel})` : ''}
Trigger Reason: ${reason}`
    this.writeEntry(`[STEP ${step} - MODEL ESCALATION CASCADE] Session: ${sessionId}`, content)
  }

  public logModeTransition(
    sessionId: string,
    fromMode: string,
    toMode: string,
    reason?: string
  ): void {
    const content = `Session ID: ${sessionId}
Mode Changed: ${fromMode.toUpperCase()} ➔ ${toMode.toUpperCase()}
${reason ? `Reason: ${reason}` : ''}`
    this.writeEntry(`[AGENT MODE TRANSITION] Session: ${sessionId}`, content)
  }

  public logPlanGeneration(
    sessionId: string,
    prompt: string,
    milestonesCount: number,
    mode: string
  ): void {
    const content = `Session ID: ${sessionId}
Mode: ${mode.toUpperCase()}
Generated Plan Milestones Count: ${milestonesCount}
Source Prompt: "${prompt.slice(0, 300)}"`
    this.writeEntry(`[PLAN GENERATION FLOW] Session: ${sessionId}`, content)
  }

  public logSkillsMatched(sessionId: string, skills: string[]): void {
    const content = `Session ID: ${sessionId}\nMatched Skills (${skills.length}):\n${skills.map((s) => `- ${s}`).join('\n') || 'None'}`
    this.writeEntry(`[SKILLS ACTIVATED] Session: ${sessionId}`, content)
  }

  public logTurnPrompt(
    sessionId: string,
    step: number,
    model: string,
    numCtx: number,
    prompt: string
  ): void {
    const content = `Session ID: ${sessionId} | Step: ${step} | Target Model: ${model} | Context Limit: ${numCtx}
Turn Prompt Payload:
\`\`\`
${prompt.slice(0, 15000)}
\`\`\``
    this.writeEntry(`[STEP ${step} - PROMPT SENT TO LLM] Session: ${sessionId}`, content)
  }

  public logLlmResponse(sessionId: string, step: number, rawResponse: string): void {
    const content = `Session ID: ${sessionId} | Step: ${step}
LLM Streamed Output:
\`\`\`
${rawResponse}
\`\`\``
    this.writeEntry(`[STEP ${step} - LLM RESPONSE] Session: ${sessionId}`, content)
  }

  public logToolCall(
    sessionId: string,
    step: number,
    tool: string,
    parameters: Record<string, any>,
    explanation?: string
  ): void {
    const content = `Session ID: ${sessionId} | Step: ${step}
Invoked Tool: ${tool}
Explanation: ${explanation || 'None provided'}
Parameters:
${JSON.stringify(parameters, null, 2)}`
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
    const content = `Session ID: ${sessionId} | Step: ${step} | Tool: ${tool} | IsTerminal: ${Boolean(isTerminal)}
Execution Result:
\`\`\`
${result}
\`\`\`
${terminalDetail ? `\nTerminal Raw Output:\n\`\`\`\n${terminalDetail}\n\`\`\`` : ''}`
    this.writeEntry(`[STEP ${step} - TOOL RESULT COMPLETED] ${tool}`, content)
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
        return `${idx + 1}. ${icon} ${m.title} — Status: ${m.status.toUpperCase()}${m.notes ? ` (${m.notes})` : ''}`
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
    const content = `Session ID: ${sessionId} | Step: ${step} | Blocked Tool: ${tool} | Target: ${target || 'N/A'} | Duplicate Count: ${repeatCount}
Intervention Strategy Delivered to LLM:
\`\`\`
${interventionMessage}
\`\`\``
    this.writeEntry(`[STEP ${step} - LOOP INTERVENTION PREVENTED] ${tool}`, content)
  }

  public logSessionEnd(sessionId: string, totalSteps: number, success: boolean, summary: string): void {
    const content = `Session ID: ${sessionId}
Status: ${success ? 'COMPLETED' : 'STOPPED/FAILED'}
Total Steps: ${totalSteps}
Final Summary:
"""
${summary}
"""`
    this.writeEntry(`[AGENT SESSION END] Session: ${sessionId}`, content)
  }
}

export const codingAgentLogger = new CodingAgentLogger()
