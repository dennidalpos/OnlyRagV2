import os from 'node:os'
import type { HardwareProfile } from '../../../../src/types'
import type { ModelTier } from './complexityEvaluator'
import { resolveEffectiveTier } from '../../../../src/services/hardwareProfileTiers'

export interface OllamaRuntimeOptions {
  num_ctx: number
  temperature: number
  top_p: number
  repeat_penalty: number
  num_thread?: number
  /**
   * Hard cap on generated tokens per turn. A turn is exactly one tool-call JSON block, so
   * anything beyond this is the model rambling — on CPU inference that runaway is the single
   * largest source of wasted wall-clock time. Sized generously enough that a large write_file
   * payload still fits (a truncated call fails to parse, costing a retry step).
   */
  num_predict: number
  /**
   * Stop sequences. These are the scaffolding markers of the prompt's own tool-history block
   * (see agentPromptAssembler.ts / episodicMemoryCompactor.ts): small models routinely carry on
   * past their tool call and hallucinate the next turn's tool results using this exact layout.
   * Deliberately NOT the closing ``` fence — file content written through write_file frequently
   * contains markdown code fences, and stopping there would corrupt every such write.
   */
  stop: string[]
  maxContextChars: number
}

/** Shared across all hardware tiers — see OllamaRuntimeOptions.stop. */
export const AGENT_STOP_SEQUENCES: string[] = [
  '\n### COMPLETE EXECUTION TRAJECTORY',
  '\n### RECENT DETAILED TOOL OUTPUTS',
  '\n#### [Step ',
  '\nCURRENT TURN STATUS:',
]

export interface HardwareEnvironment {
  hasGpu?: boolean
  vramTotalMB?: number
  systemRamGB?: number
  cpuCount?: number
  enableSystemRamOffloading?: boolean
}

export class HardwareProfileResolver {
  /**
   * Resolves effective hardware tier and optimal Ollama runtime options based on user settings, hardware diagnostics, and complexity tier.
   * Classification (and the safe-VRAM formula behind it) is owned by hardwareProfileTiers.ts;
   * this method only maps the resolved tier onto runtime options.
   */
  static resolveOllamaOptions(
    profile: HardwareProfile = 'Auto',
    env?: HardwareEnvironment,
    tier?: ModelTier
  ): OllamaRuntimeOptions {
    const cpuCores = env?.cpuCount || os.cpus()?.length || 4
    const safeCpuThreads = Math.max(1, cpuCores - 1)

    // Hardware classification is delegated to the shared 5-tier ladder in
    // hardwareProfileTiers.ts, so the runtime options, the model matrix, the complexity
    // router and the Ollama OS parameters all agree on what a given machine is.
    const hardwareTier = resolveEffectiveTier(profile, env)
    let effectiveTier: 'Low' | 'Medium' | 'High' =
      hardwareTier === 'legacy'
        ? 'Low'
        : hardwareTier === 'entry' || hardwareTier === 'midrange'
          ? 'Medium'
          : 'High'

    // When Hybrid System RAM Offloading is enabled and system RAM is plentiful,
    // upgrade effective runtime headroom to allow larger context windows and hybrid execution.
    if (env?.enableSystemRamOffloading && profile === 'Auto') {
      const ramGB = env.systemRamGB || 0
      if (effectiveTier === 'Low' && ramGB >= 16) {
        effectiveTier = 'Medium'
      } else if (effectiveTier === 'Medium' && ramGB >= 32 && (tier === 'deep_reasoning' || tier === 'heavy')) {
        effectiveTier = 'High'
      }
    }

    // Generation cap scales with the tier's expected answer size, not with the hardware:
    // a small model on a fast task still only has to emit one compact tool call.
    const numPredict = tier === 'fast' ? 4096 : (tier === 'deep_reasoning' || tier === 'heavy') ? 8192 : 6144

    // Base profile configurations with hardware-constrained context windows.
    // num_thread is set on every tier: a Medium/High profile can still be running on a
    // CPU-only or low-VRAM machine, where leaving Ollama's thread count unset costs throughput.
    if (effectiveTier === 'Low') {
      const isDeep = tier === 'deep_reasoning' || tier === 'heavy'
      return {
        num_ctx: isDeep ? 8192 : 4096,
        temperature: 0.1,
        top_p: 0.9,
        repeat_penalty: 1.1,
        num_thread: safeCpuThreads,
        num_predict: numPredict,
        stop: [...AGENT_STOP_SEQUENCES],
        maxContextChars: isDeep ? 24000 : 16000,
      }
    }

    if (effectiveTier === 'Medium') {
      const isFast = tier === 'fast'
      const isDeep = tier === 'deep_reasoning' || tier === 'heavy'
      return {
        num_ctx: isFast ? 4096 : isDeep ? 8192 : 8192,
        temperature: 0.1,
        top_p: 0.9,
        repeat_penalty: 1.1,
        num_thread: safeCpuThreads,
        num_predict: numPredict,
        stop: [...AGENT_STOP_SEQUENCES],
        maxContextChars: isFast ? 16000 : isDeep ? 28000 : 28000,
      }
    }

    // High tier
    const isFast = tier === 'fast'
    const isDeep = tier === 'deep_reasoning' || tier === 'heavy'
    return {
      num_ctx: isFast ? 8192 : isDeep ? 32768 : 16384,
      temperature: 0.1,
      top_p: 0.9,
      repeat_penalty: 1.1,
      num_thread: safeCpuThreads,
      num_predict: numPredict,
      stop: [...AGENT_STOP_SEQUENCES],
      maxContextChars: isFast ? 24000 : isDeep ? 64000 : 48000,
    }
  }
}
