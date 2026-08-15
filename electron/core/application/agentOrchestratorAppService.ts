import { BrowserWindow } from 'electron'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { logger } from '../../diagnostics'
import type { AgentTaskPayload, AgentTaskResult } from '../domain/agent/agentTypes'
import { evaluateTaskComplexity } from '../domain/agent/complexityEvaluator'
import { parseAgentToolCall } from '../domain/agent/toolParser'
import { isIgnoredPath } from '../domain/agent/contextFilter'
import { HardwareProfileResolver } from '../domain/agent/hardwareProfileResolver'
import { AgentPromptAssembler } from '../domain/agent/agentPromptAssembler'
import { calculateDynamicContextWindow } from '../domain/agent/contextWindowCalculator'
import { AgentStreamTransport } from '../infrastructure/http/agentStreamTransport'
import { agentToolExecutorService } from './agentToolExecutorService'
import { skillAppService } from './skillAppService'
import { ollamaAppService } from './ollamaAppService'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import type { AppSettings } from '../../../src/types'

interface AgentSession {
  id: string
  isCancelled: boolean
  targetWindow: BrowserWindow | null
  activeHttpRequest?: http.ClientRequest | null
  activeChildProcess?: any | null
}

const activeAgentSessions = new Map<string, AgentSession>()

function cleanupSession(session: AgentSession) {
  session.isCancelled = true
  if (session.activeHttpRequest) {
    try {
      session.activeHttpRequest.destroy()
    } catch (err: any) {
      logger.log('WARN', 'AgentOrchestrator', `Failed destroying active HTTP request during cleanup: ${err?.message}`)
    }
    session.activeHttpRequest = null
  }
  if (session.activeChildProcess) {
    try {
      if (process.platform === 'win32' && session.activeChildProcess.pid) {
        spawn('taskkill', ['/pid', session.activeChildProcess.pid.toString(), '/f', '/t'])
      } else {
        session.activeChildProcess.kill('SIGKILL')
      }
    } catch (err: any) {
      logger.log('WARN', 'AgentOrchestrator', `Failed terminating child process during cleanup: ${err?.message}`)
    }
    session.activeChildProcess = null
  }
  if (session.targetWindow && !session.targetWindow.isDestroyed()) {
    session.targetWindow.webContents.send('agent:log', {
      id: `${Date.now()}-cancelled`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      type: 'info',
      message: "Task interrotto dall'utente.",
    })
    session.targetWindow.webContents.send('agent:done', { success: false, summary: "Task interrotto dall'utente." })
  }
}

export function cancelActiveAgentTask(targetSessionId?: string) {
  if (targetSessionId) {
    const session = activeAgentSessions.get(targetSessionId)
    if (session) {
      cleanupSession(session)
      activeAgentSessions.delete(targetSessionId)
      logger.log('INFO', 'AgentOrchestratorApp', `Agent session ${targetSessionId} cancelled by user.`)
    }
  } else {
    for (const [id, session] of activeAgentSessions.entries()) {
      cleanupSession(session)
      activeAgentSessions.delete(id)
    }
    logger.log('INFO', 'AgentOrchestratorApp', `All active agent sessions cancelled by user.`)
  }
}

function pushToolOutputHistory(historyArr: string[], output: string, maxItems = 8, maxCharPerOutput = 4000) {
  const truncated = output.length > maxCharPerOutput ? `${output.slice(0, maxCharPerOutput)}\n... [Output truncated for context limit]` : output
  historyArr.push(truncated)
  while (historyArr.length > maxItems) {
    historyArr.shift()
  }
}

async function scanProjectMap(workspacePath: string): Promise<string> {
  try {
    const relativeList: string[] = []
    const scan = async (curDir: string, depth: number) => {
      if (depth > 8 || relativeList.length >= 2000) return
      try {
        const entries = await fs.promises.readdir(curDir, { withFileTypes: true })
        for (const entry of entries) {
          if (isIgnoredPath(entry.name, entry.isDirectory())) continue
          const fullPath = path.join(curDir, entry.name)
          const relPath = path.relative(workspacePath, fullPath).replace(/\\/g, '/')
          if (entry.isDirectory()) {
            relativeList.push(`[DIR] ${relPath}/`)
            await scan(fullPath, depth + 1)
          } else {
            relativeList.push(`[FILE] ${relPath}`)
          }
        }
      } catch (err: any) {
        logger.log('WARN', 'AgentOrchestratorApp', `Scan error in ${curDir}: ${err.message}`)
      }
    }
    await scan(workspacePath, 0)
    return relativeList.join('\n')
  } catch (err: any) {
    logger.log('WARN', 'AgentOrchestratorApp', `Project map scan failed: ${err.message}`)
    return ''
  }
}

export async function runAgentOrchestratorLoop(
  payload: AgentTaskPayload,
  win: BrowserWindow | null,
  customSessionId?: string
): Promise<AgentTaskResult> {
  if (!payload.userTask || !payload.userTask.trim()) {
    return { success: false, summary: 'Task prompt empty', error: 'Task prompt is required' }
  }

  const sessionId = customSessionId || `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
  const session: AgentSession = {
    id: sessionId,
    isCancelled: false,
    targetWindow: win,
    activeHttpRequest: null,
    activeChildProcess: null,
  }
  activeAgentSessions.set(sessionId, session)

  const isSessionActive = () => activeAgentSessions.has(sessionId) && !session.isCancelled

  const emitLog = (type: 'info' | 'tool_call' | 'terminal' | 'approval_request', message: string, detail?: string) => {
    if (isSessionActive() && session.targetWindow && !session.targetWindow.isDestroyed()) {
      session.targetWindow.webContents.send('agent:log', {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        type,
        message,
        detail,
      })
    }
  }

  const emitDone = (success: boolean, summary: string) => {
    if (isSessionActive() && session.targetWindow && !session.targetWindow.isDestroyed()) {
      session.targetWindow.webContents.send('agent:done', { success, summary })
    }
  }

  const userTask = payload.userTask.trim()
  const agentMode = payload.agentMode || 'plan'
  const workspacePath = payload.workspacePath || null
  const isStandaloneMode = Boolean(payload.isStandaloneMode)
  const settings: AppSettings = payload.settings || {
    defaultModel: 'llama3.2',
    hardwareProfile: 'Auto',
    ocrEngine: 'native_cuda',
    ollamaHost: '',
    codingModel: 'llama3.2',
    translationModel: 'llama3.2',
    visionModel: 'llama3.2-vision',
    embeddingModel: 'nomic-embed-text',
    complexityFastModel: 'llama3.2:3b',
    complexityStandardModel: 'qwen2.5-coder:7b',
    complexityDeepModel: 'deepseek-r1:8b',
    useComplexityRouting: true,
    allowTerminalExecution: true,
    allowFileModifications: true,
    customPromptOverrides: {},
  }

  const attachedContext = (payload.attachedDocs || [])
    .map((d) => `[ATTACHED DOCUMENT: ${d.filename}]\n${(d.extractedMarkdown || '').slice(0, 3000)}`)
    .join('\n\n')

  const pinnedFilesContextStr = (payload.pinnedFiles || [])
    .map((f) => {
      let content = f.content || ''
      if (!content && f.path && fs.existsSync(f.path)) {
        try {
          content = fs.readFileSync(f.path, 'utf-8')
        } catch (err: any) {
          logger.log('WARN', 'AgentOrchestratorApp', `Could not read pinned file ${f.path}: ${err.message}`)
        }
      }
      return `[EXPLICIT REFERENCED FILE: ${f.name} (${f.path})]\n\`\`\`\n${(content || '').slice(0, 12000)}\n\`\`\``
    })
    .join('\n\n')

  const projectContextMapStr = workspacePath && !isStandaloneMode && fs.existsSync(workspacePath)
    ? await scanProjectMap(workspacePath)
    : ''

  emitLog(
    'info',
    `Task received: "${userTask}"`,
    `Mode: ${agentMode.toUpperCase()} | Engine: Clean Layered Architecture | Workspace: ${workspacePath || 'Standalone'}`
  )

  if (settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logSessionStart(sessionId, userTask, agentMode, settings.codingModel || settings.defaultModel || 'llama3.2', workspacePath)
  }

  const availableModels = await ollamaAppService.getInstalledModels(settings.ollamaHost)

  const skillMatchContext = {
    userTask,
    activeFilePath: payload.activeFile?.path,
    activeFileContent: payload.activeFile?.content,
    pinnedFiles: payload.pinnedFiles?.map((f) => ({ path: f.path, name: f.name })),
    workspacePath: workspacePath || undefined,
  }

  const matchedSkills = await skillAppService.getMatchedSkills(skillMatchContext, workspacePath)
  if (matchedSkills.length > 0) {
    const skillNames = matchedSkills.map((s) => s.name)
    if (session.targetWindow && !session.targetWindow.isDestroyed()) {
      session.targetWindow.webContents.send('agent:skills-matched', { skills: skillNames })
    }
    emitLog('info', `✨ Skill Router: Attivate ${matchedSkills.length} skill [${skillNames.join(', ')}]`)
    if (settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logSkillsMatched(sessionId, skillNames)
    }
  }

  const toolOutputHistory: string[] = []
  const MAX_STEPS = Math.max(10, Math.min(250, settings.maxToolCallSteps || 50))
  let stepCount = 0
  let noToolStreak = 0

  while (stepCount < MAX_STEPS && isSessionActive()) {
    stepCount++

    const lastToolLog = toolOutputHistory.length > 0 ? toolOutputHistory[toolOutputHistory.length - 1] : ''
    const hasRecentToolFailure = Boolean(lastToolLog && (
      lastToolLog.includes('[TERMINAL AUTO-HEALING DIAGNOSTICS LOG]') ||
      lastToolLog.includes('[REPLACE FILE ERROR') ||
      lastToolLog.toLowerCase().includes('failed') ||
      lastToolLog.toLowerCase().includes('error:')
    ))

    const errorCountInHistory = toolOutputHistory.filter((h) =>
      h.includes('[TERMINAL AUTO-HEALING DIAGNOSTICS LOG]') ||
      h.includes('[REPLACE FILE ERROR') ||
      h.toLowerCase().includes('failed') ||
      h.toLowerCase().includes('error:')
    ).length

    const routedComplexity = evaluateTaskComplexity(userTask, {
      attachedFilesCount: payload.pinnedFiles?.length || 0,
      contextSizeChars: payload.activeFile?.content?.length || 0,
      settings,
      availableModels,
      hasRecentToolFailure,
      errorCountInHistory,
    })

    if (routedComplexity.isEscalated && stepCount > 1) {
      emitLog('info', `⚡ Complexity Escalated: ${routedComplexity.modelName}`, routedComplexity.reasoning)
    }

    const targetModel = settings.useComplexityRouting
      ? routedComplexity.modelName
      : (settings.codingModel || settings.defaultModel || 'llama3.2')

    const runtimeOpts = HardwareProfileResolver.resolveOllamaOptions(
      settings.hardwareProfile,
      undefined,
      routedComplexity.tier
    )
    const skillsBlock = await skillAppService.getContextSkillsBlock(skillMatchContext, workspacePath)

    const turnPrompt = AgentPromptAssembler.assembleTurnPrompt({
      userTask,
      agentMode,
      stepCount,
      maxSteps: MAX_STEPS,
      targetModel,
      workspacePath,
      isStandaloneMode,
      activeFile: payload.activeFile,
      pinnedFilesContextStr,
      skillsBlock,
      toolOutputHistory,
      attachedContext,
      projectContextMapStr,
      settings,
      runtimeOpts,
    })

    const dynamicNumCtx = calculateDynamicContextWindow(turnPrompt.length, runtimeOpts.num_ctx)
    runtimeOpts.num_ctx = dynamicNumCtx

    emitLog('tool_call', `[Step ${stepCount}/${MAX_STEPS}] Consulting LLM (${targetModel}) [ctx:${runtimeOpts.num_ctx}]...`)
    if (settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logTurnPrompt(sessionId, stepCount, targetModel, runtimeOpts.num_ctx, turnPrompt)
    }

    let streamedOutput = ''
    try {
      streamedOutput = await AgentStreamTransport.streamCompletion({
        targetModel,
        prompt: turnPrompt,
        runtimeOpts,
        keepAlive: '30m',
        ollamaEndpoint: settings.ollamaHost,
        onTokenChunk: (chunk) => {
          if (session.targetWindow && !session.targetWindow.isDestroyed()) {
            session.targetWindow.webContents.send('agent:stream-token', { step: stepCount, chunk })
          }
        },
        isCancelled: () => !isSessionActive(),
        onHttpRequestCreated: (req) => {
          session.activeHttpRequest = req
        },
      })
      session.activeHttpRequest = null
    } catch (err: any) {
      emitLog('info', `LLM Stream error on step ${stepCount}: ${err.message}`)
      emitDone(false, `LLM Stream Error: ${err.message}`)
      if (settings.enableCodingAgentDebugLog) {
        codingAgentLogger.logSessionEnd(sessionId, stepCount, false, `LLM Error: ${err.message}`)
      }
      activeAgentSessions.delete(sessionId)
      return { success: false, summary: `LLM Error: ${err.message}` }
    }

    if (!isSessionActive()) {
      emitLog('info', 'Agent execution cancelled by user.')
      emitDone(false, 'Task cancelled by user.')
      if (settings.enableCodingAgentDebugLog) {
        codingAgentLogger.logSessionEnd(sessionId, stepCount, false, 'Task cancelled by user.')
      }
      activeAgentSessions.delete(sessionId)
      return { success: false, summary: 'Task cancelled' }
    }

    emitLog('info', `AI Agent (${agentMode.toUpperCase()} Step ${stepCount}):`, streamedOutput)
    if (settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logLlmResponse(sessionId, stepCount, streamedOutput)
    }

    const parsedTool = parseAgentToolCall(streamedOutput)

    if (!parsedTool) {
      const hasToolCallAttempt =
        streamedOutput.includes('<tool_call>') ||
        streamedOutput.includes('```json') ||
        streamedOutput.toLowerCase().includes('"tool"')

      if (hasToolCallAttempt) {
        const feedback = `[TOOL PARSER REJECTION DIAGNOSTIC]\nYour tool call could not be executed because mandatory input parameters were missing or malformed.\nPlease ensure you provide valid JSON with all required parameters.`
        pushToolOutputHistory(toolOutputHistory, feedback)
        emitLog('info', `Step ${stepCount} Tool Call Rejected: Missing required parameters in JSON payload.`)
        if (settings.enableCodingAgentDebugLog) {
          codingAgentLogger.logToolResult(sessionId, stepCount, 'unparsed_tool', feedback)
        }
        continue
      }

      // In AGENT mode, if the model gave conversational text without invoking any tool,
      // prompt it up to 2 times to execute a tool (e.g. write_file, read_file, list_dir, run_command) instead of exiting prematurely.
      if (agentMode === 'agent' && stepCount < MAX_STEPS && noToolStreak < 2) {
        noToolStreak++
        const feedback = `[ACTION REQUIRED: NO TOOL INVOCATION DETECTED]\nYour previous response was purely descriptive and did not invoke any tools. In AGENT mode, to create or edit files in the workspace, you MUST output a tool call formatted as:\n\`\`\`json\n{\n  "tool": "write_file",\n  "parameters": {\n    "filePath": "index.html",\n    "content": "..."\n  },\n  "explanation": "Creating initial project file"\n}\n\`\`\`\nIf all work is finished, invoke the "finish" tool. Please invoke the required tool now.`
        pushToolOutputHistory(toolOutputHistory, feedback)
        emitLog('info', `Step ${stepCount}: No tool call found in LLM response. Requesting tool invocation...`)
        if (settings.enableCodingAgentDebugLog) {
          codingAgentLogger.logToolResult(sessionId, stepCount, 'no_tool_detected', feedback)
        }
        continue
      }

      const summary = streamedOutput.trim() || 'Task completed successfully.'
      emitLog('info', `Task Finished: ${summary.slice(0, 300)}`)
      emitDone(true, summary)
      if (settings.enableCodingAgentDebugLog) {
        codingAgentLogger.logSessionEnd(sessionId, stepCount, true, summary)
      }
      activeAgentSessions.delete(sessionId)
      return { success: true, summary }
    }

    noToolStreak = 0

    if (parsedTool.tool === 'finish') {
      const summary = parsedTool.explanation || parsedTool.parameters?.summary || 'Task completed successfully.'
      emitLog('info', `Task Finished: ${summary}`)
      emitDone(true, summary)
      if (settings.enableCodingAgentDebugLog) {
        codingAgentLogger.logToolCall(sessionId, stepCount, 'finish', parsedTool.parameters, parsedTool.explanation)
        codingAgentLogger.logSessionEnd(sessionId, stepCount, true, summary)
      }
      activeAgentSessions.delete(sessionId)
      return { success: true, summary }
    }

    if (parsedTool.tool === 'ask') {
      const question = parsedTool.parameters?.question || parsedTool.parameters?.query || parsedTool.explanation || 'Clarification requested from user.'
      emitLog('info', `❓ AI Agent Question: ${question}`)
      emitDone(true, question)
      if (settings.enableCodingAgentDebugLog) {
        codingAgentLogger.logToolCall(sessionId, stepCount, 'ask', parsedTool.parameters, parsedTool.explanation)
        codingAgentLogger.logSessionEnd(sessionId, stepCount, true, question)
      }
      activeAgentSessions.delete(sessionId)
      return { success: true, summary: question }
    }

    emitLog('tool_call', `Step ${stepCount} Tool Call [${parsedTool.tool}]:`, JSON.stringify(parsedTool.parameters, null, 2))
    if (settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logToolCall(sessionId, stepCount, parsedTool.tool, parsedTool.parameters, parsedTool.explanation)
    }

    if (agentMode === 'plan') {
      emitLog('info', `Plan Mode Proposed Tool (${parsedTool.tool}):`, JSON.stringify(parsedTool.parameters, null, 2))
      emitDone(true, `Plan Mode completed step proposal for ${parsedTool.tool}`)
      if (settings.enableCodingAgentDebugLog) {
        codingAgentLogger.logSessionEnd(sessionId, stepCount, true, `Proposed tool call: ${parsedTool.tool}`)
      }
      activeAgentSessions.delete(sessionId)
      return { success: true, summary: `Proposed tool call: ${parsedTool.tool}` }
    }

    if (agentMode === 'ask') {
      const isMutatingTool = ['run_command', 'write_file', 'replace_file_content', 'multi_replace_file_content', 'delete_file', 'download_file'].includes(parsedTool.tool)
      if (isMutatingTool) {
        if (session.targetWindow && !session.targetWindow.isDestroyed()) {
          session.targetWindow.webContents.send('agent:approval-request', {
            type: parsedTool.tool === 'run_command'
              ? 'terminal_cmd'
              : parsedTool.tool === 'download_file'
              ? 'download_file'
              : parsedTool.tool === 'delete_file'
              ? 'delete_file'
              : parsedTool.tool === 'multi_replace_file_content'
              ? 'multi_replace'
              : parsedTool.tool === 'replace_file_content'
              ? 'replace_chunk'
              : 'write_file',
            target: parsedTool.parameters.filePath || parsedTool.parameters.command || parsedTool.parameters.url || 'Target Action',
            contentOrCmd: parsedTool.parameters.command || parsedTool.parameters.url || parsedTool.parameters.targetContent || parsedTool.parameters.content || '',
            replacement: parsedTool.parameters.replacementContent,
            replacements: parsedTool.parameters.replacements,
            parameters: parsedTool.parameters,
          })
        }
        emitDone(true, `Awaiting user approval for ${parsedTool.tool}`)
        if (settings.enableCodingAgentDebugLog) {
          codingAgentLogger.logSessionEnd(sessionId, stepCount, true, `Awaiting approval for ${parsedTool.tool}`)
        }
        activeAgentSessions.delete(sessionId)
        return { success: true, summary: `Awaiting approval for ${parsedTool.tool}` }
      }
    }

    // Execute tool through tool executor service
    const toolRes = await agentToolExecutorService.executeTool(
      parsedTool,
      workspacePath,
      settings,
      (terminalChunk) => emitLog('terminal', terminalChunk),
      (childProc) => {
        session.activeChildProcess = childProc
      }
    )
    session.activeChildProcess = null

    pushToolOutputHistory(toolOutputHistory, toolRes.outputForHistory)
    if (toolRes.isTerminal) {
      emitLog('terminal', toolRes.logMessage, toolRes.logDetail)
    } else {
      emitLog('info', toolRes.logMessage, toolRes.logDetail)
    }

    if (settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logToolResult(sessionId, stepCount, parsedTool.tool, toolRes.outputForHistory, toolRes.isTerminal, toolRes.logDetail)
    }
  }

  const endSummary = `Completed ${stepCount} agent steps.`
  emitDone(true, endSummary)
  if (settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logSessionEnd(sessionId, stepCount, true, endSummary)
  }
  activeAgentSessions.delete(sessionId)
  return { success: true, summary: endSummary }
}
