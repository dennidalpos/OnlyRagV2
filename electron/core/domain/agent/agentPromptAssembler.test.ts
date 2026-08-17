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
    const prompt = AgentPromptAssembler.assembleTurnPrompt({
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
    const prompt = AgentPromptAssembler.assembleTurnPrompt({
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
    const prompt = AgentPromptAssembler.assembleTurnPrompt({
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

  it('should render ∞ when maxSteps is Infinity or 0', () => {
    const prompt = AgentPromptAssembler.assembleTurnPrompt({
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
})
