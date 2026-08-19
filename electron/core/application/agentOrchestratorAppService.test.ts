import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { runAgentOrchestratorLoop, cancelActiveAgentTask, respondToApproval } from './agentOrchestratorAppService'
import { ResilientModelDispatcher } from './resilientModelDispatcher'
import { ollamaAppService } from './ollamaAppService'
import { skillAppService } from './skillAppService'
import type { AppSettings } from '../../../src/types'

vi.mock('./resilientModelDispatcher', () => ({
  ResilientModelDispatcher: {
    executeWithFallback: vi.fn(),
    getNextEscalationModel: vi.fn().mockReturnValue(null),
    evictVram: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('./ollamaAppService', () => ({
  ollamaAppService: {
    getInstalledModels: vi.fn().mockResolvedValue(['llama3.2:3b', 'qwen2.5-coder:7b', 'deepseek-r1:8b']),
    getModelCapabilities: vi.fn().mockResolvedValue({}),
    preloadModel: vi.fn().mockResolvedValue({ success: true }),
  },
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

  it('should execute finish tool call and complete session successfully', async () => {
    vi.mocked(ResilientModelDispatcher.executeWithFallback).mockResolvedValueOnce({
      output: '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "All tasks done perfectly." }\n}\n```',
      usedModel: 'llama3.2',
      isFallback: false,
    })

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
  })

  it('should intercept repetitive loop calls and inject intervention directive', async () => {
    // Model repeats the exact same failing command 3 times, then finishes
    const duplicateToolJson = '```json\n{\n  "tool": "run_command",\n  "parameters": { "command": "pytest failing_test.py" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Pivoted and completed." }\n}\n```'

    vi.mocked(ResilientModelDispatcher.executeWithFallback)
      .mockResolvedValueOnce({ output: duplicateToolJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: duplicateToolJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: duplicateToolJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: finishJson, usedModel: 'llama3.2', isFallback: false })

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
    expect(ResilientModelDispatcher.executeWithFallback).toHaveBeenCalledTimes(4)
  })

  it('should offer the configured Deep Reasoning Tier model (not the Standard Tier model) as an escalation candidate when the stagnation circuit breaker trips (regression: deepReasoningModel was wired to the Standard Tier model, so the Deep Reasoning Tier was unreachable via this escalation path)', async () => {
    // Distinct commands each turn (rather than one repeated command) so the loop-detector's
    // exact-duplicate guard doesn't block re-execution and mask the circuit breaker's own
    // repeated-failure counter (each command still fails: "pytest" isn't on PATH in the test env).
    const failingCommandJson = (n: number) =>
      `\`\`\`json\n{\n  "tool": "run_command",\n  "parameters": { "command": "pytest failing_test_${n}.py" }\n}\n\`\`\``
    vi.mocked(ResilientModelDispatcher.executeWithFallback)
      .mockResolvedValueOnce({ output: failingCommandJson(1), usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: failingCommandJson(2), usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: failingCommandJson(3), usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: failingCommandJson(4), usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: failingCommandJson(5), usedModel: 'llama3.2', isFallback: false })

    const settings: AppSettings = {
      defaultModel: 'llama3.2',
      hardwareProfile: 'Auto',
      ocrEngine: 'native_cuda',
      ollamaHost: '',
      codingModel: 'qwen2.5-coder:7b',
      translationModel: 'llama3.2',
      visionModel: 'llama3.2-vision',
      embeddingModel: 'nomic-embed-text',
      complexityFastModel: 'llama3.2:3b',
      complexityStandardModel: 'qwen2.5-coder:7b',
      complexityDeepModel: 'deepseek-r1:14b',
      useComplexityRouting: true,
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

    expect(ResilientModelDispatcher.executeWithFallback).toHaveBeenCalledTimes(5)
    expect(ResilientModelDispatcher.getNextEscalationModel).toHaveBeenCalled()
    const escalationArgs = vi.mocked(ResilientModelDispatcher.getNextEscalationModel).mock.calls[0][1]
    expect(escalationArgs.deepReasoningModel).toBe('deepseek-r1:14b')
    expect(escalationArgs.deepReasoningModel).not.toBe(escalationArgs.standardModel)
    expect(res.success).toBe(true)
  })

  it('should execute in plan mode and complete with step proposal without mutating files', async () => {
    const proposedActionJson = '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "index.ts", "content": "console.log(1)" }\n}\n```'
    vi.mocked(ResilientModelDispatcher.executeWithFallback).mockResolvedValueOnce({
      output: proposedActionJson,
      usedModel: 'llama3.2',
      isFallback: false,
    })

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
    // Workspace must not have index.ts created in plan mode
    expect(fs.existsSync(path.join(tempDir, 'index.ts'))).toBe(false)
  })

  it('should persist a plan initialized during a PLAN-mode step before the step returns (regression: plan was lost because it was only ever persisted at the top of the NEXT step)', async () => {
    const planWithChecklistJson =
      '- [ ] Design database schema\n- [ ] Implement API endpoints\n\n' +
      '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "index.ts", "content": "console.log(1)" }\n}\n```'
    vi.mocked(ResilientModelDispatcher.executeWithFallback).mockResolvedValueOnce({
      output: planWithChecklistJson,
      usedModel: 'llama3.2',
      isFallback: false,
    })

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

  it('should hot-swap from plan to agent mode smoothly on consecutive turns', async () => {
    // Turn 1: Plan Mode
    const planJson = '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "app.ts", "content": "export const a = 1;" }\n}\n```'
    vi.mocked(ResilientModelDispatcher.executeWithFallback).mockResolvedValueOnce({
      output: planJson,
      usedModel: 'llama3.2',
      isFallback: false,
    })

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

    // Turn 2: Hot-swapped to Agent Mode (executes and finishes)
    const agentFinishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Code executed and verified." }\n}\n```'
    vi.mocked(ResilientModelDispatcher.executeWithFallback).mockResolvedValueOnce({
      output: agentFinishJson,
      usedModel: 'llama3.2',
      isFallback: false,
    })

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

  it('should pause for human approval in ASK mode, then resume and execute the tool once approved (regression: the FSM permission gate previously ran before the approval check, silently breaking the ASK-mode approval flow promised by promptPresets.ts and the PendingApprovalModal UI; and approval used to end the session instead of resuming it, so an approved write never actually ran)', async () => {
    const writeFileJson = '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "index.ts", "content": "console.log(1)" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Write approved and applied." }\n}\n```'
    vi.mocked(ResilientModelDispatcher.executeWithFallback)
      .mockResolvedValueOnce({ output: writeFileJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: finishJson, usedModel: 'llama3.2', isFallback: false })

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
    // The pause is real, not a same-tick formality: nothing happens before the response arrives.
    expect(fs.existsSync(path.join(tempDir, 'index.ts'))).toBe(false)

    expect(respondToApproval(sessionId, true)).toBe(true)

    const res = await resultPromise
    expect(res.success).toBe(true)
    expect(res.summary).toBe('Write approved and applied.')
    expect(res.summary).not.toContain('FSM PERMISSION DENIED')
    // Executed through the same tool executor path AGENT mode uses, not a renderer-side re-implementation.
    expect(fs.existsSync(path.join(tempDir, 'index.ts'))).toBe(true)
  })

  it('should apply only the approved hunks when the user partially approves a write_file proposal (per-hunk approval)', async () => {
    const filePath = path.join(tempDir, 'partial.ts')
    fs.writeFileSync(filePath, 'line1\nline2\nline3\nline4\nline5', 'utf-8')

    const writeFileJson = '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "partial.ts", "content": "line1\\nCHANGED2\\nline3\\nline4\\nCHANGED5" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Partial approval applied." }\n}\n```'
    vi.mocked(ResilientModelDispatcher.executeWithFallback)
      .mockResolvedValueOnce({ output: writeFileJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: finishJson, usedModel: 'llama3.2', isFallback: false })

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

    // Approve only the first of the two independent hunks (line2 -> CHANGED2).
    expect(respondToApproval(sessionId, true, [0])).toBe(true)

    const res = await resultPromise
    expect(res.success).toBe(true)
    // The second hunk (line5 -> CHANGED5) must NOT have been applied.
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('line1\nCHANGED2\nline3\nline4\nline5')
  })

  it('should feed a denial back to the model and keep the loop running (not stuck) when the user rejects an approval', async () => {
    const writeFileJson = '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "index.ts", "content": "console.log(1)" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Acknowledged the denial." }\n}\n```'
    vi.mocked(ResilientModelDispatcher.executeWithFallback)
      .mockResolvedValueOnce({ output: writeFileJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: finishJson, usedModel: 'llama3.2', isFallback: false })

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

  it('should still allow finish (a non-mutating tool) in ASK mode without triggering the approval flow', async () => {
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Inspection complete." }\n}\n```'
    vi.mocked(ResilientModelDispatcher.executeWithFallback).mockResolvedValueOnce({
      output: finishJson,
      usedModel: 'llama3.2',
      isFallback: false,
    })

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

  it('should always pause for human approval on git_commit, even in AGENT mode (unlike other mutating tools which execute autonomously there), then resume once approved', async () => {
    const commitJson = '```json\n{\n  "tool": "git_commit",\n  "parameters": { "commitMessage": "Add feature X" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Commit step handled." }\n}\n```'
    vi.mocked(ResilientModelDispatcher.executeWithFallback)
      .mockResolvedValueOnce({ output: commitJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: finishJson, usedModel: 'llama3.2', isFallback: false })

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
    vi.mocked(ResilientModelDispatcher.executeWithFallback).mockResolvedValueOnce({
      output: writeFileJson,
      usedModel: 'llama3.2',
      isFallback: false,
    })

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

    // The Promise the loop was paused on must have been resolved by the cancellation, not left
    // dangling: the awaited call below must settle instead of timing out the test.
    await resultPromise
    expect(fs.existsSync(path.join(tempDir, 'index.ts'))).toBe(false)
    // A response arriving after cancellation is stale: nothing is left registered to answer it.
    expect(respondToApproval(sessionId, true)).toBe(false)
  })

  it('should let the model advance the plan explicitly through the update_plan tool', async () => {
    const planJson =
      '<plan>\n- [ ] Scaffold project\n- [ ] Add tests\n</plan>\n\n```json\n{\n  "tool": "list_dir",\n  "parameters": { "dirPath": "." }\n}\n```'
    const updateJson =
      '```json\n{\n  "tool": "update_plan",\n  "parameters": { "milestoneId": "m-1", "status": "verified" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Plan advanced." }\n}\n```'

    vi.mocked(ResilientModelDispatcher.executeWithFallback)
      .mockResolvedValueOnce({ output: planJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: updateJson, usedModel: 'llama3.2', isFallback: false })
      // Two finish attempts: the first is intercepted once by the DoD guard because a
      // milestone is still unverified, which is exactly the intended behaviour.
      .mockResolvedValueOnce({ output: finishJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: finishJson, usedModel: 'llama3.2', isFallback: false })

    const res = await runAgentOrchestratorLoop(
      { userTask: 'Build the app', agentMode: 'agent', workspacePath: tempDir, sessionId: 'plan-tool-session' },
      null
    )

    expect(res.success).toBe(true)
    // The update must be reflected in the persisted plan state the UI reads back.
    const statePath = path.join(tempDir, '.onlyrag', 'sessions', '.agent_state_plan-tool-session.json')
    const saved = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
    const verified = saved.planMilestones.filter((m: any) => m.status === 'verified')
    expect(verified.length).toBe(1)
    expect(verified[0].id).toBe('m-1')
  })

  it('should only mark a milestone verified when its verificationCommand actually exits 0, not on the model\'s say-so', async () => {
    const planJson =
      '<plan>[{"id":"m-1","title":"Scaffold project","verificationCommand":"node -e \\"process.exit(0)\\""},{"id":"m-2","title":"Add tests"}]</plan>\n\n```json\n{\n  "tool": "list_dir",\n  "parameters": { "dirPath": "." }\n}\n```'
    const updateJson =
      '```json\n{\n  "tool": "update_plan",\n  "parameters": { "milestoneId": "m-1", "status": "verified" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Plan advanced." }\n}\n```'

    vi.mocked(ResilientModelDispatcher.executeWithFallback)
      .mockResolvedValueOnce({ output: planJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: updateJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: finishJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: finishJson, usedModel: 'llama3.2', isFallback: false })

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

  it('should set the milestone to failed (not verified) when the model claims verified but its verificationCommand actually fails', async () => {
    const planJson =
      '<plan>[{"id":"m-1","title":"Scaffold project","verificationCommand":"node -e \\"process.exit(1)\\""},{"id":"m-2","title":"Add tests"}]</plan>\n\n```json\n{\n  "tool": "list_dir",\n  "parameters": { "dirPath": "." }\n}\n```'
    const updateJson =
      '```json\n{\n  "tool": "update_plan",\n  "parameters": { "milestoneId": "m-1", "status": "verified" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Done." }\n}\n```'

    vi.mocked(ResilientModelDispatcher.executeWithFallback)
      .mockResolvedValueOnce({ output: planJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: updateJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: finishJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: finishJson, usedModel: 'llama3.2', isFallback: false })

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

  it('should keep num_ctx frozen across turns instead of resizing it per prompt (regression: a per-step num_ctx made Ollama reallocate its KV cache every turn, evicting the prompt cache the context-reuse path depends on)', async () => {
    const listJson = '```json\n{\n  "tool": "list_dir",\n  "parameters": { "dirPath": "." }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Listed." }\n}\n```'

    vi.mocked(ResilientModelDispatcher.executeWithFallback)
      .mockResolvedValueOnce({ output: listJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: listJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: finishJson, usedModel: 'llama3.2', isFallback: false })

    await runAgentOrchestratorLoop(
      { userTask: 'List the workspace', agentMode: 'agent', workspacePath: tempDir },
      null
    )

    const ctxPerTurn = vi
      .mocked(ResilientModelDispatcher.executeWithFallback)
      .mock.calls.map((call) => (call[0] as any).runtimeOpts.num_ctx as number)

    expect(ctxPerTurn.length).toBeGreaterThanOrEqual(2)
    // The prompt grows every turn (history accumulates), yet the window must not shrink
    // back or oscillate: it stays put, and may only ever step upward.
    for (let i = 1; i < ctxPerTurn.length; i++) {
      expect(ctxPerTurn[i]).toBeGreaterThanOrEqual(ctxPerTurn[i - 1])
    }
    expect(new Set(ctxPerTurn).size).toBe(1)
  })

  it('should disarm the session watchdog when the loop exits early, so it can never terminate a later run that reuses the same sessionId (regression: clearSessionTimeout ran only on the natural loop exit, leaving a 45-minute timer armed on every finish/ask/cancel path)', async () => {
    vi.useFakeTimers()
    try {
      const sent: Array<{ channel: string; payload: any }> = []
      const fakeWin: any = {
        isDestroyed: () => false,
        webContents: { send: (channel: string, payload: any) => sent.push({ channel, payload }) },
      }

      vi.mocked(ResilientModelDispatcher.executeWithFallback).mockResolvedValueOnce({
        output: '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Quick exit." }\n}\n```',
        usedModel: 'llama3.2',
        isFallback: false,
      })

      const res = await runAgentOrchestratorLoop(
        { userTask: 'Do nothing', agentMode: 'agent', workspacePath: tempDir, sessionId: 'reused-session-id' },
        fakeWin
      )
      expect(res.success).toBe(true)

      const doneCountAfterRun = sent.filter((m) => m.channel === 'agent:done').length
      // Well past the 45-minute watchdog: a leaked timer would emit a second agent:done here.
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

      expect(sent.filter((m) => m.channel === 'agent:done').length).toBe(doneCountAfterRun)
      expect(sent.some((m) => JSON.stringify(m.payload).includes('Sessione terminata automaticamente'))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('should intercept finish with the DoD guard after unverified file mutations, then allow it on the next attempt (regression: the DoD gate sat after the finish branch, which returns, so validateTaskCompletion was unreachable dead code)', async () => {
    const writeJson =
      '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "app.js", "content": "console.log(1)" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Done." }\n}\n```'

    vi.mocked(ResilientModelDispatcher.executeWithFallback)
      .mockResolvedValueOnce({ output: writeJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: finishJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: finishJson, usedModel: 'llama3.2', isFallback: false })

    const res = await runAgentOrchestratorLoop(
      {
        userTask: 'Create app.js',
        agentMode: 'agent',
        workspacePath: tempDir,
      },
      null
    )

    // The first finish is intercepted (no verification command was ever run), so the loop
    // must consume a third turn before completing — proving the guard actually executed.
    expect(ResilientModelDispatcher.executeWithFallback).toHaveBeenCalledTimes(3)
    expect(res.success).toBe(true)
    expect(res.summary).toBe('Done.')
  })

  it('should not intercept finish a second time for the same DoD reason, so the session can never deadlock on an unverifiable milestone', async () => {
    const writeJson =
      '```json\n{\n  "tool": "write_file",\n  "parameters": { "filePath": "b.js", "content": "console.log(2)" }\n}\n```'
    const finishJson = '```json\n{\n  "tool": "finish",\n  "parameters": { "summary": "Second attempt." }\n}\n```'

    vi.mocked(ResilientModelDispatcher.executeWithFallback)
      .mockResolvedValueOnce({ output: writeJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: finishJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: finishJson, usedModel: 'llama3.2', isFallback: false })
      .mockResolvedValueOnce({ output: finishJson, usedModel: 'llama3.2', isFallback: false })

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
    // Exactly one interception: turn 1 write, turn 2 blocked finish, turn 3 accepted finish.
    expect(ResilientModelDispatcher.executeWithFallback).toHaveBeenCalledTimes(3)
  })
})
