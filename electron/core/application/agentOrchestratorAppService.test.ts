import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { runAgentOrchestratorLoop, cancelActiveAgentTask, respondToApproval } from './agentOrchestratorAppService'
import { AgentStreamTransport } from '../infrastructure/http/agentStreamTransport'
import { runProjectVerification } from './agentOrchestratorVerificationRunner'
import { MAX_VERIFICATION_FIX_CYCLES } from '../domain/agent/verificationGatePolicy'
import { buildDefaultAgentSettings } from './agentOrchestratorSessionSetup'
import type { AppSettings } from '../../../src/types'

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
    getModelMetrics: vi.fn().mockResolvedValue({}),
    preloadModel: vi.fn().mockResolvedValue({ success: true }),
  },
}))

// The real runner shells out to `npm run build`; what is under test here is the gate's wiring.
vi.mock('./agentOrchestratorVerificationRunner', () => ({
  runProjectVerification: vi.fn().mockResolvedValue({ hasVerificationCommand: false }),
}))

vi.mock('./skillAppService', () => ({
  skillAppService: {
    getMatchedSkills: vi.fn().mockResolvedValue([]),
    getContextSkillsBlock: vi.fn().mockResolvedValue(''),
  },
}))

describe('AgentOrchestratorAppService Resilience & Loop Integration Tests', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-orchestrator-test-'))
    vi.clearAllMocks()
    // clearAllMocks resets call history but NOT the mockResolvedValueOnce queue, and every
    // test here scripts a turn-by-turn sequence of LLM replies. A test that consumes fewer
    // replies than it queued therefore leaked the remainder into the next test, which then
    // ran against another test's script — the failures surfaced far from their cause and
    // moved whenever the loop's step count changed. mockReset drains the queue too.
    vi.mocked(AgentStreamTransport.streamCompletion).mockReset()
    vi.mocked(runProjectVerification).mockReset()
    vi.mocked(runProjectVerification).mockResolvedValue({ hasVerificationCommand: false })
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
        agentMode: 'agent',
        workspacePath: tempDir,
      },
      null
    )

    expect(res.success).toBe(false)
    expect(res.error).toBe('Task prompt is required')
  })

  it('should execute finish tool call and complete session successfully, marking milestones verified', async () => {
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(
      '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "All tasks done perfectly." }\n}\n```'
    )

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Create test project',
        agentMode: 'agent',
        workspacePath: tempDir,
      },
      null
    )

    expect(res.success).toBe(true)
    expect(res.summary).toBe('All tasks done perfectly.')
    const tracker = fs.readFileSync(path.join(tempDir, '.onlyrag', 'assistant', 'SESSION_TRACKER.md'), 'utf-8')
    expect(tracker).toContain('## 5. Raw Agent Summary')
    expect(tracker).toContain('All tasks done perfectly.')
  })

  it('should intercept repetitive loop calls and inject intervention directive', async () => {
    // Model repeats the exact same failing command 3 times, then finishes
    const duplicateToolJson = '```json\n{\n  "tool": "run_command",\n  "parameters": { "command": "pytest failing_test.py" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Pivoted and completed." }\n}\n```'

    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce(duplicateToolJson)
      .mockResolvedValueOnce(duplicateToolJson)
      .mockResolvedValueOnce(duplicateToolJson)
      .mockResolvedValueOnce(finishJson)

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Debug test failures',
        agentMode: 'agent',
        workspacePath: tempDir,
      },
      null
    )

    expect(res.success).toBe(true)
    expect(res.summary).toBe('Pivoted and completed.')
    expect(AgentStreamTransport.streamCompletion).toHaveBeenCalledTimes(4)
  })

  it('must not grant a fresh ask-redirect grace period to a model that just escaped an exhausted write-loop stagnation budget', async () => {
    const duplicateToolJson = '```json\n{\n  "tool": "run_command",\n  "parameters": { "command": "pytest still_failing.py" }\n}\n```'
    const askJson = '```json\n{\n  "tool": "ask",\n  "parameters": { "question": "What should we do next?" }\n}\n```'

    let call = vi.mocked(AgentStreamTransport.streamCompletion)
    for (let i = 0; i < 8; i++) call = call.mockResolvedValueOnce(duplicateToolJson)
    for (let i = 0; i < 3; i++) call = call.mockResolvedValueOnce(askJson)

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Debug test failures',
        agentMode: 'agent',
        workspacePath: tempDir,
      },
      null
    )
    vi.mocked(AgentStreamTransport.streamCompletion).mockReset()

    expect(res.success).toBe(false)
    expect(res.summary).toContain('What should we do next?')
  })

  it('should trip stagnation circuit breaker when repeated failures occur on complex tasks', async () => {
    const failingCommandJson = (n: number) =>
      `\`\`\`json\n{\n  "tool": "run_command",\n  "parameters": { "command": "pytest failing_test_${n}.py" }\n}\n\`\`\``
    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce(failingCommandJson(1))
      .mockResolvedValueOnce(failingCommandJson(2))
      .mockResolvedValueOnce(failingCommandJson(3))
      .mockResolvedValueOnce(failingCommandJson(4))
      .mockResolvedValueOnce(failingCommandJson(5))

    const settings: AppSettings = {
      defaultModel: 'llama3.2',
      hardwareProfile: 'Auto',
      ocrEngine: 'native_cuda',
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
        agentMode: 'agent',
        workspacePath: tempDir,
        settings,
      },
      null
    )

    expect(AgentStreamTransport.streamCompletion).toHaveBeenCalledTimes(5)
    expect(res.success).toBe(false)
  })

  it('should execute in plan mode and complete with step proposal without mutating files', async () => {
    const proposedActionJson = '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "index.ts", "content": "console.log(1)" }\n}\n```'
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(proposedActionJson)

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Plan the architecture',
        agentMode: 'plan',
        workspacePath: tempDir,
      },
      null
    )

    expect(res.success).toBe(true)
    expect(res.summary).toContain('Proposed tool call: write_file')
    expect(fs.existsSync(path.join(tempDir, 'index.ts'))).toBe(false)
  })

  it('should persist a plan initialized during a PLAN-mode step before the step returns', async () => {
    const planWithChecklistJson =
      '- [ ] Design database schema\n- [ ] Implement API endpoints\n\n' +
      '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "index.ts", "content": "console.log(1)" }\n}\n```'
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(planWithChecklistJson)

    const sessionId = 'test-plan-persist-session'
    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Plan the architecture',
        agentMode: 'plan',
        workspacePath: tempDir,
      },
      null,
      sessionId
    )

    expect(res.success).toBe(true)

    const statePath = path.join(tempDir, '.onlyrag', 'sessions', `.agent_state_${sessionId}.json`)
    expect(fs.existsSync(statePath)).toBe(true)
    const savedState = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
    expect(savedState.planMilestones.length).toBe(2)
    expect(savedState.planMilestones[0].title).toContain('Design database schema')
  })

  it('must never seed a freshly-initialized plan with already-verified milestones', async () => {
    const wronglyCheckedPlanJson =
      '<plan>\n[\n  { "id": "m1", "title": "Design database schema", "status": "verified" },\n' +
      '  { "id": "m2", "title": "Implement API endpoints", "status": "verified" }\n]\n</plan>\n\n' +
      '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "index.ts", "content": "console.log(1)" }\n}\n```'
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(wronglyCheckedPlanJson)

    const sessionId = 'test-plan-fresh-checked-session'
    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Plan the architecture',
        agentMode: 'plan',
        workspacePath: tempDir,
      },
      null,
      sessionId
    )

    expect(res.success).toBe(true)

    const statePath = path.join(tempDir, '.onlyrag', 'sessions', `.agent_state_${sessionId}.json`)
    const savedState = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
    expect(savedState.planMilestones.length).toBe(2)
    expect(savedState.planMilestones.every((m: { status: string }) => m.status === 'pending')).toBe(true)
  })

  it('should hot-swap from plan to agent mode smoothly on consecutive turns', async () => {
    const planJson = '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "app.ts", "content": "export const a = 1;" }\n}\n```'
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(planJson)

    const turn1Res = await runAgentOrchestratorLoop(
      {
        userTask: 'Step 1: Plan architecture',
        agentMode: 'plan',
        workspacePath: tempDir,
      },
      null
    )
    expect(turn1Res.success).toBe(true)
    expect(turn1Res.summary).toContain('Proposed tool call')

    const agentFinishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Code executed and verified." }\n}\n```'
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(agentFinishJson)

    const turn2Res = await runAgentOrchestratorLoop(
      {
        userTask: 'Step 2: Execute plan',
        agentMode: 'agent',
        workspacePath: tempDir,
      },
      null
    )
    expect(turn2Res.success).toBe(true)
    expect(turn2Res.summary).toBe('Code executed and verified.')
  })

  it('should pause for human approval in ASK mode, then resume and execute the tool once approved', async () => {
    const writeFileJson = '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "index.ts", "content": "console.log(1)" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Write approved and applied." }\n}\n```'
    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce(writeFileJson)
      .mockResolvedValueOnce(finishJson)

    const mockWin = { isDestroyed: () => false, webContents: { send: vi.fn() } } as any
    const sessionId = 'test-ask-approval-session'

    const resultPromise = runAgentOrchestratorLoop(
      { sessionId, userTask: 'Update the entrypoint file', agentMode: 'ask', workspacePath: tempDir },
      mockWin
    )

    await vi.waitFor(() => {
      expect(mockWin.webContents.send).toHaveBeenCalledWith(
        'agent:approval-request',
        expect.objectContaining({ sessionId, type: 'write_file' })
      )
    })
    expect(fs.existsSync(path.join(tempDir, 'index.ts'))).toBe(false)

    expect(respondToApproval(sessionId, true)).toBe(true)

    const res = await resultPromise
    expect(res.success).toBe(true)
    expect(res.summary).toBe('Write approved and applied.')
    expect(res.summary).not.toContain('FSM PERMISSION DENIED')
    expect(fs.existsSync(path.join(tempDir, 'index.ts'))).toBe(true)
  })

  it('should apply only the approved hunks when the user partially approves a write_file proposal', async () => {
    const filePath = path.join(tempDir, 'partial.ts')
    fs.writeFileSync(filePath, 'line1\nline2\nline3\nline4\nline5', 'utf-8')

    const writeFileJson = '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "partial.ts", "content": "line1\\nCHANGED2\\nline3\\nline4\\nCHANGED5" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Partial approval applied." }\n}\n```'
    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce(writeFileJson)
      .mockResolvedValueOnce(finishJson)

    const mockWin = { isDestroyed: () => false, webContents: { send: vi.fn() } } as any
    const sessionId = 'test-ask-partial-approval-session'

    const resultPromise = runAgentOrchestratorLoop(
      { sessionId, userTask: 'Update two lines in partial.ts', agentMode: 'ask', workspacePath: tempDir },
      mockWin
    )

    await vi.waitFor(() => {
      expect(mockWin.webContents.send).toHaveBeenCalledWith(
        'agent:approval-request',
        expect.objectContaining({ sessionId, type: 'write_file' })
      )
    })

    expect(respondToApproval(sessionId, true, [0])).toBe(true)

    const res = await resultPromise
    expect(res.success).toBe(true)
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('line1\nCHANGED2\nline3\nline4\nline5')
  })

  it('should feed a denial back to the model and keep the loop running when the user rejects an approval', async () => {
    const writeFileJson = '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "index.ts", "content": "console.log(1)" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Acknowledged the denial." }\n}\n```'
    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce(writeFileJson)
      .mockResolvedValueOnce(finishJson)

    const mockWin = { isDestroyed: () => false, webContents: { send: vi.fn() } } as any
    const sessionId = 'test-ask-rejection-session'

    const resultPromise = runAgentOrchestratorLoop(
      { sessionId, userTask: 'Update the entrypoint file', agentMode: 'ask', workspacePath: tempDir },
      mockWin
    )

    await vi.waitFor(() => {
      expect(mockWin.webContents.send).toHaveBeenCalledWith(
        'agent:approval-request',
        expect.objectContaining({ sessionId, type: 'write_file' })
      )
    })

    expect(respondToApproval(sessionId, false)).toBe(true)

    const res = await resultPromise
    expect(res.success).toBe(true)
    expect(res.summary).toBe('Acknowledged the denial.')
    expect(fs.existsSync(path.join(tempDir, 'index.ts'))).toBe(false)
  })

  it('should still allow finish in ASK mode without triggering approval flow', async () => {
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Inspection complete." }\n}\n```'
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(finishJson)

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Inspect the codebase',
        agentMode: 'ask',
        workspacePath: tempDir,
      },
      null
    )

    expect(res.success).toBe(true)
    expect(res.summary).toBe('Inspection complete.')
  })

  it('should always pause for human approval on git_commit in AGENT mode', async () => {
    const commitJson = '```json\n{\n  "tool": "git_commit",\n  "parameters": { "commitMessage": "Add feature X" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Commit step handled." }\n}\n```'
    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce(commitJson)
      .mockResolvedValueOnce(finishJson)

    const mockWin = { isDestroyed: () => false, webContents: { send: vi.fn() } } as any
    const sessionId = 'test-agent-commit-approval-session'

    const resultPromise = runAgentOrchestratorLoop(
      { sessionId, userTask: 'Commit the changes', agentMode: 'agent', workspacePath: tempDir },
      mockWin
    )

    await vi.waitFor(() => {
      expect(mockWin.webContents.send).toHaveBeenCalledWith(
        'agent:approval-request',
        expect.objectContaining({ sessionId, type: 'git_commit' })
      )
    })

    expect(respondToApproval(sessionId, true)).toBe(true)

    const res = await resultPromise
    expect(res.success).toBe(true)
    expect(res.summary).toBe('Commit step handled.')
    expect(res.summary).not.toContain('FSM PERMISSION DENIED')
  })

  it('should resolve a pending approval as denied when the session is cancelled while awaiting a response', async () => {
    const writeFileJson = '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "index.ts", "content": "console.log(1)" }\n}\n```'
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(writeFileJson)

    const mockWin = { isDestroyed: () => false, webContents: { send: vi.fn() } } as any
    const sessionId = 'test-cancel-during-approval-session'

    const resultPromise = runAgentOrchestratorLoop(
      { sessionId, userTask: 'Update the entrypoint file', agentMode: 'ask', workspacePath: tempDir },
      mockWin
    )

    await vi.waitFor(() => {
      expect(mockWin.webContents.send).toHaveBeenCalledWith(
        'agent:approval-request',
        expect.objectContaining({ sessionId, type: 'write_file' })
      )
    })

    cancelActiveAgentTask(sessionId)

    await expect(resultPromise).resolves.toMatchObject({ success: false })
    expect(fs.existsSync(path.join(tempDir, 'index.ts'))).toBe(false)
    expect(respondToApproval(sessionId, true)).toBe(false)
  })

  it('should let the model advance the plan explicitly through the update_plan tool', async () => {
    const planJson =
      '<plan>\n- [ ] Scaffold project\n- [ ] Add tests\n</plan>\n\n```json\n{\n  "tool": "list_dir",\n  "parameters": { "dirPath": "." }\n}\n```'
    const updateJson =
      '```json\n{\n  "tool": "update_plan",\n  "parameters": { "milestoneId": "m-1", "status": "verified" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Plan advanced." }\n}\n```'

    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce(planJson)
      .mockResolvedValueOnce(updateJson)
      .mockResolvedValueOnce(finishJson)
      .mockResolvedValueOnce(finishJson)

    const res = await runAgentOrchestratorLoop(
      { userTask: 'Build the app', agentMode: 'agent', workspacePath: tempDir, sessionId: 'plan-tool-session' },
      null
    )

    expect(res.success).toBe(true)
    const statePath = path.join(tempDir, '.onlyrag', 'sessions', '.agent_state_plan-tool-session.json')
    const saved = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
    const verified = saved.planMilestones.filter((m: any) => m.status === 'verified')
    expect(verified.length).toBe(1)
    expect(verified[0].id).toBe('m-1')
  })

  it('should only mark a milestone verified when its verificationCommand actually exits 0', async () => {
    const planJson =
      '<plan>[{"id":"m-1","title":"Scaffold project","verificationCommand":"node -e \\"process.exit(0)\\""},{"id":"m-2","title":"Add tests"}]</plan>\n\n```json\n{\n  "tool": "list_dir",\n  "parameters": { "dirPath": "." }\n}\n```'
    const updateJson =
      '```json\n{\n  "tool": "update_plan",\n  "parameters": { "milestoneId": "m-1", "status": "verified" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Plan advanced." }\n}\n```'

    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce(planJson)
      .mockResolvedValueOnce(updateJson)
      .mockResolvedValueOnce(finishJson)
      .mockResolvedValueOnce(finishJson)

    const res = await runAgentOrchestratorLoop(
      { userTask: 'Build the app', agentMode: 'agent', workspacePath: tempDir, sessionId: 'plan-verify-pass-session' },
      null
    )

    expect(res.success).toBe(true)
    const statePath = path.join(tempDir, '.onlyrag', 'sessions', '.agent_state_plan-verify-pass-session.json')
    const saved = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
    const m1 = saved.planMilestones.find((m: any) => m.id === 'm-1')
    expect(m1.status).toBe('verified')
    expect(m1.notes).toContain('Auto-verified by running: node -e "process.exit(0)"')
  })

  it('never executes a verificationCommand that writes the workspace, even from a restored session', async () => {
    // Plans parsed today drop such a command at ingestion, but a session persisted before that
    // rule existed still carries it, and executing it is what rewrote src/App.tsx and
    // src/pages/Tasks.tsx as UTF-16 garbage in session-1787497654743-4enx — after which the
    // milestone was marked verified because the write had exited 0.
    const sessionId = 'plan-verify-unsafe-session'
    const sessionDir = path.join(tempDir, '.onlyrag', 'sessions')
    fs.mkdirSync(sessionDir, { recursive: true })
    fs.writeFileSync(
      path.join(sessionDir, `.agent_state_${sessionId}.json`),
      JSON.stringify({
        sessionId,
        stepCount: 1,
        initialUserTask: 'Build the app',
        planMilestones: [
          { id: 'm-1', title: 'Create `legacy.txt`', status: 'in_progress', verificationCommand: 'echo hello > legacy.txt' },
          { id: 'm-2', title: 'Add tests', status: 'pending' },
        ],
      })
    )

    const updateJson =
      '```json\n{\n  "tool": "update_plan",\n  "parameters": { "milestoneId": "m-1", "status": "verified" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Done." }\n}\n```'
    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce(updateJson)
      .mockResolvedValueOnce(finishJson)
      .mockResolvedValueOnce(finishJson)

    await runAgentOrchestratorLoop({ userTask: 'Build the app', agentMode: 'agent', workspacePath: tempDir, sessionId }, null)

    expect(fs.existsSync(path.join(tempDir, 'legacy.txt'))).toBe(false)
    const saved = JSON.parse(fs.readFileSync(path.join(sessionDir, `.agent_state_${sessionId}.json`), 'utf-8'))
    const m1 = saved.planMilestones.find((m: any) => m.id === 'm-1')
    expect(m1.status).not.toBe('verified')
    expect(m1.notes).toContain('refused')
  })

  it('should set the milestone to failed when the model claims verified but its verificationCommand actually fails', async () => {
    const planJson =
      '<plan>[{"id":"m-1","title":"Scaffold project","verificationCommand":"node -e \\"process.exit(1)\\""},{"id":"m-2","title":"Add tests"}]</plan>\n\n```json\n{\n  "tool": "list_dir",\n  "parameters": { "dirPath": "." }\n}\n```'
    const updateJson =
      '```json\n{\n  "tool": "update_plan",\n  "parameters": { "milestoneId": "m-1", "status": "verified" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Done." }\n}\n```'

    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce(planJson)
      .mockResolvedValueOnce(updateJson)
      .mockResolvedValueOnce(finishJson)
      .mockResolvedValueOnce(finishJson)

    const res = await runAgentOrchestratorLoop(
      { userTask: 'Build the app', agentMode: 'agent', workspacePath: tempDir, sessionId: 'plan-verify-fail-session' },
      null
    )

    expect(res.success).toBe(true)
    const statePath = path.join(tempDir, '.onlyrag', 'sessions', '.agent_state_plan-verify-fail-session.json')
    const saved = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
    const m1 = saved.planMilestones.find((m: any) => m.id === 'm-1')
    expect(m1.status).toBe('failed')
    expect(m1.notes).toContain('Verification command failed')
  })

  it('should keep num_ctx frozen across turns instead of resizing it per prompt', async () => {
    const listJson = '```json\n{\n  "tool": "list_dir",\n  "parameters": { "dirPath": "." }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Listed." }\n}\n```'

    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce(listJson)
      .mockResolvedValueOnce(listJson)
      .mockResolvedValueOnce(finishJson)

    await runAgentOrchestratorLoop(
      { userTask: 'List the workspace', agentMode: 'agent', workspacePath: tempDir },
      null
    )

    const ctxPerTurn = vi
      .mocked(AgentStreamTransport.streamCompletion)
      .mock.calls.map((call) => (call[0] as any).runtimeOpts.num_ctx as number)

    expect(ctxPerTurn.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < ctxPerTurn.length; i++) {
      expect(ctxPerTurn[i]).toBeGreaterThanOrEqual(ctxPerTurn[i - 1])
    }
    expect(new Set(ctxPerTurn).size).toBe(1)
  })

  it('should disarm the session watchdog when the loop exits early', async () => {
    vi.useFakeTimers()
    try {
      const sent: Array<{ channel: string; payload: any }> = []
      const fakeWin: any = {
        isDestroyed: () => false,
        webContents: { send: (channel: string, payload: any) => sent.push({ channel, payload }) },
      }

      vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce(
        '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Quick exit." }\n}\n```'
      )

      const res = await runAgentOrchestratorLoop(
        { userTask: 'Do nothing', agentMode: 'agent', workspacePath: tempDir, sessionId: 'reused-session-id' },
        fakeWin
      )
      expect(res.success).toBe(true)

      const doneCountAfterRun = sent.filter((m) => m.channel === 'agent:done').length
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

      expect(sent.filter((m) => m.channel === 'agent:done').length).toBe(doneCountAfterRun)
      expect(sent.some((m) => JSON.stringify(m.payload).includes('Sessione terminata automaticamente'))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('should intercept finish with the DoD guard after unverified file mutations, then allow it on the next attempt', async () => {
    const writeJson =
      '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "app.js", "content": "console.log(1)" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Done." }\n}\n```'

    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce(writeJson)
      .mockResolvedValueOnce(finishJson)
      .mockResolvedValueOnce(finishJson)

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Create app.js',
        agentMode: 'agent',
        workspacePath: tempDir,
      },
      null
    )

    expect(AgentStreamTransport.streamCompletion).toHaveBeenCalledTimes(3)
    expect(res.success).toBe(true)
    expect(res.summary).toBe('Done.')
  })

  it('should not intercept finish a second time for the same DoD reason', async () => {
    const writeJson =
      '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "b.js", "content": "console.log(2)" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Second attempt." }\n}\n```'

    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockResolvedValueOnce(writeJson)
      .mockResolvedValueOnce(finishJson)
      .mockResolvedValueOnce(finishJson)
      .mockResolvedValueOnce(finishJson)

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Create b.js',
        agentMode: 'agent',
        workspacePath: tempDir,
      },
      null
    )

    expect(res.success).toBe(true)
    expect(res.summary).toBe('Second attempt.')
    expect(AgentStreamTransport.streamCompletion).toHaveBeenCalledTimes(3)
  })

  it('should immediately fail-fast and inform user if workspace is not specified and not in standalone mode', async () => {
    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Create a new React project',
        agentMode: 'agent',
        workspacePath: undefined,
        isStandaloneMode: false,
      },
      null
    )

    expect(res.success).toBe(false)
    expect(res.summary).toContain('Nessuna cartella di progetto / workspace specificata')
  })

  const verificationWriteJson =
    '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "app.js", "content": "console.log(1)" }\n}\n```'
  const verificationFinishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "All done." }\n}\n```'

  function scriptTurns(...turns: string[]) {
    let chain = vi.mocked(AgentStreamTransport.streamCompletion)
    for (const turn of turns) chain = chain.mockResolvedValueOnce(turn)
  }

  describe('finish gate runs the project verification instead of waiving it', () => {
    const finishVerificationSettings = {
      ...buildDefaultAgentSettings(),
      verifyBeforeFinish: true,
    } as AppSettings

    it('lets finish through when the verification passes', async () => {
      vi.mocked(runProjectVerification).mockResolvedValue({
        hasVerificationCommand: true,
        passed: true,
        command: 'npm run build',
      })
      scriptTurns(verificationWriteJson, verificationFinishJson)

      const res = await runAgentOrchestratorLoop(
        { userTask: 'Create app.js', agentMode: 'agent', workspacePath: tempDir, settings: finishVerificationSettings },
        null
      )

      expect(runProjectVerification).toHaveBeenCalled()
      expect(res.success).toBe(true)
      expect(res.summary).toBe('All done.')
    })

    it('blocks finish and closes the session as FAILED after the allowed rounds', async () => {
      // The o3tx regression: the gate used to warn once, then let finish through, and the session
      // reported COMPLETED on a project that never built.
      vi.mocked(runProjectVerification).mockResolvedValue({
        hasVerificationCommand: true,
        passed: false,
        command: 'npm run build',
        failureDetail: "error TS2307: Cannot find module './main'",
      })
      scriptTurns(verificationWriteJson, verificationFinishJson, verificationFinishJson, verificationFinishJson, verificationFinishJson, verificationFinishJson)

      const res = await runAgentOrchestratorLoop(
        { userTask: 'Create app.js', agentMode: 'agent', workspacePath: tempDir, settings: finishVerificationSettings },
        null
      )

      expect(res.success).toBe(false)
      expect(res.summary).toContain('FAILED')
      expect(res.summary).toContain('TS2307')
      expect(vi.mocked(runProjectVerification).mock.calls.length).toBe(MAX_VERIFICATION_FIX_CYCLES)
    })

    it('gives the model its correction rounds before giving up', async () => {
      // Fails twice, then the model fixes it and the third verification passes.
      vi.mocked(runProjectVerification)
        .mockResolvedValueOnce({ hasVerificationCommand: true, passed: false, failureDetail: 'boom 1' })
        .mockResolvedValueOnce({ hasVerificationCommand: true, passed: false, failureDetail: 'boom 2' })
        .mockResolvedValue({ hasVerificationCommand: true, passed: true, command: 'npm run build' })
      scriptTurns(verificationWriteJson, verificationFinishJson, verificationFinishJson, verificationFinishJson)

      const res = await runAgentOrchestratorLoop(
        { userTask: 'Create app.js', agentMode: 'agent', workspacePath: tempDir, settings: finishVerificationSettings },
        null
      )

      expect(res.success).toBe(true)
      expect(res.summary).toBe('All done.')
    })

    it('proceeds when the project offers no verification command, instead of deadlocking', async () => {
      vi.mocked(runProjectVerification).mockResolvedValue({ hasVerificationCommand: false })
      // Three turns, because the missing-build reason is surfaced to the model once before
      // finish is let through: the second finish is the one that closes the session. The
      // earlier two-turn version of this test only passed because a session that ran out of
      // scripted responses used to be reported as a success.
      scriptTurns(verificationWriteJson, verificationFinishJson, verificationFinishJson)

      const res = await runAgentOrchestratorLoop(
        { userTask: 'Create app.js', agentMode: 'agent', workspacePath: tempDir, settings: finishVerificationSettings },
        null
      )

      expect(res.success).toBe(true)
      expect(res.summary).toBe('All done.')
    })
  })

  describe('a session whose model stops issuing tool calls', () => {
    // session-1787497654743-4enx closed "Status: COMPLETED" at step 86 after three responses
    // that did not parse as tool calls, with four milestones abandoned, four never started and
    // finish never invoked — so the whole Definition of Done gate was skipped and the result
    // was still reported as a success.
    const prose = 'Everything looks complete to me, the application should work now.'

    it('closes the session as FAILED rather than COMPLETED', async () => {
      vi.mocked(runProjectVerification).mockResolvedValue({ hasVerificationCommand: false })
      scriptTurns(verificationWriteJson, prose, prose, prose)

      const res = await runAgentOrchestratorLoop(
        { userTask: 'Create app.js', agentMode: 'agent', workspacePath: tempDir },
        null
      )

      expect(res.success).toBe(false)
      expect(res.summary).toContain('finish')
    })

    it('never runs the finish verification, because finish was never reached', async () => {
      vi.mocked(runProjectVerification).mockResolvedValue({ hasVerificationCommand: false })
      scriptTurns(verificationWriteJson, prose, prose, prose)

      await runAgentOrchestratorLoop({ userTask: 'Create app.js', agentMode: 'agent', workspacePath: tempDir }, null)

      expect(runProjectVerification).not.toHaveBeenCalled()
    })

    it('still completes an ASK-mode turn, where a prose answer is the deliverable', async () => {
      scriptTurns(prose)

      const res = await runAgentOrchestratorLoop(
        { userTask: 'Explain what this project does', agentMode: 'ask', workspacePath: tempDir },
        null
      )

      expect(res.success).toBe(true)
      expect(res.summary).toContain('Everything looks complete')
    })
  })
})
