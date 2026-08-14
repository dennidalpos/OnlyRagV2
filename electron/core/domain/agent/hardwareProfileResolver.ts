import os from 'node:os'
import type { HardwareProfile } from '../../../../src/types'
import type { ComplexityTier } from './complexityEvaluator'

export interface OllamaRuntimeOptions {
  num_ctx: number
  temperature: number
  top_p: number
  repeat_penalty: number
  num_thread?: number
  maxContextChars: number
}

export interface HardwareEnvironment {
  hasGpu?: boolean
  vramTotalMB?: number
  systemRamGB?: number
  cpuCount?: number
}

export class HardwareProfileResolver {
  /**
   * Resolves effective hardware tier and optimal Ollama runtime options based on user settings, hardware diagnostics, and complexity tier.
   */
  static resolveOllamaOptions(
    profile: HardwareProfile = 'Auto',
    env?: HardwareEnvironment,
    tier?: ComplexityTier
  ): OllamaRuntimeOptions {
    const cpuCores = env?.cpuCount || os.cpus()?.length || 4
    const safeCpuThreads = Math.max(1, cpuCores - 1)

    let effectiveTier: 'Low' | 'Medium' | 'High' = 'Medium'

    if (profile === 'Low') {
      effectiveTier = 'Low'
    } else if (profile === 'Medium') {
      effectiveTier = 'Medium'
    } else if (profile === 'High') {
      effectiveTier = 'High'
    } else {
      // 'Auto' mode: dynamically adapt based on detected GPU / VRAM / RAM
      const hasGpu = !!env?.hasGpu
      const vramMB = env?.vramTotalMB || 0
      const vramGB = Math.floor(vramMB / 1024)

      if (hasGpu && vramGB >= 12) {
        effectiveTier = 'High'
      } else if (hasGpu && vramGB >= 6) {
        effectiveTier = 'Medium'
      } else {
        effectiveTier = 'Low'
      }
    }

    // Base profile configurations
    if (effectiveTier === 'Low') {
      const isDeep = tier === 'deep_reasoning'
      return {
        num_ctx: isDeep ? 8192 : 4096,
        temperature: 0.1,
        top_p: 0.9,
        repeat_penalty: 1.1,
        num_thread: safeCpuThreads,
        maxContextChars: isDeep ? 24000 : 16000,
      }
    }

    if (effectiveTier === 'Medium') {
      const isFast = tier === 'fast'
      const isDeep = tier === 'deep_reasoning'
      return {
        num_ctx: isFast ? 4096 : isDeep ? 16384 : 8192,
        temperature: 0.1,
        top_p: 0.9,
        repeat_penalty: 1.1,
        maxContextChars: isFast ? 16000 : isDeep ? 48000 : 32000,
      }
    }

    // High tier
    const isFast = tier === 'fast'
    const isDeep = tier === 'deep_reasoning'
    return {
      num_ctx: isFast ? 8192 : isDeep ? 32768 : 16384,
      temperature: 0.1,
      top_p: 0.9,
      repeat_penalty: 1.1,
      maxContextChars: isFast ? 24000 : isDeep ? 64000 : 48000,
    }
  }
}
