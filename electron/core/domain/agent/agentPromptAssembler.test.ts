import { describe, it, expect } from 'vitest'
import { AgentPromptAssembler } from './agentPromptAssembler'
import { HardwareProfileResolver } from './hardwareProfileResolver'
import type { AppSettings } from '../../../../src/types'

describe('AgentPromptAssembler Domain Unit Tests', () => {
  const defaultSettings: AppSettings = {
    defaultModel: 'llama3.2',
    hardwareProfile: 'Medium',
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

  const runtimeOpts = HardwareProfileResolver.resolveOllamaOptions('Medium')

  it('should assemble turn prompt with base guidelines and user task', () => {
    const { prompt } = AgentPromptAssembler.assembleTurnPrompt({
      userTask: 'Fix typo in index.html',
      agentMode: 'agent',
      stepCount: 1,
      maxSteps: 50,
      complexityTier: 'standard',
      workspacePath: 'D:/project',
      toolOutputHistory: [],
      settings: defaultSettings,
      runtimeOpts,
    })

    expect(prompt).toContain('Fix typo in index.html')
    expect(prompt).toContain('D:/project')
    expect(prompt).toContain('AGENT')
  })

  it('should include pinned files and active file snippet when provided', () => {
    const { prompt } = AgentPromptAssembler.assembleTurnPrompt({
      userTask: 'Refactor calculateTotal',
      agentMode: 'agent',
      stepCount: 2,
      maxSteps: 50,
      complexityTier: 'standard',
      workspacePath: 'D:/project',
      activeFile: { name: 'calc.ts', path: 'D:/project/calc.ts', content: 'export function calculateTotal() {}' },
      pinnedFilesContextStr: '[EXPLICIT REFERENCED FILE: helper.ts]\n```\nconst tax = 0.22;\n```',
      toolOutputHistory: ['Ran command: npm test'],
      settings: defaultSettings,
      runtimeOpts,
    })

    expect(prompt).toContain('Active File Open in Editor: calc.ts')
    expect(prompt).toContain('export function calculateTotal() {}')
    expect(prompt).toContain('EXPLICIT REFERENCED FILE: helper.ts')
    expect(prompt).toContain('PREVIOUS COMPLETED TOOL STEPS & RESULTS')
    expect(prompt).toContain('Ran command: npm test')
  })

  it('should cap the project map block per its own hardware-tiered budget, without applying a second full-prompt truncation pass', () => {
    // AgentPromptAssembler no longer re-truncates the assembled prompt against
    // maxContextChars — that watermark-based compaction is HeuristicContextCompactor's
    // sole responsibility in the orchestrator loop (see agentOrchestratorAppService.ts).
    // Here only the per-segment maxMapChars budget (4000 for maxContextChars<=16000) applies.
    const hugeMap = 'a'.repeat(25000)
    const { prompt } = AgentPromptAssembler.assembleTurnPrompt({
      userTask: 'Optimize database queries',
      agentMode: 'agent',
      stepCount: 3,
      maxSteps: 50,
      complexityTier: 'deep_reasoning',
      workspacePath: 'D:/project',
      projectContextMapStr: hugeMap,
      toolOutputHistory: [],
      settings: defaultSettings,
      runtimeOpts: { ...runtimeOpts, maxContextChars: 16000 },
    })

    expect(prompt).not.toContain('a'.repeat(4001))
    expect(prompt).toContain('a'.repeat(4000))
  })

  it('should omit the prose tool schema block when toolCallingCapable=true (AGT2: native tool-calling models already receive it via the `tools` API param)', () => {
    const withProse = AgentPromptAssembler.assembleTurnPrompt({
      userTask: 'Fix typo in index.html',
      agentMode: 'agent',
      stepCount: 1,
      maxSteps: 50,
      complexityTier: 'standard',
      workspacePath: 'D:/project',
      toolOutputHistory: [],
      settings: defaultSettings,
      runtimeOpts,
    })
    const nativeToolCalling = AgentPromptAssembler.assembleTurnPrompt({
      userTask: 'Fix typo in index.html',
      agentMode: 'agent',
      stepCount: 1,
      maxSteps: 50,
      complexityTier: 'standard',
      workspacePath: 'D:/project',
      toolOutputHistory: [],
      settings: defaultSettings,
      runtimeOpts,
      toolCallingCapable: true,
    })

    expect(withProse.prompt).toContain('AVAILABLE AGENT TOOLS')
    expect(nativeToolCalling.prompt).not.toContain('AVAILABLE AGENT TOOLS')
    expect(nativeToolCalling.prompt).toContain('Fix typo in index.html')
  })

  it('should render ∞ when maxSteps is Infinity or 0', () => {
    const { prompt } = AgentPromptAssembler.assembleTurnPrompt({
      userTask: 'Long running task',
      agentMode: 'agent',
      stepCount: 1,
      maxSteps: Infinity,
      complexityTier: 'standard',
      workspacePath: 'D:/project',
      toolOutputHistory: [],
      settings: defaultSettings,
      runtimeOpts,
    })

    expect(prompt).toContain('Step 1/∞')
  })

  describe('stableSection / historyBlock / turnSuffix decomposition (AGT1: Ollama context/KV-cache reuse)', () => {
    const baseInput = {
      userTask: 'Fix typo in index.html',
      agentMode: 'agent' as const,
      maxSteps: 50,
      complexityTier: 'standard' as const,
      workspacePath: 'D:/project',
      settings: defaultSettings,
      runtimeOpts,
    }

    it('should keep stableSection byte-identical across turns when only stepCount and history change', () => {
      const turn1 = AgentPromptAssembler.assembleTurnPrompt({ ...baseInput, stepCount: 1, toolOutputHistory: [] })
      const turn2 = AgentPromptAssembler.assembleTurnPrompt({ ...baseInput, stepCount: 2, toolOutputHistory: ['Ran command: THIS_IS_TURN_2_HISTORY_MARKER'] })

      expect(turn1.stableSection).toBe(turn2.stableSection)
      expect(turn1.stableSection).not.toContain('Step 1')
      expect(turn1.stableSection).not.toContain('THIS_IS_TURN_2_HISTORY_MARKER')
    })

    it('should change stableSection when the complexity tier or pinned files change', () => {
      const standard = AgentPromptAssembler.assembleTurnPrompt({ ...baseInput, stepCount: 1, toolOutputHistory: [] })
      const deep = AgentPromptAssembler.assembleTurnPrompt({ ...baseInput, complexityTier: 'deep_reasoning', stepCount: 1, toolOutputHistory: [] })
      const withPinned = AgentPromptAssembler.assembleTurnPrompt({
        ...baseInput,
        stepCount: 1,
        toolOutputHistory: [],
        pinnedFilesContextStr: '[EXPLICIT REFERENCED FILE: helper.ts]',
      })

      expect(standard.stableSection).not.toBe(deep.stableSection)
      expect(standard.stableSection).not.toBe(withPinned.stableSection)
    })

    it('should produce an append-only historyBlock: turn 2 history starts with turn 1 history when steps are only added', () => {
      const turn1 = AgentPromptAssembler.assembleTurnPrompt({ ...baseInput, stepCount: 1, toolOutputHistory: 'STEP 1 SUMMARY' })
      const turn2 = AgentPromptAssembler.assembleTurnPrompt({ ...baseInput, stepCount: 2, toolOutputHistory: 'STEP 1 SUMMARY\n\nSTEP 2 SUMMARY' })

      expect(turn2.historyBlock.startsWith(turn1.historyBlock)).toBe(true)
    })

    it('should carry the step counter only in turnSuffix, not in stableSection or historyBlock', () => {
      const { stableSection, historyBlock, turnSuffix } = AgentPromptAssembler.assembleTurnPrompt({
        ...baseInput,
        stepCount: 5,
        toolOutputHistory: [],
      })

      expect(turnSuffix).toContain('Step 5/50')
      expect(stableSection).not.toContain('Step 5')
      expect(historyBlock).not.toContain('Step 5')
    })

    it('should reassemble to the same full prompt from stableSection + historyBlock + turnSuffix', () => {
      const { prompt, stableSection, historyBlock, turnSuffix } = AgentPromptAssembler.assembleTurnPrompt({
        ...baseInput,
        stepCount: 1,
        toolOutputHistory: 'STEP 1 SUMMARY',
      })

      const reassembled = [stableSection, historyBlock, turnSuffix].filter((p) => p && p.trim()).join('\n\n')
      expect(reassembled).toBe(prompt)
    })
  })
})
