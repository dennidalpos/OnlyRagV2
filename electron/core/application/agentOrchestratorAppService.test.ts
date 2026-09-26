import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import type { RendererEventSink } from '../domain/ports/rendererEventSink'
import {
  runAgentOrchestratorLoop as runOrchestratorLoop,
  cancelActiveAgentTask,
  requestActiveAgentContextCompaction,
  respondToApproval,
} from './agentOrchestratorAppService'
import { AgentStreamTransport } from '../infrastructure/http/agentStreamTransport'
import type { AgentChatTurn } from '../infrastructure/http/agentStreamTransport'
import { runProjectVerification } from './agentOrchestratorVerificationRunner'
import { MAX_VERIFICATION_FIX_CYCLES } from '../domain/agent/verificationGatePolicy'
import { buildDefaultAgentSettings } from './agentOrchestratorSessionSetup'
import { agentToolExecutorService } from './agentToolExecutorService'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import type { AppSettings } from '../../../shared/types'

// The production fallback is fail-closed; these loop tests exercise tool execution, so they opt in.
const TOOL_ENABLED_SETTINGS: AppSettings = {
  ...buildDefaultAgentSettings(),
  // The fallback settings configure no model; these tests run on an installed one.
  defaultModel: 'llama3.2',
  codingModel: 'llama3.2',
  allowTerminalExecution: true,
  allowFileModifications: true,
  capabilityPolicyMode: 'network-approved',
}
const runAgentOrchestratorLoop: typeof runOrchestratorLoop = (payload, win) =>
  runOrchestratorLoop({ ...payload, settings: { ...TOOL_ENABLED_SETTINGS, ...payload.settings } }, win)

/** One scripted native model turn: a single call of `tool` with `parameters`. */
const toolTurn = (tool: string, parameters: Record<string, unknown>): AgentChatTurn => ({
  content: '',
  thinking: '',
  toolCalls: [{ type: 'function', function: { index: 0, name: tool, arguments: parameters } }],
})

const commandTurn = (command: string) => toolTurn('run_command', { command })

function createMockWindow(): { window: RendererEventSink; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn()
  return {
    window: { isAvailable: vi.fn(() => true), send },
    send,
  }
}

vi.mock('../infrastructure/http/agentStreamTransport', () => ({
  AgentStreamTransport: {
    streamCompletion: vi.fn(),
  },
}))

vi.mock('./ollamaAppService', () => ({
  ollamaAppService: {
    getInstalledModels: vi.fn().mockResolvedValue(['llama3.2:3b', 'qwen2.5-coder:7b', 'deepseek-r1:8b']),
    // Session setup reads capabilities and the trained context_length from the same /api/tags
    // record; an empty map means "Ollama told us nothing", which is the default here.
    getModelMetrics: vi.fn().mockResolvedValue({
      'llama3.2:3b': { capabilities: ['completion', 'tools'], contextLength: 8192 },
      'qwen2.5-coder:7b': { capabilities: ['completion', 'tools'], contextLength: 32768 },
      'deepseek-r1:8b': { capabilities: ['completion', 'tools'], contextLength: 32768 },
    }),
    testConnection: vi.fn().mockResolvedValue({ success: true, modelsCount: 3 }),
  },
}))

vi.mock('./workspaceAppService', () => ({
  workspaceAppService: {
    inspectGuestOsEnvironment: vi.fn().mockResolvedValue({
      tools: { git: true, node: true, npm: true, python: true, ollama: true },
    }),
  },
}))

// The real runner shells out to `npm run build`; what is under test here is the gate's wiring.
vi.mock('./agentOrchestratorVerificationRunner', () => ({
  runProjectVerification: vi.fn().mockResolvedValue({ hasVerificationCommand: false, status: 'unverifiable' }),
}))

vi.mock('./skillAppService', () => ({
  skillAppService: {
    getMatchedSkills: vi.fn().mockResolvedValue([]),
    getContextSkillsBlock: vi.fn().mockResolvedValue(''),
    skillsBlockForWorkspace: vi.fn().mockReturnValue(''),
  },
}))

/** Cases that spawn a real powershell.exe: it exists only on Windows, so other hosts report them as skipped. */
const itWithPowerShell = it.skipIf(process.platform !== 'win32')

describe('AgentOrchestratorAppService Resilience & Loop Integration Tests', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-orchestrator-test-'))
    vi.clearAllMocks()
    // clearAllMocks resets call history but NOT the mockResolvedValueOnce queue, and every test here scripts a turn-by-turn sequence of LLM replies.
    vi.mocked(AgentStreamTransport.streamCompletion).mockReset()
    vi.mocked(runProjectVerification).mockReset()
    vi.mocked(runProjectVerification).mockResolvedValue({ hasVerificationCommand: false, status: 'unverifiable' })
  })

  afterEach(() => {
    cancelActiveAgentTask()
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('should return error immediately if task prompt is empty', async () => {
    const res = await runAgentOrchestratorLoop(
      {
        userTask: '   ',
        agentMode: 'auto',
        workspacePath: tempDir,
      },
      null,
    )

    expect(res.success).toBe(false)
    expect(res.error).toBe('Task prompt is required')
    expect(res.completionStatus).toBe('blocked')
  })

  it('should route finish through the application evidence gate and persist the model report', async () => {
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(toolTurn('finish', { summary: 'All tasks done perfectly.' }))

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Create test project',
        agentMode: 'auto',
        workspacePath: tempDir,
      },
      null,
    )

    expect(res.success).toBe(false)
    expect(res.completionStatus).toBe('unverifiable')
    expect(res.summary).toContain('All tasks done perfectly.')
    const tracker = fs.readFileSync(path.join(tempDir, '.onlyrag', 'assistant', 'SESSION_TRACKER.md'), 'utf-8')
    expect(tracker).toContain('## 5. Raw Agent Summary')
    expect(tracker).toContain('All tasks done perfectly.')
  })

  it('executes every native tool call before asking the model again and returns both results in chat history', async () => {
    fs.writeFileSync(path.join(tempDir, 'a.txt'), 'first file\n')
    fs.writeFileSync(path.join(tempDir, 'b.txt'), 'second file\n')
    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce({
        content: '',
        thinking: 'Read both files',
        toolCalls: [
          { type: 'function', function: { index: 0, name: 'read_file', arguments: { filePath: 'a.txt' } } },
          { type: 'function', function: { index: 1, name: 'read_file', arguments: { filePath: 'b.txt' } } },
        ],
      } as never)
      .mockResolvedValueOnce({ content: 'Both files were inspected.', thinking: '', toolCalls: [] } as never)

    const result = await runAgentOrchestratorLoop({ userTask: 'Explain a.txt and b.txt', agentMode: 'ask', workspacePath: tempDir }, null)

    expect(result.success).toBe(true)
    expect(AgentStreamTransport.streamCompletion).toHaveBeenCalledTimes(2)
    const secondMessages =
      (vi.mocked(AgentStreamTransport.streamCompletion).mock.calls[1][0] as { messages?: Array<{ role: string; content: string }> }).messages || []
    expect(secondMessages.filter((message) => message.role === 'tool')).toEqual([
      expect.objectContaining({ tool_name: 'read_file', content: expect.stringContaining('first file') }),
      expect.objectContaining({ tool_name: 'read_file', content: expect.stringContaining('second file') }),
    ])
  })

  it('continues the conversation on a follow-up run, with the current model instead of the pinned one', async () => {
    const sessionId = 'follow-up-conversation'
    const identity = (runId: string) => ({ runId, conversationId: sessionId, planRevisionId: `${runId}:v1`, workspaceId: `workspace:${tempDir}` })
    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce({ content: 'The workspace is empty.', thinking: '', toolCalls: [] })
      .mockResolvedValueOnce({ content: 'Still empty.', thinking: '', toolCalls: [] })

    await runAgentOrchestratorLoop(
      { identity: identity('run-1'), sessionId, userTask: 'Describe the workspace', agentMode: 'ask', workspacePath: tempDir },
      null,
    )
    await runAgentOrchestratorLoop(
      {
        identity: identity('run-2'),
        sessionId,
        userTask: 'Anything new?',
        initialUserTask: 'Describe the workspace',
        agentMode: 'ask',
        workspacePath: tempDir,
        settings: { ...TOOL_ENABLED_SETTINGS, codingModel: 'qwen2.5-coder:7b' },
      },
      null,
    )

    const [first, second] = vi.mocked(AgentStreamTransport.streamCompletion).mock.calls.map(([request]) => request)
    expect(first.targetModel).toBe('llama3.2:3b')
    // A follow-up is a new run: the model and context window pinned by run 1 no longer apply.
    expect(second.targetModel).toBe('qwen2.5-coder:7b')
    const contents = second.messages.map((message) => `${message.role}:${message.content}`)
    expect(contents[1]).toBe('user:Describe the workspace')
    const previousAnswer = contents.indexOf('assistant:The workspace is empty.')
    const followUp = contents.indexOf('user:Anything new?')
    expect(previousAnswer).toBeGreaterThan(1)
    expect(followUp).toBeGreaterThan(previousAnswer)
  })

  it('runs a shell read as read_file even when the phase exposes only run_command', async () => {
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'shell-read-marker\n')
    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce(toolTurn('run_command', { command: 'cat notes.txt' }))
      .mockResolvedValueOnce(toolTurn('finish', { summary: 'Done' }))

    await runAgentOrchestratorLoop(
      {
        sessionId: 'shell-read-as-read-file',
        userTask: 'Create src/app.ts and run the build',
        agentMode: 'auto',
        workspacePath: tempDir,
        settings: { ...TOOL_ENABLED_SETTINGS, verifyBeforeFinish: false },
      },
      null,
    )

    // Gpt-oss:20b full task run of 2026-09-24: the gate turned `cat` into read_file and the
    // executor then refused read_file as outside the phase, three times in seven steps.
    const secondTurn = JSON.stringify(vi.mocked(AgentStreamTransport.streamCompletion).mock.calls[1][0])
    expect(secondTurn).toContain('shell-read-marker')
    expect(secondTurn).not.toContain('TURN TOOL POLICY DENIED')
  })

  it('runs and persists the explicit application phase sequence', async () => {
    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce(toolTurn('write_file', { filePath: 'phase.ts', content: 'export const phase = true' }))
      .mockResolvedValueOnce(toolTurn('finish', { summary: 'Done' }))
    const mockWin = createMockWindow()
    const sessionId = 'explicit-phase-sequence'

    await runAgentOrchestratorLoop(
      {
        sessionId,
        userTask: 'Create phase.ts',
        agentMode: 'auto',
        workspacePath: tempDir,
        settings: { ...TOOL_ENABLED_SETTINGS, verifyBeforeFinish: false },
      },
      mockWin.window,
    )

    const firstCatalog = vi.mocked(AgentStreamTransport.streamCompletion).mock.calls[0][0].toolCatalog || []
    expect(vi.mocked(AgentStreamTransport.streamCompletion).mock.calls[0][0].keepAlive).toBe('30m')
    expect(firstCatalog.map((entry) => entry.function.name)).toEqual(expect.arrayContaining(['write_file']))
    expect(firstCatalog.map((entry) => entry.function.name)).toEqual(expect.arrayContaining(['read_file', 'run_command']))

    const calls = mockWin.send.mock.calls as Array<[string, { statusText?: string }]>
    const statuses = calls.filter(([channel]) => channel === 'agent:step-update').map(([, data]) => data.statusText)
    expect(statuses).toEqual(expect.arrayContaining(['Raccolta contesto', 'Proposta corrente', 'Applicazione', 'Verifica', 'Esito']))
    const saved = JSON.parse(fs.readFileSync(path.join(tempDir, '.onlyrag', 'sessions', `.agent_state_${sessionId}.json`), 'utf-8'))
    expect(saved.executionPhase).toBe('outcome')
  })

  it('scopes every emitted Agent Coding event to one immutable run identity', async () => {
    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce(toolTurn('write_file', { filePath: 'identity.ts', content: 'export const identity = true' }))
      .mockResolvedValueOnce(toolTurn('finish', { summary: 'Done' }))
    const mockWin = createMockWindow()
    const identity = {
      runId: 'run-identity-1',
      conversationId: 'conversation-identity-1',
      planRevisionId: 'plan-identity:v3',
      workspaceId: 'workspace:identity-test',
    }

    await runAgentOrchestratorLoop(
      {
        identity,
        sessionId: identity.conversationId,
        userTask: 'Create identity.ts',
        agentMode: 'auto',
        workspacePath: tempDir,
        settings: { ...TOOL_ENABLED_SETTINGS, verifyBeforeFinish: false },
      },
      mockWin.window,
    )

    const agentEvents = mockWin.send.mock.calls.filter(([channel]) => String(channel).startsWith('agent:')).map(([, payload]) => payload)
    expect(agentEvents.length).toBeGreaterThan(0)
    expect(
      agentEvents.every(
        (payload) =>
          payload.runId === identity.runId &&
          payload.conversationId === identity.conversationId &&
          payload.planRevisionId === identity.planRevisionId &&
          payload.workspaceId === identity.workspaceId,
      ),
    ).toBe(true)
    expect(mockWin.send).toHaveBeenCalledWith(
      'workspace:file-version',
      expect.objectContaining({
        ...identity,
        filePath: path.join(tempDir, 'identity.ts'),
        deleted: false,
      }),
    )
  })

  itWithPowerShell('stops once six execution failures follow each other', async () => {
    const stream = vi.mocked(AgentStreamTransport.streamCompletion)
    for (let attempt = 1; attempt <= 6; attempt++) stream.mockResolvedValueOnce(commandTurn(`pytest failing_test_${attempt}.py`))

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Debug test failures',
        agentMode: 'auto',
        workspacePath: tempDir,
      },
      null,
    )

    expect(res.success).toBe(false)
    expect(res.completionStatus).toBe('blocked')
    expect(res.summary).toContain('execution recovery stopped after 6/6 failures')
    expect(AgentStreamTransport.streamCompletion).toHaveBeenCalledTimes(6)
  })

  itWithPowerShell('refuses an unchanged rerun of a failed command instead of spending the execution budget on it', async () => {
    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce(commandTurn('pytest failing_test.py'))
      .mockResolvedValueOnce(commandTurn('pytest failing_test.py'))

    const res = await runAgentOrchestratorLoop({ userTask: 'Debug test failures', agentMode: 'auto', workspacePath: tempDir }, null)

    // The run goes on past the refused rerun instead of closing on the second call.
    expect(res.summary).not.toContain('execution recovery stopped')
    expect(vi.mocked(AgentStreamTransport.streamCompletion).mock.calls.length).toBeGreaterThan(2)
  })

  itWithPowerShell('does not reach a later ask after the execution recovery budget is exhausted', async () => {
    const askTurn = toolTurn('ask', { question: 'What should we do next?' })

    const stream = vi.mocked(AgentStreamTransport.streamCompletion)
    for (let attempt = 1; attempt <= 6; attempt++) stream.mockResolvedValueOnce(commandTurn(`pytest still_failing_${attempt}.py`))
    stream.mockResolvedValueOnce(askTurn)

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Debug test failures',
        agentMode: 'auto',
        workspacePath: tempDir,
      },
      null,
    )
    expect(res.success).toBe(false)
    expect(res.summary).not.toContain('What should we do next?')
    expect(AgentStreamTransport.streamCompletion).toHaveBeenCalledTimes(6)
  })

  it('persists application closure when ask recovery is exhausted', async () => {
    const sessionId = 'ask-recovery-terminal-closure'
    const askTurn = (attempt: number) => toolTurn('ask', { question: `What should we do next? Attempt ${attempt}` })
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(askTurn(1)).mockResolvedValueOnce(askTurn(2)).mockResolvedValueOnce(askTurn(3))
    await agentSessionStateRepository.seedPlanMilestones(sessionId, tempDir, [{ id: 'm-ask', title: 'Fix app.ts', status: 'pending' }], 'Fix app.ts')

    const res = await runAgentOrchestratorLoop({ userTask: 'Fix app.ts', agentMode: 'auto', workspacePath: tempDir, sessionId }, null)
    const saved = JSON.parse(fs.readFileSync(path.join(tempDir, '.onlyrag', 'sessions', `.agent_state_${sessionId}.json`), 'utf-8'))

    expect(AgentStreamTransport.streamCompletion).toHaveBeenCalledTimes(3)
    expect(res.completionStatus).toBe('blocked')
    expect(saved).toMatchObject({
      status: 'FAILED',
      terminationReason: 'circuit_breaker',
      completionStatus: 'blocked',
      executionPhase: 'outcome',
    })
  })

  itWithPowerShell('should trip stagnation circuit breaker when repeated failures occur on complex tasks', async () => {
    const failingCommandTurn = (n: number) => toolTurn('run_command', { command: `pytest failing_test_${n}.py` })
    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce(failingCommandTurn(1))
      .mockResolvedValueOnce(failingCommandTurn(2))
      .mockResolvedValueOnce(failingCommandTurn(3))
      .mockResolvedValueOnce(failingCommandTurn(4))
      .mockResolvedValueOnce(failingCommandTurn(5))
      .mockResolvedValueOnce(failingCommandTurn(6))
      .mockResolvedValueOnce(failingCommandTurn(7))

    const settings: AppSettings = {
      defaultModel: 'llama3.2',
      ocrEngine: 'native_cuda',
      capabilityPolicyMode: 'network-approved',
      ollamaHost: '',
      codingModel: 'qwen2.5-coder:7b',
      translationModel: 'llama3.2',
      visionModel: 'llama3.2-vision',
      embeddingModel: 'nomic-embed-text',
      allowTerminalExecution: true,
      allowFileModifications: true,
      customPromptOverrides: {},
      maxToolCallSteps: 0,
    }

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Fix the failing test suite',
        agentMode: 'auto',
        workspacePath: tempDir,
        settings,
      },
      null,
    )

    expect(AgentStreamTransport.streamCompletion).toHaveBeenCalledTimes(6)
    expect(res.success).toBe(false)
    expect(res.completionStatus).toBe('blocked')
  })

  it('reports a command with an uncertain effect to the model instead of ending the run', async () => {
    const execute = vi.spyOn(agentToolExecutorService, 'executeTool').mockResolvedValueOnce({
      outcome: 'failure',
      outputForHistory: '[TERMINAL AUTO-HEALING DIAGNOSTICS LOG]\n[UNCERTAIN EFFECT - DO NOT RETRY]',
      logMessage: 'Command timed out',
      isTerminal: true,
      effectOutcome: 'uncertain',
    })
    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce(toolTurn('run_command', { command: 'pytest failing_test.py' }))
      .mockResolvedValueOnce(toolTurn('finish', { summary: 'should not run' }))

    try {
      const res = await runAgentOrchestratorLoop(
        {
          userTask: 'Debug test failures',
          agentMode: 'auto',
          workspacePath: tempDir,
        },
        null,
      )

      expect(res.summary).not.toContain('Effetto incerto')
      expect(execute).toHaveBeenCalledOnce()
      expect(vi.mocked(AgentStreamTransport.streamCompletion).mock.calls.length).toBeGreaterThan(1)
    } finally {
      execute.mockRestore()
    }
  })

  it('should pause for human approval in Guided mode, then resume and execute the tool once approved', async () => {
    const writeFileTurn = toolTurn('write_file', { filePath: 'index.ts', content: 'console.log(1)' })
    const finishTurn = toolTurn('finish', { summary: 'Write approved and applied.' })
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(writeFileTurn).mockResolvedValueOnce(finishTurn)

    const mockWin = createMockWindow()
    const sessionId = 'test-ask-approval-session'

    const resultPromise = runAgentOrchestratorLoop(
      { sessionId, userTask: 'Update the entrypoint file', agentMode: 'guided', workspacePath: tempDir },
      mockWin.window,
    )

    await vi.waitFor(() => {
      expect(mockWin.send).toHaveBeenCalledWith('agent:approval-request', expect.objectContaining({ sessionId, type: 'write_file' }))
    })
    expect(fs.existsSync(path.join(tempDir, 'index.ts'))).toBe(false)

    expect(respondToApproval(sessionId, true)).toBe(true)

    const res = await resultPromise
    expect(res.success).toBe(false)
    expect(res.completionStatus).toBe('unverifiable')
    expect(res.summary).toContain('Write approved and applied.')
    expect(res.summary).not.toContain('FSM PERMISSION DENIED')
    expect(fs.existsSync(path.join(tempDir, 'index.ts'))).toBe(true)
  })

  it('routes a colloquial Italian build request to Guided write approval on the first turn', async () => {
    const writeFileTurn = toolTurn('write_file', { filePath: 'index.html', content: '<main>Gatto</main>' })
    const finishTurn = toolTurn('finish', { summary: 'Sito creato.' })
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(writeFileTurn).mockResolvedValueOnce(finishTurn)

    const mockWin = createMockWindow()
    const sessionId = 'italian-colloquial-guided-approval'
    const resultPromise = runAgentOrchestratorLoop(
      {
        sessionId,
        userTask: "Fammi un sito con un'immagine di un gatto che corre",
        agentMode: 'guided',
        workspacePath: tempDir,
      },
      mockWin.window,
    )

    await vi.waitFor(() => {
      expect(mockWin.send).toHaveBeenCalledWith('agent:approval-request', expect.objectContaining({ sessionId, type: 'write_file' }))
    })
    expect(AgentStreamTransport.streamCompletion).toHaveBeenCalledTimes(1)
    expect(vi.mocked(AgentStreamTransport.streamCompletion).mock.calls[0][0].toolCatalog?.map((entry) => entry.function.name)).toContain('write_file')

    expect(respondToApproval(sessionId, true)).toBe(true)
    const result = await resultPromise

    expect(AgentStreamTransport.streamCompletion).toHaveBeenCalledTimes(2)
    expect(result.summary).toContain('Sito creato.')
    expect(fs.readFileSync(path.join(tempDir, 'index.html'), 'utf-8')).toBe('<main>Gatto</main>')
  })

  it('should apply only the approved hunks when the user partially approves a write_file proposal', async () => {
    const filePath = path.join(tempDir, 'partial.ts')
    fs.writeFileSync(filePath, 'line1\nline2\nline3\nline4\nline5', 'utf-8')

    const writeFileTurn = toolTurn('write_file', { filePath: 'partial.ts', content: 'line1\nCHANGED2\nline3\nline4\nCHANGED5' })
    const finishTurn = toolTurn('finish', { summary: 'Partial approval applied.' })
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(writeFileTurn).mockResolvedValueOnce(finishTurn)

    const mockWin = createMockWindow()
    const sessionId = 'test-ask-partial-approval-session'

    const resultPromise = runAgentOrchestratorLoop(
      { sessionId, userTask: 'Update two lines in partial.ts', agentMode: 'guided', workspacePath: tempDir },
      mockWin.window,
    )

    await vi.waitFor(() => {
      expect(mockWin.send).toHaveBeenCalledWith('agent:approval-request', expect.objectContaining({ sessionId, type: 'write_file' }))
    })

    expect(respondToApproval(sessionId, true, [0])).toBe(true)

    const res = await resultPromise
    expect(res.success).toBe(false)
    expect(res.completionStatus).toBe('unverifiable')
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('line1\nCHANGED2\nline3\nline4\nline5')
  })

  it('should feed a denial back to the model and keep the loop running when the user rejects an approval', async () => {
    const writeFileTurn = toolTurn('write_file', { filePath: 'index.ts', content: 'console.log(1)' })
    const finishTurn = toolTurn('finish', { summary: 'Acknowledged the denial.' })
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(writeFileTurn).mockResolvedValueOnce(finishTurn)

    const mockWin = createMockWindow()
    const sessionId = 'test-ask-rejection-session'

    const resultPromise = runAgentOrchestratorLoop(
      { sessionId, userTask: 'Update the entrypoint file', agentMode: 'guided', workspacePath: tempDir },
      mockWin.window,
    )

    await vi.waitFor(() => {
      expect(mockWin.send).toHaveBeenCalledWith('agent:approval-request', expect.objectContaining({ sessionId, type: 'write_file' }))
    })

    expect(respondToApproval(sessionId, false)).toBe(true)

    const res = await resultPromise
    expect(res.success).toBe(false)
    expect(res.summary).toContain('Acknowledged the denial.')
    expect(fs.existsSync(path.join(tempDir, 'index.ts'))).toBe(false)
  })

  it('should still allow finish in ASK mode without triggering approval flow', async () => {
    const finishTurn = toolTurn('finish', { summary: 'Inspection complete.' })
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(finishTurn)

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Inspect the codebase',
        agentMode: 'ask',
        workspacePath: tempDir,
      },
      null,
    )

    expect(res.success).toBe(true)
    expect(res.summary).toBe('Inspection complete.')
  })

  it('should always pause for human approval on git_commit in Auto mode', async () => {
    const commitTurn = toolTurn('git_commit', { commitMessage: 'Add feature X' })
    const finishTurn = toolTurn('finish', { summary: 'Commit step handled.' })
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(commitTurn).mockResolvedValueOnce(finishTurn)

    const mockWin = createMockWindow()
    const sessionId = 'test-agent-commit-approval-session'
    const ownedPath = path.join(tempDir, 'owned.txt')
    execFileSync('git', ['init'], { cwd: tempDir })
    execFileSync('git', ['config', 'user.email', 'test@onlyrag.local'], { cwd: tempDir })
    execFileSync('git', ['config', 'user.name', 'OnlyRag Test'], { cwd: tempDir })
    fs.writeFileSync(ownedPath, 'before')
    execFileSync('git', ['add', '--', 'owned.txt'], { cwd: tempDir })
    execFileSync('git', ['commit', '-m', 'baseline'], { cwd: tempDir })
    agentToolExecutorService.getJournal().recordBeforeModification(ownedPath)
    fs.writeFileSync(ownedPath, 'after')

    const resultPromise = runAgentOrchestratorLoop({ sessionId, userTask: 'Commit the changes', agentMode: 'auto', workspacePath: tempDir }, mockWin.window)

    await vi.waitFor(() => {
      expect(mockWin.send).toHaveBeenCalledWith(
        'agent:approval-request',
        expect.objectContaining({
          sessionId,
          type: 'git_commit',
          parameters: expect.objectContaining({ commitPaths: ['owned.txt'], commitDiff: expect.stringContaining('+after') }),
        }),
      )
    })

    expect(respondToApproval(sessionId, true)).toBe(true)

    const res = await resultPromise
    expect(res.success).toBe(false)
    expect(res.completionStatus).toBe('unverifiable')
    expect(res.summary).toContain('Commit step handled.')
    expect(res.summary).not.toContain('FSM PERMISSION DENIED')
  })

  it('should resolve a pending approval as denied when the session is cancelled while awaiting a response', async () => {
    const writeFileTurn = toolTurn('write_file', { filePath: 'index.ts', content: 'console.log(1)' })
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(writeFileTurn)

    const mockWin = createMockWindow()
    const sessionId = 'test-cancel-during-approval-session'

    const resultPromise = runAgentOrchestratorLoop(
      { sessionId, userTask: 'Update the entrypoint file', agentMode: 'guided', workspacePath: tempDir },
      mockWin.window,
    )

    await vi.waitFor(() => {
      expect(mockWin.send).toHaveBeenCalledWith('agent:approval-request', expect.objectContaining({ sessionId, type: 'write_file' }))
    })

    expect(requestActiveAgentContextCompaction(sessionId)).toBe(true)
    cancelActiveAgentTask(sessionId)

    await expect(resultPromise).resolves.toMatchObject({ success: false })
    expect(mockWin.send).toHaveBeenCalledWith(
      'agent:done',
      expect.objectContaining({
        completionStatus: 'cancelled',
        evidence: expect.objectContaining({
          changedFiles: [],
          // Stop keeps whatever the run wrote; undoing it is an explicit checkpoint restore.
          cancellationStatus: 'kept',
          nonRollbackEffects: [],
        }),
      }),
    )
    expect(fs.existsSync(path.join(tempDir, 'index.ts'))).toBe(false)
    expect(respondToApproval(sessionId, true)).toBe(false)
    expect(requestActiveAgentContextCompaction(sessionId)).toBe(false)
  })

  it('never executes a verificationCommand that writes the workspace, even from a restored session', async () => {
    // Plans parsed today drop such a command at ingestion, but a session persisted before that rule existed still carries it, and executing it is what rewrote src/App.tsx and src/pages/Tasks.tsx as UTF-16 garbage in session-1787497654743-4enx — after which the miles
    const sessionId = 'plan-verify-unsafe-session'
    const identity = {
      runId: 'plan-verify-unsafe-run',
      conversationId: sessionId,
      planRevisionId: 'plan-verify-unsafe:v1',
      workspaceId: `workspace:${tempDir}`,
    }
    const sessionDir = path.join(tempDir, '.onlyrag', 'sessions')
    fs.mkdirSync(sessionDir, { recursive: true })
    fs.writeFileSync(
      path.join(sessionDir, `.agent_state_${sessionId}.json`),
      JSON.stringify({
        sessionId,
        runIdentity: identity,
        workspacePath: tempDir,
        agentMode: 'auto',
        stepCount: 1,
        maxSteps: 50,
        episodes: [],
        recentFullLogs: [],
        userTask: 'Build the app',
        initialUserTask: 'Build the app',
        updatedAt: new Date().toISOString(),
        status: 'IN_PROGRESS',
        planMilestones: [
          { id: 'm-1', title: 'Create `legacy.txt`', status: 'in_progress', verificationCommand: 'echo hello > legacy.txt' },
          { id: 'm-2', title: 'Add tests', status: 'pending' },
        ],
      }),
    )

    const updateTurn = toolTurn('update_plan', { milestoneId: 'm-1', status: 'verified' })
    const finishTurn = toolTurn('finish', { summary: 'Done.' })
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(updateTurn).mockResolvedValueOnce(finishTurn).mockResolvedValueOnce(finishTurn)

    await runAgentOrchestratorLoop({ identity, userTask: 'Build the app', agentMode: 'auto', workspacePath: tempDir, sessionId }, null)

    expect(fs.existsSync(path.join(tempDir, 'legacy.txt'))).toBe(false)
    const saved = JSON.parse(fs.readFileSync(path.join(sessionDir, `.agent_state_${sessionId}.json`), 'utf-8'))
    const m1 = saved.planMilestones.find((m: { id: string }) => m.id === 'm-1')
    expect(m1.status).not.toBe('verified')
    expect(m1.notes).toContain('refused')
  })

  it('should keep num_ctx frozen across turns instead of resizing it per prompt', async () => {
    const listTurn = toolTurn('list_dir', { dirPath: '.' })
    const finishTurn = toolTurn('finish', { summary: 'Listed.' })

    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(listTurn).mockResolvedValueOnce(listTurn).mockResolvedValueOnce(finishTurn)

    await runAgentOrchestratorLoop({ userTask: 'List the workspace', agentMode: 'auto', workspacePath: tempDir }, null)

    const ctxPerTurn = vi.mocked(AgentStreamTransport.streamCompletion).mock.calls.map((call) => call[0].runtimeOpts.num_ctx)

    expect(ctxPerTurn.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < ctxPerTurn.length; i++) {
      expect(ctxPerTurn[i]).toBeGreaterThanOrEqual(ctxPerTurn[i - 1])
    }
    expect(new Set(ctxPerTurn).size).toBe(1)
  })

  it('should disarm the session watchdog when the loop exits early', async () => {
    vi.useFakeTimers()
    try {
      const sent: Array<{ channel: string; payload: unknown }> = []
      const fakeWin: RendererEventSink = {
        isAvailable: () => true,
        send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
      }

      vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(toolTurn('finish', { summary: 'Quick exit.' }))

      const res = await runAgentOrchestratorLoop({ userTask: 'Do nothing', agentMode: 'auto', workspacePath: tempDir, sessionId: 'reused-session-id' }, fakeWin)
      expect(res.success).toBe(false)
      expect(res.completionStatus).toBe('unverifiable')

      const doneCountAfterRun = sent.filter((m) => m.channel === 'agent:done').length
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

      expect(sent.filter((m) => m.channel === 'agent:done').length).toBe(doneCountAfterRun)
      expect(sent.some((m) => JSON.stringify(m.payload).includes('Sessione terminata automaticamente'))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('should close once as unverifiable when modified work has no project check', async () => {
    const writeTurn = toolTurn('write_file', { filePath: 'app.js', content: 'console.log(1)' })
    const finishTurn = toolTurn('finish', { summary: 'Done.' })

    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(writeTurn).mockResolvedValueOnce(finishTurn).mockResolvedValueOnce(finishTurn)

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Create app.js',
        agentMode: 'auto',
        workspacePath: tempDir,
      },
      null,
    )

    expect(AgentStreamTransport.streamCompletion).toHaveBeenCalledTimes(2)
    expect(res.success).toBe(false)
    expect(res.completionStatus).toBe('unverifiable')
    expect(res.summary).toContain('Done.')
  })

  it('should not ask the model to repeat finish when evidence is unavailable', async () => {
    const writeTurn = toolTurn('write_file', { filePath: 'b.js', content: 'console.log(2)' })
    const finishTurn = toolTurn('finish', { summary: 'Second attempt.' })

    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce(writeTurn)
      .mockResolvedValueOnce(finishTurn)
      .mockResolvedValueOnce(finishTurn)
      .mockResolvedValueOnce(finishTurn)

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Create b.js',
        agentMode: 'auto',
        workspacePath: tempDir,
      },
      null,
    )

    expect(res.success).toBe(false)
    expect(res.completionStatus).toBe('unverifiable')
    expect(res.summary).toContain('Second attempt.')
    expect(AgentStreamTransport.streamCompletion).toHaveBeenCalledTimes(2)
  })

  it('should immediately fail-fast and inform user if workspace is not specified and not in standalone mode', async () => {
    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Create a new React project',
        agentMode: 'auto',
        workspacePath: undefined,
        isStandaloneMode: false,
      },
      null,
    )

    expect(res.success).toBe(false)
    expect(res.summary).toContain('Nessuna cartella di progetto / workspace specificata')
    expect(res.completionStatus).toBe('blocked')
  })

  const verificationWriteTurn = toolTurn('write_file', { filePath: 'app.js', content: 'console.log(1)' })
  const verificationFinishTurn = toolTurn('finish', { summary: 'All done.' })

  function scriptTurns(...turns: AgentChatTurn[]) {
    let chain = vi.mocked(AgentStreamTransport.streamCompletion)
    for (const turn of turns) chain = chain.mockResolvedValueOnce(turn)
  }

  describe('finish gate runs the project verification instead of waiving it', () => {
    const finishVerificationSettings = {
      ...TOOL_ENABLED_SETTINGS,
      verifyBeforeFinish: true,
    } as AppSettings

    it('lets finish through when the verification passes', async () => {
      vi.mocked(runProjectVerification).mockResolvedValue({
        hasVerificationCommand: true,
        passed: true,
        status: 'verified',
        command: 'npm test',
        evidenceLevel: 'behavioral',
      })
      scriptTurns(verificationWriteTurn, verificationFinishTurn)

      const res = await runAgentOrchestratorLoop(
        { userTask: 'Create app.js', agentMode: 'auto', workspacePath: tempDir, settings: finishVerificationSettings },
        null,
      )

      expect(runProjectVerification).toHaveBeenCalled()
      expect(res.success).toBe(true)
      expect(res.completionStatus).toBe('verified')
      expect(res.summary).toContain('All done.')
    })

    it('blocks finish and closes the session as FAILED after the allowed rounds', async () => {
      // The o3tx regression: the gate used to warn once, then let finish through, and the session
      // reported COMPLETED on a project that never built.
      vi.mocked(runProjectVerification).mockResolvedValue({
        hasVerificationCommand: true,
        passed: false,
        status: 'failed',
        command: 'npm run build',
        failureDetail: "error TS2307: Cannot find module './main'",
      })
      scriptTurns(verificationWriteTurn, verificationFinishTurn, verificationFinishTurn, verificationFinishTurn, verificationFinishTurn, verificationFinishTurn)

      const res = await runAgentOrchestratorLoop(
        { userTask: 'Create app.js', agentMode: 'auto', workspacePath: tempDir, settings: finishVerificationSettings },
        null,
      )

      expect(res.success).toBe(false)
      expect(res.completionStatus).toBe('blocked')
      expect(res.summary).toContain('BLOCCATO')
      expect(res.summary).toContain('TS2307')
      expect(vi.mocked(runProjectVerification).mock.calls.length).toBe(MAX_VERIFICATION_FIX_CYCLES)
    })

    it('gives the model its correction rounds before giving up', async () => {
      // Fails twice, then the model fixes it and the third verification passes.
      vi.mocked(runProjectVerification)
        .mockResolvedValueOnce({ hasVerificationCommand: true, passed: false, status: 'failed', failureDetail: 'boom 1' })
        .mockResolvedValueOnce({ hasVerificationCommand: true, passed: false, status: 'failed', failureDetail: 'boom 2' })
        .mockResolvedValue({ hasVerificationCommand: true, passed: true, status: 'verified', command: 'npm test', evidenceLevel: 'behavioral' })
      scriptTurns(verificationWriteTurn, verificationFinishTurn, verificationFinishTurn, verificationFinishTurn)

      const res = await runAgentOrchestratorLoop(
        { userTask: 'Create app.js', agentMode: 'auto', workspacePath: tempDir, settings: finishVerificationSettings },
        null,
      )

      expect(res.success).toBe(true)
      expect(res.completionStatus).toBe('verified')
      expect(res.summary).toContain('All done.')
    })

    it('closes as unverifiable when the project offers no verification command', async () => {
      vi.mocked(runProjectVerification).mockResolvedValue({ hasVerificationCommand: false, status: 'unverifiable' })
      // Three turns, because the missing-build reason is surfaced to the model once before finish is let through: the second finish is the one that closes the session.
      scriptTurns(verificationWriteTurn, verificationFinishTurn, verificationFinishTurn)

      const res = await runAgentOrchestratorLoop(
        { userTask: 'Create app.js', agentMode: 'auto', workspacePath: tempDir, settings: finishVerificationSettings },
        null,
      )

      expect(res.success).toBe(false)
      expect(res.completionStatus).toBe('unverifiable')
      expect(res.summary).toContain('All done.')
    })
  })

  describe('a session whose model stops issuing tool calls', () => {
    // session-1787497654743-4enx closed "Status: COMPLETED" at step 86 after three responses that did not parse as tool calls, with four milestones abandoned, four never started and finish never invoked — so the whole Definition of Done gate was skipped and the resu
    const prose: AgentChatTurn = { content: 'Everything looks complete to me, the application should work now.', thinking: '', toolCalls: [] }

    it('closes the session as FAILED rather than COMPLETED', async () => {
      vi.mocked(runProjectVerification).mockResolvedValue({ hasVerificationCommand: false, status: 'unverifiable' })
      scriptTurns(verificationWriteTurn, prose, prose, prose)

      const res = await runAgentOrchestratorLoop({ userTask: 'Create app.js', agentMode: 'auto', workspacePath: tempDir }, null)

      expect(res.success).toBe(false)
      expect(res.completionStatus).toBe('blocked')
      expect(res.summary).toContain('BLOCCATO')
    })

    it('runs application verification even when finish was never reached', async () => {
      vi.mocked(runProjectVerification).mockResolvedValue({ hasVerificationCommand: false, status: 'unverifiable' })
      scriptTurns(verificationWriteTurn, prose, prose, prose)

      await runAgentOrchestratorLoop({ userTask: 'Create app.js', agentMode: 'auto', workspacePath: tempDir }, null)

      expect(runProjectVerification).toHaveBeenCalledTimes(1)
    })

    it('still completes an ASK-mode turn, where a prose answer is the deliverable', async () => {
      scriptTurns(prose)

      const res = await runAgentOrchestratorLoop({ userTask: 'Explain what this project does', agentMode: 'ask', workspacePath: tempDir }, null)

      expect(res.success).toBe(true)
      expect(res.summary).toContain('Everything looks complete')
    })
  })
})
