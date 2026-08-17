import { describe, it, expect } from 'vitest'
import { resolveOllamaContextReuse, type OllamaContextBaseline } from './ollamaContextCacheManager'

describe('resolveOllamaContextReuse (AGT1: Ollama context/KV-cache reuse gating)', () => {
  const baseline: OllamaContextBaseline = {
    model: 'qwen2.5-coder:7b',
    stableSection: 'STABLE SYSTEM PROMPT + BACKGROUND',
    historyBlock: '\nSTEP 1 HISTORY\n',
    contextTokens: [1, 2, 3, 4],
  }

  it('should send only the full prompt with no baseline available (first turn of a session)', () => {
    const decision = resolveOllamaContextReuse({
      targetModel: 'qwen2.5-coder:7b',
      stableSection: 'STABLE SYSTEM PROMPT + BACKGROUND',
      historyBlock: '',
      turnSuffix: 'CURRENT TURN STATUS: Step 1/50.',
      fullPrompt: 'STABLE SYSTEM PROMPT + BACKGROUND\n\nCURRENT TURN STATUS: Step 1/50.',
      wasCompacted: false,
      baseline: null,
    })

    expect(decision.reusedContext).toBe(false)
    expect(decision.contextTokens).toBeUndefined()
    expect(decision.promptToSend).toContain('STABLE SYSTEM PROMPT')
  })

  it('should reuse context and send only the history delta + turn suffix when the stable section and model are unchanged and history is a strict append', () => {
    const decision = resolveOllamaContextReuse({
      targetModel: 'qwen2.5-coder:7b',
      stableSection: 'STABLE SYSTEM PROMPT + BACKGROUND',
      historyBlock: '\nSTEP 1 HISTORY\nSTEP 2 HISTORY\n',
      turnSuffix: 'CURRENT TURN STATUS: Step 2/50.',
      fullPrompt: 'STABLE SYSTEM PROMPT + BACKGROUND\n\n\nSTEP 1 HISTORY\nSTEP 2 HISTORY\n\n\nCURRENT TURN STATUS: Step 2/50.',
      wasCompacted: false,
      baseline,
    })

    expect(decision.reusedContext).toBe(true)
    expect(decision.contextTokens).toEqual([1, 2, 3, 4])
    expect(decision.promptToSend).not.toContain('STABLE SYSTEM PROMPT')
    expect(decision.promptToSend).not.toContain('STEP 1 HISTORY')
    expect(decision.promptToSend).toContain('STEP 2 HISTORY')
    expect(decision.promptToSend).toContain('Step 2/50')
  })

  it('should fall back to full resend when the target model differs from the baseline model (fallback/escalation/complexity re-routing)', () => {
    const decision = resolveOllamaContextReuse({
      targetModel: 'llama3.2:3b',
      stableSection: baseline.stableSection,
      historyBlock: baseline.historyBlock + 'STEP 2 HISTORY\n',
      turnSuffix: 'CURRENT TURN STATUS: Step 2/50.',
      fullPrompt: 'FULL PROMPT FOR LLAMA',
      wasCompacted: false,
      baseline,
    })

    expect(decision.reusedContext).toBe(false)
    expect(decision.promptToSend).toBe('FULL PROMPT FOR LLAMA')
  })

  it('should fall back to full resend when the stable section changed (e.g. pinned files, plan, or complexity tier changed)', () => {
    const decision = resolveOllamaContextReuse({
      targetModel: baseline.model,
      stableSection: 'STABLE SYSTEM PROMPT + BACKGROUND (pinned file added)',
      historyBlock: baseline.historyBlock + 'STEP 2 HISTORY\n',
      turnSuffix: 'CURRENT TURN STATUS: Step 2/50.',
      fullPrompt: 'FULL PROMPT WITH NEW PINNED FILE',
      wasCompacted: false,
      baseline,
    })

    expect(decision.reusedContext).toBe(false)
    expect(decision.promptToSend).toBe('FULL PROMPT WITH NEW PINNED FILE')
  })

  it('should fall back to full resend when history is not a strict append (compaction dropped or reordered earlier entries)', () => {
    const decision = resolveOllamaContextReuse({
      targetModel: baseline.model,
      stableSection: baseline.stableSection,
      historyBlock: '\nSTEP 2 HISTORY ONLY (STEP 1 DROPPED)\n',
      turnSuffix: 'CURRENT TURN STATUS: Step 2/50.',
      fullPrompt: 'FULL PROMPT AFTER HISTORY REWRITE',
      wasCompacted: false,
      baseline,
    })

    expect(decision.reusedContext).toBe(false)
    expect(decision.promptToSend).toBe('FULL PROMPT AFTER HISTORY REWRITE')
  })

  it('should fall back to full resend whenever HeuristicContextCompactor rewrote the prompt this turn, even if model/stableSection/history would otherwise match', () => {
    const decision = resolveOllamaContextReuse({
      targetModel: baseline.model,
      stableSection: baseline.stableSection,
      historyBlock: baseline.historyBlock + 'STEP 2 HISTORY\n',
      turnSuffix: 'CURRENT TURN STATUS: Step 2/50.',
      fullPrompt: 'COMPACTED FULL PROMPT',
      wasCompacted: true,
      baseline,
    })

    expect(decision.reusedContext).toBe(false)
    expect(decision.promptToSend).toBe('COMPACTED FULL PROMPT')
  })
})
