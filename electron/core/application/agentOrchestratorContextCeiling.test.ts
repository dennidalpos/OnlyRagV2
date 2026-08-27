import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../diagnostics', () => ({
  logger: { log: vi.fn() },
  getCachedGpuInfo: () => ({ hasNvidiaGpu: true, vramTotalMB: 24576 }),
  getMemoryInfo: () => ({ totalRAMGB: 32 }),
}))

import { selectModelForTurn, freezeOrGrowContextWindow } from './agentOrchestratorPromptAssembly'
import { HardwareProfileResolver } from '../domain/agent/hardwareProfileResolver'
import type { TurnDispatchContext } from './agentOrchestratorTurnDispatchTypes'
import type { AppSettings } from '../../../src/types'
import type { OllamaModelMetrics } from '../infrastructure/http/ollamaHttpClient'

/**
 * Ollama clamps any requested `num_ctx` down to the model's trained `context_length`, then
 * truncates the HEAD of the prompt to fit — the system prompt and the plan block, measured
 * 2026-08-24 (see ollamaHttpClient.getModelMetrics).
 *
 * The clamp itself was never the damage. The damage was `maxContextChars` being derived from the
 * UNCLAMPED window: it told HeuristicContextCompactor there was room that did not exist, so the
 * compactor declined to act and handed Ollama a prompt guaranteed to lose its head. These tests
 * pin that both numbers now come from the window Ollama will actually honour.
 */

const MODEL = 'qwen2.5-coder:7b'

/** A 32 GB / 24 GB-VRAM host asks for far more window than a small model was trained with. */
function metricsWith(contextLength?: number): Record<string, OllamaModelMetrics> {
  return { [MODEL]: { capabilities: ['completion', 'tools'], contextLength } }
}

let logs: string[]

function contextWith(modelMetrics: Record<string, OllamaModelMetrics>): TurnDispatchContext {
  return {
    settings: { codingModel: MODEL, defaultModel: MODEL, hardwareProfile: 'High' } as unknown as AppSettings,
    hardwareFacts: { hasGpu: true, vramTotalMB: 24576, systemRamGB: 32, cpuCount: 16 },
    currentOverriddenModel: null,
    availableModels: [MODEL],
    modelCapabilities: { [MODEL]: ['completion', 'tools'] },
    modelMetrics,
    session: {} as TurnDispatchContext['session'],
    sessionNumCtxBox: { value: null },
    emitLog: (_type: string, message: string) => { logs.push(message) },
  } as unknown as TurnDispatchContext
}

beforeEach(() => {
  logs = []
})

describe('selectModelForTurn — context ceiling', () => {
  it('leaves the hardware window alone when the model can hold it', () => {
    const selection = selectModelForTurn(contextWith(metricsWith(131072)))
    expect(selection.contextCeiling).toBe(131072)
    expect(selection.runtimeOpts.num_ctx).toBe(32768)
    expect(logs.filter((l) => l.includes('Context clamped'))).toHaveLength(0)
  })

  it('clamps num_ctx down to the model trained context length', () => {
    const selection = selectModelForTurn(contextWith(metricsWith(8192)))
    expect(selection.runtimeOpts.num_ctx).toBe(8192)
    expect(logs.some((l) => l.includes('Context clamped') && l.includes('8192'))).toBe(true)
  })

  it('re-derives num_predict and maxContextChars from the clamped window, not the requested one', () => {
    const selection = selectModelForTurn(contextWith(metricsWith(8192)))
    // The whole point: a budget quoted against a window that will not exist is what stopped the
    // compactor from running.
    expect(selection.runtimeOpts.maxContextChars).toBe(HardwareProfileResolver.deriveMaxContextChars(8192))
    expect(selection.runtimeOpts.num_predict).toBe(HardwareProfileResolver.deriveNumPredict(8192))
    expect(selection.runtimeOpts.maxContextChars).toBeLessThan(HardwareProfileResolver.deriveMaxContextChars(32768))
  })

  it('falls back to the hardware window when Ollama reports no context length', () => {
    const selection = selectModelForTurn(contextWith(metricsWith(undefined)))
    expect(selection.contextCeiling).toBeNull()
    expect(selection.runtimeOpts.num_ctx).toBe(4096)
  })

  it('falls back to the hardware window when the model is absent from the metrics map', () => {
    const selection = selectModelForTurn(contextWith({}))
    expect(selection.contextCeiling).toBeNull()
    expect(selection.runtimeOpts.num_ctx).toBe(4096)
  })
})

describe('freezeOrGrowContextWindow — selected ctx versus prompt budget', () => {
  it('freezes the window on the first turn and holds it on the next', () => {
    const ctx = contextWith(metricsWith(131072))
    const runtimeOpts = { ...selectModelForTurn(ctx).runtimeOpts }
    freezeOrGrowContextWindow(ctx, 'short prompt', runtimeOpts, 131072)
    const frozen = ctx.sessionNumCtxBox.value
    freezeOrGrowContextWindow(ctx, 'a different short prompt', runtimeOpts, 131072)
    expect(ctx.sessionNumCtxBox.value).toBe(frozen)
  })

  it('does not resize the selected ctx when the prompt grows', () => {
    const ctx = contextWith(metricsWith(131072))
    ctx.sessionNumCtxBox.value = 2048
    const runtimeOpts = { ...selectModelForTurn(ctx).runtimeOpts, num_predict: 1024 }
    freezeOrGrowContextWindow(ctx, 'x '.repeat(12_000), runtimeOpts, 131072)
    expect(ctx.sessionNumCtxBox.value).toBe(2048)
    expect(runtimeOpts.num_ctx).toBe(32768)
    expect(logs.some((l) => l.includes('Context window grown'))).toBe(false)
  })

  /**
   * A fallback model gets its own selected context; the session box is diagnostic state only.
   */
  it('holds a frozen window down to the ceiling when a smaller model is swapped in', () => {
    const ctx = contextWith(metricsWith(8192))
    ctx.sessionNumCtxBox.value = 32768
    const runtimeOpts = { ...selectModelForTurn(ctx).runtimeOpts }
    freezeOrGrowContextWindow(ctx, 'short prompt', runtimeOpts, 8192)
    expect(runtimeOpts.num_ctx).toBe(8192)
    expect(ctx.sessionNumCtxBox.value).toBe(32768)
  })

  it('leaves the frozen window untouched when no ceiling is known', () => {
    const ctx = contextWith(metricsWith(undefined))
    ctx.sessionNumCtxBox.value = 16384
    const runtimeOpts = { ...selectModelForTurn(ctx).runtimeOpts }
    freezeOrGrowContextWindow(ctx, 'short prompt', runtimeOpts, null)
    expect(runtimeOpts.num_ctx).toBe(4096)
  })
})
