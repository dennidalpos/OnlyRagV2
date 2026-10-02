import { DiagnosticsData, RunningModelDetails, OllamaModelMetrics, AppSettings } from '../types'
import { translate } from '../i18n/I18nContext'
import {
  calculateRealUsableVram,
  classifyHardwareProfileTier,
  resolveMaxContextTokens,
  resolveAgentContextTokens,
  type HardwareFacts,
  type HardwareProfileTier,
} from '../../shared/domain/hardware/hardwareProfileTiers'

export type { HardwareFacts } from '../../shared/domain/hardware/hardwareProfileTiers'
export { estimateModelWeightGB }
import { estimateModelWeightGB } from '../../shared/domain/hardware/modelWeightEstimator'
import { assessModelRuntimeFit, type ModelFitVerdict } from '../../shared/domain/hardware/modelRuntimeFit'
import { resolveModelContextLength } from '../../shared/domain/settings/modelContextPreference'
import { isLocalOllamaHost } from '../../shared/domain/ollamaHost'
export type { ModelFitVerdict } from '../../shared/domain/hardware/modelRuntimeFit'

export interface HardwareRecommendations {
  profileTier: HardwareProfileTier
  profileName: string
  gpuSummary: string
  ramSummary: string
  safeVramBudgetGB: number
}

/** Approximate memory/disk footprint string for model. */
export function getModelApproxSize(modelName: string, details?: RunningModelDetails): string | undefined {
  if (!modelName) return undefined
  const lower = modelName.toLowerCase().trim()
  if (lower === 'local' || lower === 'none') return undefined

  const weightGB = estimateModelWeightGB(modelName, details)
  if (weightGB < 1.0) {
    return `${Math.round(weightGB * 1024)} MB`
  }
  return `${weightGB.toFixed(1)} GB`
}

/** Use the same role context resolver as execution; remote memory is unknown. */
export function buildModelFitLookup(
  diagnostics: DiagnosticsData | null,
  settings: AppSettings,
  metrics: Record<string, OllamaModelMetrics>,
  setup = false,
): (modelName: string, coding?: boolean) => ModelFitVerdict {
  const facts = extractHardwareFacts(diagnostics)
  const knownFacts = diagnostics && settings.ollamaMode !== 'remote' && isLocalOllamaHost(settings.ollamaHost) ? facts : undefined
  return (modelName, coding = false) => {
    const hardwareContext = !setup && coding ? resolveAgentContextTokens('Auto', facts) : resolveMaxContextTokens('Auto', facts)
    const context = resolveModelContextLength(modelName, settings.modelContextLengths, hardwareContext, metrics[modelName]?.contextLength)
    return assessModelRuntimeFit(modelName, context, knownFacts, metrics[modelName])
  }
}

export function formatModelFit(fit: ModelFitVerdict): string {
  const size =
    fit.maximumGB === undefined
      ? `~${fit.minimumGB.toFixed(1)} + ?`
      : fit.minimumGB === fit.maximumGB
        ? fit.maximumGB.toFixed(1)
        : `${fit.minimumGB.toFixed(1)}–${fit.maximumGB.toFixed(1)}`
  const labels = {
    gpu_possible: 'hardwareWizard.memoryGpu',
    cpu_offload_possible: 'hardwareWizard.memoryOffload',
    cpu_possible: 'hardwareWizard.memoryCpu',
    insufficient: 'hardwareWizard.memoryInsufficient',
    unknown: 'hardwareWizard.memoryUnknown',
  } as const
  const basis = fit.basis === 'observed' ? translate('hardwareWizard.memoryObserved') : translate('hardwareWizard.memoryEstimated')
  return `${fit.contextTokens} ctx · ${size} GiB · ${translate(labels[fit.placement])} · ${basis}${fit.uncertain ? ' ?' : ''}`
}

export { isOllamaModelInstalled } from '../../shared/domain/agent/modelTagMatcher'

/**
 * Summarizes detected host hardware. Model fit is evaluated for actual Ollama tags on demand.
 */
export function analyzeHardwareAndRecommend(diagnostics: DiagnosticsData | null): HardwareRecommendations {
  const { profileTier, profileName, safeVramBudgetGB, gpuSummary, ramSummary } = resolveHardwareProfile(diagnostics)

  return {
    profileTier,
    profileName,
    gpuSummary,
    ramSummary,
    safeVramBudgetGB,
  }
}

/** Summarize detected hardware separately from model/workload fit. */
function resolveHardwareProfile(diagnostics: DiagnosticsData | null): {
  profileTier: HardwareProfileTier
  profileName: string
  vramTotalMB: number
  systemRamGB: number
  safeVramBudgetGB: number
  gpuSummary: string
  ramSummary: string
} {
  const facts = extractHardwareFacts(diagnostics)
  const hasGpu = !!facts.hasGpu
  const vramTotalMB = facts.vramTotalMB || 0
  const vramGB = Math.floor(vramTotalMB / 1024)
  const systemRamGB = facts.systemRamGB || 8
  const safeVramBudgetGB = calculateRealUsableVram(vramTotalMB)

  const profileTier = classifyHardwareProfileTier(facts)
  const profileName = formatProfileName(profileTier, vramGB, systemRamGB)

  const gpuSummary = hasGpu
    ? `${diagnostics?.gpu.gpuName || 'NVIDIA GPU'} (${vramGB} GB VRAM — Safe Budget: ${safeVramBudgetGB.toFixed(1)} GB)`
    : 'No Dedicated GPU Detected (CPU Execution)'
  const ramSummary = `${systemRamGB} GB System RAM`

  return { profileTier, profileName, vramTotalMB, systemRamGB, safeVramBudgetGB, gpuSummary, ramSummary }
}

/**
 * Normalizes a diagnostics snapshot into the raw facts every hardware-aware surface
 * consumes (model matrix, agent runtime options, Ollama OS parameters, chat budgets).
 */
export function extractHardwareFacts(diagnostics: DiagnosticsData | null): HardwareFacts {
  return {
    hasGpu: diagnostics?.gpu.hasNvidiaGpu || false,
    vramTotalMB: diagnostics?.gpu.vramTotalMB || 0,
    systemRamGB: Math.round(diagnostics?.memory.totalRAMGB || 8),
    cpuCount: diagnostics?.system.cpusCount || 0,
  }
}

/** Human-readable label for a classified tier (classification itself lives in hardwareProfileTiers.ts). */
function formatProfileName(tier: HardwareProfileTier, vramGB: number, systemRamGB: number): string {
  const specs = `${vramGB}GB VRAM / ${systemRamGB}GB RAM`
  switch (tier) {
    case 'legacy':
      return `Legacy / CPU-Only Hardware (${vramGB > 0 ? `${vramGB}GB VRAM` : 'No GPU'} / ${systemRamGB}GB RAM)`
    case 'entry':
      return `Entry-Level GPU (${specs})`
    case 'midrange':
      return `Mid-Range GPU (${specs})`
    case 'highend':
      return `High-End Performance GPU (${specs})`
    default:
      return `Extreme Workstation (${specs})`
  }
}
