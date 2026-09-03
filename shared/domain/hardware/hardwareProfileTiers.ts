/**
 * Single source of truth for host hardware classification.
 *
 * Before this module the same "how big is this machine" question was answered by four
 * independent threshold ladders that had already drifted apart:
 *   - hardwareRecommendationEngine.classifyHardwareTier   (raw VRAM GB: 4 / 8 / 12 / 20)
 *   - hardwareRecommendationEngine.getRecommendedOllamaEnvVars (raw VRAM GB: 4 / 8 / 12 / 24)
 * A 24GB workstation was therefore `extreme` for the model matrix but `highend` for the
 * Ollama OS parameters, and a 6GB laptop GPU was `entry` for recommendations but `Low`
 * for the agent runtime options.
 *
 * Everything here is pure data + arithmetic with zero imports, so it can be consumed
 * from the renderer, the Electron domain layer, and tests alike.
 */

export type HardwareProfileTier = 'legacy' | 'entry' | 'midrange' | 'highend' | 'extreme'

/** Internal compatibility profiles used only by the recommendation/runtime calculation. */
export type DeclaredHardwareProfile = 'Low' | 'Medium' | 'High' | 'Auto'

/**
 * Analytical VRAM budgeting constants:
 * - SAFETY_MARGIN: 25% reserve for dynamic KV Cache growth, token context expansion, background tasks.
 * - OVERHEAD_OS_GB: 1.5 GB fixed reserve for Windows Desktop Window Manager (DWM.exe) and display buffers.
 */
export const VRAM_SAFETY_MARGIN = 0.25
export const VRAM_OVERHEAD_OS_GB = 1.5

/**
 * Calculates net usable safe VRAM according to the analytical formula:
 * VRAM_Disponibile_Reale = (VRAM_Totale * (1 - Safety_Margin)) - Overhead_OS
 */
export function calculateRealUsableVram(vramTotalMB: number): number {
  if (!vramTotalMB || vramTotalMB <= 0) return 0
  const vramTotalGB = vramTotalMB / 1024
  const usable = vramTotalGB * (1 - VRAM_SAFETY_MARGIN) - VRAM_OVERHEAD_OS_GB
  return Math.max(0, Math.round(usable * 100) / 100)
}

/** Raw host facts every classification consumer can supply from DiagnosticsData or node:os. */
export interface HardwareFacts {
  hasGpu?: boolean
  vramTotalMB?: number
  systemRamGB?: number
  cpuCount?: number
}

/**
 * Tier boundaries expressed in whole GB of dedicated VRAM. The safe-budget ladder below
 * is derived from these, so the two can never disagree.
 */
const TIER_MIN_VRAM_GB: Record<Exclude<HardwareProfileTier, 'legacy'>, number> = {
  entry: 4,
  midrange: 8,
  highend: 12,
  extreme: 20,
}

/** Classifies a host from raw facts. The canonical entry point. */
export function classifyHardwareProfileTier(facts: HardwareFacts): HardwareProfileTier {
  const hasGpu = !!facts.hasGpu
  const vramGB = Math.floor((facts.vramTotalMB || 0) / 1024)
  if (!hasGpu || vramGB < TIER_MIN_VRAM_GB.entry) return 'legacy'
  if (vramGB < TIER_MIN_VRAM_GB.midrange) return 'entry'
  if (vramGB < TIER_MIN_VRAM_GB.highend) return 'midrange'
  if (vramGB < TIER_MIN_VRAM_GB.extreme) return 'highend'
  return 'extreme'
}

/**
 * Resolves the effective tier honouring an explicit user override. `Auto` defers to the
 * detected hardware; the coarse manual profiles map onto the nearest detailed tier.
 */
export function resolveEffectiveTier(
  declared: DeclaredHardwareProfile = 'Auto',
  facts: HardwareFacts = {}
): HardwareProfileTier {
  if (declared === 'Low') return 'legacy'
  if (declared === 'Medium') return 'midrange'
  if (declared === 'High') return 'highend'
  return classifyHardwareProfileTier(facts)
}

/**
 * True for hosts that must be treated as *minimum* hardware rather than merely GPU-less:
 * no usable accelerator AND either little system RAM or few cores. On such machines every
 * extra KB of prompt is paid twice — once in prompt-eval wall clock, once in the RAM the
 * KV cache steals from the OS — so context budgets, `num_ctx`, Ollama parallelism and
 * model keep-alive all collapse to their smallest safe values.
 */
export function isMinimalHardwareHost(facts: HardwareFacts): boolean {
  const tier = classifyHardwareProfileTier(facts)
  if (tier !== 'legacy') return false
  const ramGB = facts.systemRamGB ?? 0
  const cores = facts.cpuCount ?? 0
  // Unknown RAM/cores (0) means "not probed yet" — assume minimal and stay conservative.
  return ramGB <= 8 || cores <= 4
}

/** Usable share of system RAM for CPU inference, leaving the OS and the app their own working set. */
export const SYSTEM_RAM_USABLE_RATIO = 0.7
export const SYSTEM_RAM_MIN_BUDGET_GB = 2.0

/** Net RAM budget available to a CPU-executed model. */
export function calculateUsableSystemRamGB(systemRamGB: number): number {
  if (!systemRamGB || systemRamGB <= 0) return SYSTEM_RAM_MIN_BUDGET_GB
  return Math.max(SYSTEM_RAM_MIN_BUDGET_GB, Math.round(systemRamGB * SYSTEM_RAM_USABLE_RATIO * 100) / 100)
}

/**
 * Resolves optimal context tokens (num_ctx) based on declared profile, hardware facts, and system RAM offloading.
 * Implements RAM-aware context scaling (up to 32K for >=24GB RAM, 16K for >=16GB RAM) to exploit Ollama's
 * transparent KV-cache offloading without hardcoded UI approximations.
 */
export function resolveMaxContextTokens(
  declared: DeclaredHardwareProfile = 'Auto',
  facts: HardwareFacts = {}
): number {
  const hardwareTier = resolveEffectiveTier(declared, facts)
  let effectiveTier: 'Low' | 'Medium' | 'High' =
    hardwareTier === 'legacy'
      ? 'Low'
      : hardwareTier === 'entry' || hardwareTier === 'midrange'
        ? 'Medium'
        : 'High'

  const vramBaseCtx = effectiveTier === 'Low' ? 4096 : effectiveTier === 'Medium' ? 8192 : 16384
  const ramGB = facts.systemRamGB ?? 0
  if (ramGB >= 24) {
    return effectiveTier === 'Low' ? 16384 : 32768
  }
  if (ramGB >= 16) {
    return effectiveTier === 'Low' ? 8192 : effectiveTier === 'Medium' ? 16384 : 32768
  }
  return vramBaseCtx
}

