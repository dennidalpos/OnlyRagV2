import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { logger } from '../../../diagnostics'

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
    workspacePath?: string | null
  ): void {
    const content = `Session ID: ${sessionId}
Mode: ${mode.toUpperCase()}
Model: ${model}
Workspace Path: ${workspacePath || 'Standalone'}
User Task:
"""
${userTask}
"""`
    this.writeEntry(`[AGENT SESSION START] Session: ${sessionId}`, content)
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
