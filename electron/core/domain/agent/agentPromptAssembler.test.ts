import { describe, it, expect } from 'vitest'
import { assembleTurnPrompt } from './agentPromptAssembler'
import { HardwareProfileResolver } from './hardwareProfileResolver'
import type { AppSettings } from '../../../../shared/types'

describe('AgentPromptAssembler Domain Unit Tests', () => {
  const defaultSettings: AppSettings = {
    defaultModel: 'llama3.2',
    ocrEngine: 'native_cuda',
    capabilityPolicyMode: 'network-approved',
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
  const baseInput = {
    userTask: 'Fix typo in index.html',
    agentMode: 'auto' as const,
    stepCount: 1,
    maxSteps: 50,
    workspacePath: 'D:/project',
    settings: defaultSettings,
    runtimeOpts,
  }

  it('builds the system prompt from the coding guidelines and the workspace', () => {
    const { segments } = assembleTurnPrompt(baseInput)

    expect(segments.baseSystemPrompt).toContain('D:/project')
    expect(segments.baseSystemPrompt).toContain('Operating in AUTO mode')
    expect(segments.baseSystemPrompt).toContain('INCREMENTAL')
    expect(segments.baseSystemPrompt).toContain('PREVIEW')
    expect(segments.baseSystemPrompt).toContain('SCAFFOLD FIRST')
  })

  it('keeps the task and the tool catalogue out of the system prompt', () => {
    // Native requests carry the task once, as the first user message (buildChatRequest), and the
    // tools as the request's `tools` array, so the system prompt stays identical across runs.
    const { segments } = assembleTurnPrompt(baseInput)

    expect(segments.baseSystemPrompt).not.toContain('Fix typo in index.html')
    expect(segments.baseSystemPrompt).not.toContain('AVAILABLE AGENT TOOLS')
  })

  it('includes pinned files and the active file snippet in their own segments', () => {
    const { segments } = assembleTurnPrompt({
      ...baseInput,
      activeFile: { name: 'calc.ts', path: 'D:/project/calc.ts', content: 'export function calculateTotal() {}', versionHash: 'a'.repeat(64) },
      pinnedFilesContextStr: '[EXPLICIT REFERENCED FILE: helper.ts]\n```\nconst tax = 0.22;\n```',
    })

    expect(segments.activeFileBlock).toContain('Active File Open in Editor: calc.ts')
    expect(segments.activeFileBlock).toContain('export function calculateTotal() {}')
    expect(segments.pinnedBlock).toContain('EXPLICIT REFERENCED FILE: helper.ts')
  })

  it('caps the project map block per its own hardware-tiered budget', () => {
    const hugeMap = 'a'.repeat(25000)
    const { segments } = assembleTurnPrompt({ ...baseInput, projectContextMapStr: hugeMap, runtimeOpts: { ...runtimeOpts, maxContextChars: 16000 } })

    const expectedMapChars = Math.floor(16000 * 0.18)
    expect(segments.mapBlock).not.toContain('a'.repeat(expectedMapChars + 1))
    expect(segments.mapBlock).toContain('a'.repeat(expectedMapChars))
  })

  it('carries the step counter only in turnSuffix, rendering ∞ for an unlimited budget', () => {
    const { segments, turnSuffix } = assembleTurnPrompt({ ...baseInput, stepCount: 5 })
    expect(turnSuffix).toBe('CURRENT TURN STATUS: Step 5/50.')
    expect(Object.values(segments).some((segment) => segment.includes('Step 5'))).toBe(false)

    expect(assembleTurnPrompt({ ...baseInput, maxSteps: Infinity }).turnSuffix).toContain('Step 1/∞')
    expect(assembleTurnPrompt({ ...baseInput, maxSteps: 0 }).turnSuffix).toContain('Step 1/∞')
  })

  it('keeps the system prompt byte-identical across turns', () => {
    const turn1 = assembleTurnPrompt({ ...baseInput, stepCount: 1, planBlock: 'PLAN A' })
    const turn2 = assembleTurnPrompt({ ...baseInput, stepCount: 2, planBlock: 'PLAN B' })

    expect(turn1.segments.baseSystemPrompt).toBe(turn2.segments.baseSystemPrompt)
  })

  it('exposes every context block as its own disjoint segment', () => {
    const { segments } = assembleTurnPrompt({
      ...baseInput,
      planBlock: '### STRUCTURED EXECUTION PLAN\nm-1: scaffold',
      skillsBlock: '## CONTEXTUAL SKILLS\ntailwind-css-v4',
      pinnedFilesContextStr: 'pinned.ts contents',
      attachedContext: 'rag docs context',
      projectContextMapStr: 'src/\n  App.tsx',
    })

    expect(segments.planSection).toContain('m-1: scaffold')
    expect(segments.skillsSection).toContain('tailwind-css-v4')
    expect(segments.pinnedBlock).toContain('pinned.ts contents')
    expect(segments.attachedBlock).toContain('rag docs context')
    expect(segments.mapBlock).toContain('App.tsx')
    for (const marker of ['m-1: scaffold', 'tailwind-css-v4', 'pinned.ts contents', 'rag docs context', 'App.tsx']) {
      expect(segments.baseSystemPrompt).not.toContain(marker)
    }
  })
})
