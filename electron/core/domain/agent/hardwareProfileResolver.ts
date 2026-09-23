import os from 'node:os'
import { APPROX_CHARS_PER_TOKEN } from '../../../../shared/domain/agent/charsPerToken'
import { resolveMaxContextTokens, type DeclaredHardwareProfile } from '../../../../shared/domain/hardware/hardwareProfileTiers'

export interface OllamaRuntimeOptions {
  num_ctx: number
  temperature: number
  top_p: number
  repeat_penalty: number
  num_thread?: number
  /** Hard cap on generated tokens per turn. */
  num_predict: number
  /** Stop sequences. */
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
}

export const CODING_MODEL_KEEP_ALIVE = '30m'

export class HardwareProfileResolver {

  /** Generation reserve, as a share of the context window. */
  private static readonly GENERATION_RESERVE_RATIO = 0.35

  static deriveNumPredict(numCtx: number): number {
    return Math.max(1, Math.floor(numCtx * HardwareProfileResolver.GENERATION_RESERVE_RATIO))
  }

  /** The prompt-assembly char budget that actually fits `numCtx` once the generation reserve is held back. */
  static deriveMaxContextChars(numCtx: number): number {
    const promptTokens = numCtx - HardwareProfileResolver.deriveNumPredict(numCtx)
    return Math.floor(promptTokens * APPROX_CHARS_PER_TOKEN)
  }
  /** Resolves optimal Ollama runtime options from user settings and hardware diagnostics. */
  static resolveOllamaOptions(
    profile: DeclaredHardwareProfile = 'Auto',
    env?: HardwareEnvironment
  ): OllamaRuntimeOptions {
    const cpuCores = env?.cpuCount || os.cpus()?.length || 4
    const safeCpuThreads = Math.max(1, cpuCores - 1)

    // Sizing and RAM-aware scaling is delegated to resolveMaxContextTokens in hardwareProfileTiers.ts
    // (single source of truth across Electron domain, Recommendation Engine, and React UI).
    const numCtx = resolveMaxContextTokens(profile, env)

    return {
      num_ctx: numCtx,
      temperature: 0.1,
      top_p: 0.9,
      repeat_penalty: 1.1,
      num_thread: safeCpuThreads,
      num_predict: HardwareProfileResolver.deriveNumPredict(numCtx),
      stop: [...AGENT_STOP_SEQUENCES],
      maxContextChars: HardwareProfileResolver.deriveMaxContextChars(numCtx),
    }
  }
}
