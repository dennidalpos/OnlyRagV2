/**
 * Single source of truth for host hardware classification.
 *
 * Before this module the same "how big is this machine" question was answered by four
 * independent threshold ladders that had already drifted apart:
 *   - hardwareRecommendationEngine.classifyHardwareTier   (raw VRAM GB: 4 / 8 / 12 / 20)
 *   - hardwareRecommendationEngine.getRecommendedOllamaEnvVars (raw VRAM GB: 4 / 8 / 12 / 24)
 *   - hardwareProfileResolver.resolveOllamaOptions        (safe budget GB: 3.0 / 7.5)
 *   - complexityEvaluator.evaluateTaskComplexity          (safe budget GB: 3.0 / 7.0 / 12.0)
 * A 24GB workstation was therefore `extreme` for the model matrix but `highend` for the
 * Ollama OS parameters, and a 6GB laptop GPU was `entry` for recommendations but `Low`
 * for the agent runtime options.
 *
 * Everything here is pure data + arithmetic with zero imports, so it can be consumed
 * from the renderer, the Electron domain layer, and tests alike.
 */

export type HardwareProfileTier = 'legacy' | 'entry' | 'midrange' | 'highend' | 'extreme'

/** Coarse user-facing profile selector persisted in AppSettings.hardwareProfile. */
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

/**
 * Safe-budget lower bound of each tier — `calculateRealUsableVram` applied to the VRAM
 * boundaries above. Exported so callers that only hold a budget (the agent runtime
 * resolver, the complexity router) classify identically to callers that hold raw VRAM.
 */
export const TIER_MIN_SAFE_BUDGET_GB: Record<Exclude<HardwareProfileTier, 'legacy'>, number> = {
  entry: calculateRealUsableVram(TIER_MIN_VRAM_GB.entry * 1024),
  midrange: calculateRealUsableVram(TIER_MIN_VRAM_GB.midrange * 1024),
  highend: calculateRealUsableVram(TIER_MIN_VRAM_GB.highend * 1024),
  extreme: calculateRealUsableVram(TIER_MIN_VRAM_GB.extreme * 1024),
}

/**
 * Representative safe VRAM budget for a tier, used when the user pinned a coarse profile
 * manually (`Low`/`Medium`/`High`) and no GPU probe is available to measure the real one.
 */
export const TIER_NOMINAL_SAFE_BUDGET_GB: Record<HardwareProfileTier, number> = {
  legacy: 0,
  entry: TIER_MIN_SAFE_BUDGET_GB.entry,
  midrange: TIER_MIN_SAFE_BUDGET_GB.midrange,
  highend: TIER_MIN_SAFE_BUDGET_GB.highend,
  extreme: TIER_MIN_SAFE_BUDGET_GB.extreme,
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

/** Classifies a host when only the net usable VRAM budget is known. */
export function classifyTierFromSafeBudget(safeVramBudgetGB: number, hasGpu: boolean = true): HardwareProfileTier {
  if (!hasGpu || !safeVramBudgetGB || safeVramBudgetGB < TIER_MIN_SAFE_BUDGET_GB.entry) return 'legacy'
  if (safeVramBudgetGB < TIER_MIN_SAFE_BUDGET_GB.midrange) return 'entry'
  if (safeVramBudgetGB < TIER_MIN_SAFE_BUDGET_GB.highend) return 'midrange'
  if (safeVramBudgetGB < TIER_MIN_SAFE_BUDGET_GB.extreme) return 'highend'
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
 * Calculates combined hybrid memory budget (Usable VRAM + Usable System RAM)
 * when System RAM Offloading is enabled.
 */
export function calculateHybridUsableMemoryGB(vramTotalMB: number, systemRamGB: number): number {
  const usableVram = calculateRealUsableVram(vramTotalMB)
  const usableRam = calculateUsableSystemRamGB(systemRamGB)
  return Math.round((usableVram + usableRam) * 100) / 100
}

/**
 * Weight ceiling for a model that must run on CPU. This is a *throughput* bound, not a
 * memory bound: an 8GB CPU-only host can technically hold a 4.7GB model inside its
 * `calculateUsableSystemRamGB` budget, but it will emit a couple of tokens per second,
 * which makes an autonomous multi-turn tool loop unusable. Candidates above this size are
 * therefore ranked last on `legacy` hosts even when memory alone would allow them.
 */
export const CPU_INFERENCE_WEIGHT_BUDGET_GB = 3.0
