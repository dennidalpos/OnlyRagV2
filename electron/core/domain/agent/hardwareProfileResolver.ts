import os from 'node:os'
import type { HardwareProfile } from '../../../../src/types'
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
   * Generation reserve, as a share of the context window. A turn is one tool call, so the only
   * genuinely large completion is a write_file payload; GENERATION_RESERVE_RATIO keeps room for
   * one without letting the reserve crowd out the prompt.
   */
  private static readonly GENERATION_RESERVE_RATIO = 0.35
  private static readonly GENERATION_RESERVE_CAP_TOKENS = 4096
  /**
   * Chars per BPE token for this prompt mix (English directives + markdown + code). Measured at
   * ~4.08 on real audit-log prompts; 3.6 is the conservative side of that, so the char budget
   * always under-estimates rather than over-estimates the token cost.
   */
  private static readonly CHARS_PER_TOKEN = 3.6

  static deriveNumPredict(numCtx: number): number {
    return Math.min(
      HardwareProfileResolver.GENERATION_RESERVE_CAP_TOKENS,
      Math.floor(numCtx * HardwareProfileResolver.GENERATION_RESERVE_RATIO)
    )
  }

  /**
   * The prompt-assembly char budget that actually fits `numCtx` once the generation reserve is
   * held back. Everything upstream (HeuristicContextCompactor, the assembler's per-block caps)
   * budgets in chars, so this is the single place where the token window is translated.
   */
  static deriveMaxContextChars(numCtx: number): number {
    const promptTokens = numCtx - HardwareProfileResolver.deriveNumPredict(numCtx)
    return Math.floor(promptTokens * HardwareProfileResolver.CHARS_PER_TOKEN)
  }
  /**
   * Resolves optimal Ollama runtime options from user settings and hardware diagnostics.
   * Classification (and the safe-VRAM formula behind it) is owned by hardwareProfileTiers.ts;
   * this method only maps the resolved hardware tier onto runtime options.
   *
   * There is deliberately no complexity-tier parameter: every module, coding included, runs on
   * one configured model, so a machine has exactly one runtime profile.
   */
  static resolveOllamaOptions(
    profile: HardwareProfile = 'Auto',
    env?: HardwareEnvironment
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
      }
    }

    // ── RAM-aware context window sizing ──
    // Base context from VRAM tier (GPU-only conservative floor).
    const vramBaseCtx = effectiveTier === 'Low' ? 4096 : effectiveTier === 'Medium' ? 8192 : 16384

    // When sufficient system RAM is available, Ollama transparently offloads KV cache
    // overflow to RAM. Slower prompt-eval but dramatically more context capacity.
    // Modern local models (7B+) natively support 32K–128K context; the KV cache cost
    // for a 7B at 32K is ~1.8 GB — modest relative to typical system RAM budgets.
    // Allowing larger context prevents the instruction-following collapse observed
    // when SLMs exhaust their prompt budget on plan + execution history + diagnostics
    // within a tight 8K window (see coding_agent_audit.log session analysis).
    const ramGB = env?.systemRamGB ?? 0
    let numCtx: number
    if (ramGB >= 24) {
      // 24 GB+ RAM: all tiers scale to the native maximum of modern models (32K).
      numCtx = effectiveTier === 'Low' ? 16384 : 32768
    } else if (ramGB >= 16) {
      // 16 GB+ RAM: double the VRAM-only baseline.
      numCtx = effectiveTier === 'Low' ? 8192 : effectiveTier === 'Medium' ? 16384 : 32768
    } else {
      numCtx = vramBaseCtx
    }

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
