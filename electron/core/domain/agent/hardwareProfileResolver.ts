import { APPROX_CHARS_PER_TOKEN } from '../../../../shared/domain/agent/charsPerToken'
import { resolveEffectiveTier, resolveMaxContextTokens, type DeclaredHardwareProfile } from '../../../../shared/domain/hardware/hardwareProfileTiers'
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
    // Sizing and RAM-aware scaling is delegated to resolveMaxContextTokens in hardwareProfileTiers.ts
    // (single source of truth across Electron domain, Recommendation Engine, and React UI), then
    // raised for the agent alone: Ollama recommends at least 64k tokens for agents and coding tools
    // (docs.ollama.com/context-length), and a 32 GB host holds a 4-bit ~30B model plus a 64k KV cache.
    const sharedCtx = resolveMaxContextTokens(profile, env)
    const ramGB = env?.systemRamGB ?? 0
    // Installed memory reads slightly under its nominal size (a 32 GB host reports 31.9 GB).
    const agentCtx = ramGB >= 30 ? (resolveEffectiveTier(profile, env) === 'legacy' ? 32768 : 65536) : sharedCtx
    const numCtx = Math.max(sharedCtx, agentCtx)

    return {
      num_ctx: numCtx,
      num_predict: HardwareProfileResolver.deriveNumPredict(numCtx),
      maxContextChars: HardwareProfileResolver.deriveMaxContextChars(numCtx),
    }
  }
}
