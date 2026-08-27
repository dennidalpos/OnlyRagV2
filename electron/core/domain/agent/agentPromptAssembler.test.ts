import { describe, it, expect } from 'vitest'
import { assembleTurnPrompt } from './agentPromptAssembler'
import { HardwareProfileResolver } from './hardwareProfileResolver'
import type { AppSettings } from '../../../../src/types'

describe('AgentPromptAssembler Domain Unit Tests', () => {
  const defaultSettings: AppSettings = {
    defaultModel: 'llama3.2',
    ocrEngine: 'native_cuda',
    ollamaHost: '',
    codingModel: 'llama3.2',
    translationModel: 'llama3.2',
    visionModel: 'llama3.2-vision',
    embeddingModel: 'nomic-embed-text',
    allowTerminalExecution: true,
    allowFileModifications: true,
    customPromptOverrides: {},
  }

  const runtimeOpts = HardwareProfileResolver.resolveOllamaOptions('Medium')

  it('should assemble turn prompt with base guidelines and user task', () => {
    const { prompt } = assembleTurnPrompt({
      userTask: 'Fix typo in index.html',
      agentMode: 'agent',
      stepCount: 1,
      maxSteps: 50,
      workspacePath: 'D:/project',
      toolOutputHistory: [],
      settings: defaultSettings,
      runtimeOpts,
    })

    expect(prompt).toContain('Fix typo in index.html')
    expect(prompt).toContain('D:/project')
    expect(prompt).toContain('AGENT')
    expect(prompt).toContain('INCREMENTAL')
    expect(prompt).toContain('PREVIEW')
    expect(prompt).toContain('SCAFFOLD FIRST')
  })

  it('should include pinned files and active file snippet when provided', () => {
    const { prompt } = assembleTurnPrompt({
      userTask: 'Refactor calculateTotal',
      agentMode: 'agent',
      stepCount: 2,
      maxSteps: 50,
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
    // Here only the per-segment maxMapChars budget applies: a share (18%) of maxContextChars,
    // so the background context scales with the window instead of a fixed step threshold.
    const hugeMap = 'a'.repeat(25000)
    const { prompt } = assembleTurnPrompt({
      userTask: 'Optimize database queries',
      agentMode: 'agent',
      stepCount: 3,
      maxSteps: 50,
      workspacePath: 'D:/project',
      projectContextMapStr: hugeMap,
      toolOutputHistory: [],
      settings: defaultSettings,
      runtimeOpts: { ...runtimeOpts, maxContextChars: 16000 },
    })

    const expectedMapChars = Math.floor(16000 * 0.18)
    expect(prompt).not.toContain('a'.repeat(expectedMapChars + 1))
    expect(prompt).toContain('a'.repeat(expectedMapChars))
  })

  it('should omit the prose tool schema block when toolCallingCapable=true (AGT2: native tool-calling models already receive it via the `tools` API param)', () => {
    const withProse = assembleTurnPrompt({
      userTask: 'Fix typo in index.html',
      agentMode: 'agent',
      stepCount: 1,
      maxSteps: 50,
      workspacePath: 'D:/project',
      toolOutputHistory: [],
      settings: defaultSettings,
      runtimeOpts,
    })
    const nativeToolCalling = assembleTurnPrompt({
      userTask: 'Fix typo in index.html',
      agentMode: 'agent',
      stepCount: 1,
      maxSteps: 50,
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
    const { prompt } = assembleTurnPrompt({
      userTask: 'Long running task',
      agentMode: 'agent',
      stepCount: 1,
      maxSteps: Infinity,
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
      workspacePath: 'D:/project',
      settings: defaultSettings,
      runtimeOpts,
    }

    it('should keep stableSection byte-identical across turns when only stepCount and history change', () => {
      const turn1 = assembleTurnPrompt({ ...baseInput, stepCount: 1, toolOutputHistory: [] })
      const turn2 = assembleTurnPrompt({ ...baseInput, stepCount: 2, toolOutputHistory: ['Ran command: THIS_IS_TURN_2_HISTORY_MARKER'] })

      expect(turn1.stableSection).toBe(turn2.stableSection)
      expect(turn1.stableSection).not.toContain('Step 1')
      expect(turn1.stableSection).not.toContain('THIS_IS_TURN_2_HISTORY_MARKER')
    })

    it('should change stableSection when pinned files or task prompt change', () => {
      const standard = assembleTurnPrompt({ ...baseInput, stepCount: 1, toolOutputHistory: [] })
      const differentTask = assembleTurnPrompt({ ...baseInput, userTask: 'Different task requirement', stepCount: 1, toolOutputHistory: [] })
      const withPinned = assembleTurnPrompt({
        ...baseInput,
        stepCount: 1,
        toolOutputHistory: [],
        pinnedFilesContextStr: '[EXPLICIT REFERENCED FILE: helper.ts]',
      })

      expect(standard.stableSection).not.toBe(differentTask.stableSection)
      expect(standard.stableSection).not.toBe(withPinned.stableSection)
    })

    it('should produce an append-only historyBlock: turn 2 history starts with turn 1 history when steps are only added', () => {
      const turn1 = assembleTurnPrompt({ ...baseInput, stepCount: 1, toolOutputHistory: 'STEP 1 SUMMARY' })
      const turn2 = assembleTurnPrompt({ ...baseInput, stepCount: 2, toolOutputHistory: 'STEP 1 SUMMARY\n\nSTEP 2 SUMMARY' })

      expect(turn2.historyBlock.startsWith(turn1.historyBlock)).toBe(true)
    })

    it('should carry the step counter only in turnSuffix, not in stableSection or historyBlock', () => {
      const { stableSection, historyBlock, turnSuffix } = assembleTurnPrompt({
        ...baseInput,
        stepCount: 5,
        toolOutputHistory: [],
      })

      expect(turnSuffix).toContain('Step 5/50')
      expect(stableSection).not.toContain('Step 5')
      expect(historyBlock).not.toContain('Step 5')
    })

    it('should reassemble to the same full prompt from stableSection + historyBlock + turnSuffix', () => {
      const { prompt, stableSection, historyBlock, turnSuffix } = assembleTurnPrompt({
        ...baseInput,
        stepCount: 1,
        toolOutputHistory: 'STEP 1 SUMMARY',
      })

      const reassembled = [stableSection, historyBlock, turnSuffix].filter((p) => p && p.trim()).join('\n\n')
      expect(reassembled).toBe(prompt)
    })
  })

  describe('segments (compactor input contract)', () => {
    it('exposes stableSection as DISJOINT segments that rejoin to exactly stableSection', () => {
      // The orchestrator must feed HeuristicContextCompactor these segments, never stableSection
      // itself. Passing the joined section as `systemPrompt` while ALSO passing its own parts
      // counted every byte twice: the compactor saw ~40k for a ~27k prompt, tripped its watermark
      // on prompts that fit, and drove its budget negative — wiping the tool history so every
      // turn's prompt was byte-identical and the model looped on its first tool call forever.
      const { stableSection, segments } = assembleTurnPrompt({
        userTask: 'Build a dashboard',
        agentMode: 'agent',
        stepCount: 3,
        maxSteps: 50,
        workspacePath: 'D:/project',
        planBlock: '### STRUCTURED EXECUTION PLAN\nm-1: scaffold',
        skillsBlock: '## CONTEXTUAL SKILLS\ntailwind-css-v4',
        pinnedFilesContextStr: 'pinned.ts contents',
        attachedContext: 'rag docs context',
        projectContextMapStr: 'src/\n  App.tsx',
        toolOutputHistory: 'HISTORY BLOCK',
        settings: defaultSettings,
        runtimeOpts,
      })

      const rejoined = [
        segments.baseSystemPrompt,
        segments.planSection,
        segments.pinnedBlock,
        segments.activeFileBlock,
        segments.skillsSection,
        segments.attachedBlock,
        segments.mapBlock,
      ]
        .filter((p) => p && p.trim())
        .join('\n\n')

      expect(rejoined).toBe(stableSection)
      // and no segment may itself contain the whole joined section (the double-count signature)
      expect(segments.baseSystemPrompt).not.toBe(stableSection)
      expect(segments.baseSystemPrompt.length).toBeLessThan(stableSection.length)
    })
  })
})
