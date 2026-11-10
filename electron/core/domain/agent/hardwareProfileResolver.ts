import { APPROX_CHARS_PER_TOKEN } from '../../../../shared/domain/agent/charsPerToken'
import { resolveAgentContextTokens, type DeclaredHardwareProfile } from '../../../../shared/domain/hardware/hardwareProfileTiers'
import type { OllamaSamplingOverrides } from '../../../../shared/types'

/**
 * Per-session Ollama options. Sampling and thread keys come only from the user's per-model
 * overrides: unset, Ollama applies the model's Modelfile defaults (and picks physical cores).
 */
export interface OllamaRuntimeOptions extends OllamaSamplingOverrides {
  num_ctx: number
  /** Hard cap on generated tokens per turn. */
  num_predict: number
  maxContextChars: number
}

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
  static resolveOllamaOptions(profile: DeclaredHardwareProfile = 'Auto', env?: HardwareEnvironment): OllamaRuntimeOptions {
    const numCtx = resolveAgentContextTokens(profile, env)

    return {
      num_ctx: numCtx,
      num_predict: HardwareProfileResolver.deriveNumPredict(numCtx),
      maxContextChars: HardwareProfileResolver.deriveMaxContextChars(numCtx),
    }
  }
}
