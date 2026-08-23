import { describe, it, expect } from 'vitest'
import { resolveChatContextBudget, resolveChatThreadCount, resolvePromptCharBudget } from './chatContextBudget'
import { calculateDynamicContextWindow } from '../../electron/core/domain/agent/contextWindowCalculator'

describe('chatContextBudget', () => {
  const MINIMAL_HOST = { hasGpu: false, vramTotalMB: 0, systemRamGB: 8, cpuCount: 4 }
  const CPU_WORKSTATION = { hasGpu: false, vramTotalMB: 0, systemRamGB: 64, cpuCount: 32 }
  const MIDRANGE_HOST = { hasGpu: true, vramTotalMB: 8192, systemRamGB: 16, cpuCount: 16 }
  const EXTREME_HOST = { hasGpu: true, vramTotalMB: 24576, systemRamGB: 64, cpuCount: 32 }

  it('should preserve the previous one-size-fits-all budget on mainstream 8GB-GPU hosts', () => {
    // The old hardcoded constants (4000 / 5500 / 1500 chars, last 6 turns) are the midrange
    // row, so this refactor only moves the extremes.
    const budget = resolveChatContextBudget(MIDRANGE_HOST)
    expect(budget.profileTier).toBe('midrange')
    expect(budget.isMinimal).toBe(false)
    expect(budget.vectorContextChars).toBe(4000)
    expect(budget.totalContextChars).toBe(5500)
    expect(budget.perDocumentPreviewChars).toBe(1500)
    expect(budget.historyTurns).toBe(16)
  })

  it('should collapse every budget dimension together on minimum hardware', () => {
    const minimal = resolveChatContextBudget(MINIMAL_HOST)
    const midrange = resolveChatContextBudget(MIDRANGE_HOST)

    expect(minimal.isMinimal).toBe(true)
    expect(minimal.profileTier).toBe('legacy')
    expect(minimal.vectorContextChars).toBeLessThan(midrange.vectorContextChars)
    expect(minimal.totalContextChars).toBeLessThan(midrange.totalContextChars)
    expect(minimal.perDocumentPreviewChars).toBeLessThan(midrange.perDocumentPreviewChars)
    expect(minimal.historyTurns).toBeLessThan(midrange.historyTurns)
    expect(minimal.vectorTopK).toBeLessThan(midrange.vectorTopK)
    expect(minimal.maxNumCtx).toBeLessThan(midrange.maxNumCtx)
    expect(minimal.keepAlive).toBe('5m')
  })

  it('should separate a minimum-spec laptop from a CPU-only workstation, though both are legacy', () => {
    const laptop = resolveChatContextBudget(MINIMAL_HOST)
    const workstation = resolveChatContextBudget(CPU_WORKSTATION)

    expect(laptop.profileTier).toBe('legacy')
    expect(workstation.profileTier).toBe('legacy')
    expect(laptop.isMinimal).toBe(true)
    expect(workstation.isMinimal).toBe(false)
    expect(workstation.historyTurns).toBeGreaterThan(laptop.historyTurns)
  })

  it('should scale budgets monotonically across the hardware ladder', () => {
    const tiers = [
      resolveChatContextBudget(MINIMAL_HOST),
      resolveChatContextBudget({ hasGpu: true, vramTotalMB: 6144, systemRamGB: 16, cpuCount: 8 }),
      resolveChatContextBudget(MIDRANGE_HOST),
      resolveChatContextBudget({ hasGpu: true, vramTotalMB: 16384, systemRamGB: 32, cpuCount: 16 }),
      resolveChatContextBudget(EXTREME_HOST),
    ]

    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i].totalContextChars).toBeGreaterThanOrEqual(tiers[i - 1].totalContextChars)
      expect(tiers[i].maxNumCtx).toBeGreaterThanOrEqual(tiers[i - 1].maxNumCtx)
      expect(tiers[i].historyTurns).toBeGreaterThanOrEqual(tiers[i - 1].historyTurns)
    }
  })

  it('should let an explicit hardware profile override detection and skip the minimal floor', () => {
    // The user pinned "High" on a machine that would auto-detect as minimum hardware.
    const forced = resolveChatContextBudget(MINIMAL_HOST, 'High')
    expect(forced.profileTier).toBe('highend')
    expect(forced.isMinimal).toBe(false)
    expect(forced.maxNumCtx).toBe(16384)

    const forcedLow = resolveChatContextBudget(EXTREME_HOST, 'Low')
    expect(forcedLow.profileTier).toBe('legacy')
    expect(forcedLow.maxNumCtx).toBe(4096)
  })

  it('should keep the retrieval budget strictly inside the combined context budget', () => {
    // Otherwise the final totalContextChars slice would cut into retrieved chunks whose
    // citations are already being shown to the user.
    const hosts = [MINIMAL_HOST, CPU_WORKSTATION, MIDRANGE_HOST, EXTREME_HOST]
    for (const host of hosts) {
      const budget = resolveChatContextBudget(host)
      expect(budget.vectorContextChars).toBeLessThan(budget.totalContextChars)
    }
  })

  it('should produce a prompt that fits the allowed window even when every budget is saturated', () => {
    const CHARS_PER_TOKEN = 3.8
    const SYSTEM_PROMPT_ALLOWANCE_CHARS = 4000
    const hosts = [MINIMAL_HOST, CPU_WORKSTATION, MIDRANGE_HOST, EXTREME_HOST]

    for (const host of hosts) {
      const budget = resolveChatContextBudget(host)
      const worstCaseChars =
        SYSTEM_PROMPT_ALLOWANCE_CHARS + budget.totalContextChars + budget.historyChars
      const promptTokens = Math.ceil(worstCaseChars / CHARS_PER_TOKEN)
      // A fully saturated turn must still leave room for the completion inside the cap.
      expect(promptTokens).toBeLessThan(budget.maxNumCtx)
      expect(calculateDynamicContextWindow(worstCaseChars, budget.maxNumCtx)).toBeLessThanOrEqual(budget.maxNumCtx)
    }
  })

  it('should size num_ctx from the actual prompt rather than always allocating the cap', () => {
    const budget = resolveChatContextBudget(EXTREME_HOST)
    const shortTurn = calculateDynamicContextWindow(400, budget.maxNumCtx)
    expect(shortTurn).toBeLessThan(budget.maxNumCtx)
    // A trivial "ciao" on a 24GB workstation must not reserve a 32k KV cache.
    expect(shortTurn).toBeLessThanOrEqual(4096)
  })

  it('should pin Ollama threads leaving one core for the UI, and stay silent when core count is unknown', () => {
    expect(resolveChatThreadCount(8)).toBe(7)
    expect(resolveChatThreadCount(1)).toBe(1)
    expect(resolveChatThreadCount(0)).toBeUndefined()
    expect(resolveChatThreadCount(undefined)).toBeUndefined()
  })

  describe('prompt char budget vs token window (regression: selected attachment truncated away)', () => {
    it('should keep the whole assembled turn inside the token window on every profile', () => {
      // The per-segment budgets were each sized on their own, with nothing budgeting the
      // assembled turn: on midrange, history alone was allowed maxNumCtx * 2.0 = 16384 chars
      // against 5500 for the selected documents. The turn then filled almost the whole window
      // and the ANSWER got what was left — ~1245 tokens on midrange, 61 on legacy.
      const hosts = [
        { hasNvidiaGpu: false, vramTotalMB: 0, totalRAMGB: 8, cpuCount: 4 },
        { hasNvidiaGpu: true, vramTotalMB: 8192, totalRAMGB: 32, cpuCount: 8 },
        { hasNvidiaGpu: true, vramTotalMB: 24576, totalRAMGB: 64, cpuCount: 16 },
      ]
      for (const host of hosts) {
        const budget = resolveChatContextBudget(host)
        const promptChars = resolvePromptCharBudget(budget.maxNumCtx)

        // The system prompt and the selected document context must both fit, with room left over
        // for at least some conversation history.
        const systemAndDocs = 2500 + budget.totalContextChars
        expect(
          promptChars,
          `${budget.profileTier}: no room left for history after system prompt + documents`
        ).toBeGreaterThan(systemAndDocs)

        // And the whole budget must fit the window once the answer's reserve is held back.
        expect(Math.ceil(promptChars / 3.5)).toBeLessThan(budget.maxNumCtx)
      }
    })

    it('should scale the prompt budget with the window', () => {
      expect(resolvePromptCharBudget(4096)).toBeLessThan(resolvePromptCharBudget(8192))
      expect(resolvePromptCharBudget(8192)).toBeLessThan(resolvePromptCharBudget(32768))
    })
  })
})
