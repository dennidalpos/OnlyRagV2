import { AgentStreamTransport, StreamSession } from '../infrastructure/http/agentStreamTransport'
import { logger } from '../../diagnostics'
import type { OllamaRuntimeOptions } from '../domain/agent/hardwareProfileResolver'
import type { ModelTier } from '../domain/agent/complexityEvaluator'

export interface ModelDispatchPlan {
  primaryModel: string
  intermediateModel?: string
  fallbackModel: string
  /** Optional escalation model (14B+) for complex tasks on second+ failure */
  heavyEscalationModel?: string
  runtimeOpts: OllamaRuntimeOptions
}

export interface DispatchedCompletionResult {
  output: string
  usedModel: string
  isFallback: boolean
  isEscalated?: boolean
  fallbackReason?: string
}

/**
 * Evicts all models from VRAM before loading a heavy escalation model.
 * Calls Ollama /api/generate with keep_alive=0 to free memory immediately.
 */
async function evictModelsFromVram(
  modelsToEvict: string[],
  ollamaEndpoint?: string
): Promise<void> {
  const host = ollamaEndpoint || 'http://127.0.0.1:11434'
  const targets = new Set<string>()

  if (modelsToEvict.includes('*')) {
    try {
      const psRes = await fetch(`${host}/api/ps`, { signal: AbortSignal.timeout(2000) })
      if (psRes.ok) {
        const data = await psRes.json()
        if (Array.isArray(data?.models)) {
          for (const m of data.models) {
            if (m?.name) targets.add(m.name)
          }
        }
      }
    } catch {
      // ignore ps fetch error
    }
  }

  for (const m of modelsToEvict) {
    if (m !== '*') targets.add(m)
  }

  if (targets.size === 0) {
    // If no explicit models discovered, issue generic keep_alive 0
    try {
      await fetch(`${host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep_alive: 0 }),
        signal: AbortSignal.timeout(3000),
      })
    } catch {
      // Best effort
    }
    return
  }

  for (const modelName of targets) {
    try {
      await fetch(`${host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, keep_alive: 0 }),
        signal: AbortSignal.timeout(3000),
      })
      logger.log('INFO', 'ResilientModelDispatcher', `Evicted model from VRAM: ${modelName}`)
    } catch {
      // Non-critical: eviction is best-effort
    }
  }
}

/**
 * Manages resilient LLM streaming with graceful degradation across model tiers and context budgets.
 * Tier cascade: primaryModel → intermediateModel → fallbackModel → heavyEscalationModel (on demand).
 */
export class ResilientModelDispatcher {
  /**
   * Evicts active models from VRAM immediately.
   */
  public static async evictVram(modelsToEvict: string[] = ['*'], ollamaEndpoint?: string): Promise<void> {
    return evictModelsFromVram(modelsToEvict, ollamaEndpoint)
  }

  /**
   * Evaluates the multi-tier escalation chain: Fast Tier -> Standard Tier -> Deep Reasoning Tier -> Heavy Tier.
   * Cycles through available distinct models starting from current model tier upwards.
   */
  public static getNextEscalationModel(
    currentModel: string,
    plan: {
      fastModel?: string
      standardModel?: string
      deepReasoningModel?: string
      heavyEscalationModel?: string
    }
  ): { nextModel: string; tierLabel: string; tier: ModelTier } | null {
    const { fastModel, standardModel, deepReasoningModel, heavyEscalationModel } = plan

    const tierList: { model: string; label: string; tier: ModelTier }[] = []
    if (fastModel) tierList.push({ model: fastModel, label: '🟢 Fast Tier', tier: 'fast' })
    if (standardModel) tierList.push({ model: standardModel, label: '🔵 Standard Tier', tier: 'standard' })
    if (deepReasoningModel) tierList.push({ model: deepReasoningModel, label: '🟣 Deep Reasoning Tier', tier: 'deep_reasoning' })
    if (heavyEscalationModel) tierList.push({ model: heavyEscalationModel, label: '🔶 Heavy Tier', tier: 'heavy' })

    const distinctTiers = tierList.filter(
      (item, index, self) => Boolean(item.model) && self.findIndex((t) => t.model === item.model) === index
    )

    if (distinctTiers.length <= 1) return null

    const currentIndex = distinctTiers.findIndex((t) => t.model === currentModel)
    if (currentIndex === -1) {
      const candidate = distinctTiers.find((t) => t.model !== currentModel)
      return candidate ? { nextModel: candidate.model, tierLabel: candidate.label, tier: candidate.tier } : null
    }

    const nextIndex = (currentIndex + 1) % distinctTiers.length
    if (nextIndex === currentIndex) return null

    return {
      nextModel: distinctTiers[nextIndex].model,
      tierLabel: distinctTiers[nextIndex].label,
      tier: distinctTiers[nextIndex].tier,
    }
  }

  /**
   * Executes streaming with primary model, progressively degrading across intermediate and fallback tiers.
   * If a heavyEscalationModel is configured and all primary tiers fail, escalates to it after VRAM eviction.
   */
  public static async executeWithFallback(
    plan: ModelDispatchPlan,
    sessionOpts: Omit<StreamSession, 'targetModel' | 'runtimeOpts'>,
    onFallbackTriggered?: (fromModel: string, toModel: string, reason: string) => void
  ): Promise<DispatchedCompletionResult> {
    const { primaryModel, intermediateModel, fallbackModel, heavyEscalationModel, runtimeOpts } = plan

    // 1. Attempt Primary Model
    try {
      const output = await AgentStreamTransport.streamCompletion({
        ...sessionOpts,
        targetModel: primaryModel,
        runtimeOpts,
      })
      return { output, usedModel: primaryModel, isFallback: false }
    } catch (primaryErr: any) {
      logger.log(
        'WARN',
        'ResilientModelDispatcher',
        `Primary model [${primaryModel}] failed: ${primaryErr.message}. Evaluating fallback...`
      )

      // 2. Attempt Intermediate Model if available and distinct
      if (intermediateModel && intermediateModel !== primaryModel && intermediateModel !== fallbackModel) {
        try {
          if (onFallbackTriggered) {
            onFallbackTriggered(primaryModel, intermediateModel, primaryErr.message)
          }
          const intermediateOpts = { ...(runtimeOpts || {}), num_ctx: Math.min(runtimeOpts?.num_ctx || 8192, 8192) }
          logger.log('INFO', 'ResilientModelDispatcher', `Falling back to intermediate [${intermediateModel}] ctx:${intermediateOpts.num_ctx}`)

          const output = await AgentStreamTransport.streamCompletion({
            ...sessionOpts,
            targetModel: intermediateModel,
            runtimeOpts: intermediateOpts,
          })
          return { output, usedModel: intermediateModel, isFallback: true, fallbackReason: primaryErr.message }
        } catch (intermediateErr: any) {
          logger.log('WARN', 'ResilientModelDispatcher', `Intermediate model [${intermediateModel}] failed: ${intermediateErr.message}. Degrading to base fallback...`)
        }
      }

      if (primaryModel === fallbackModel || !fallbackModel) {
        throw primaryErr
      }

      if (onFallbackTriggered) {
        onFallbackTriggered(intermediateModel || primaryModel, fallbackModel, primaryErr.message)
      }

      // 3. Attempt Base Fallback — halve num_ctx to prevent CUDA OOM
      const downgradedOpts = { ...(runtimeOpts || {}), num_ctx: Math.min(runtimeOpts?.num_ctx || 4096, 4096) }
      logger.log('INFO', 'ResilientModelDispatcher', `Initiating fallback to [${fallbackModel}] ctx:${downgradedOpts.num_ctx}`)

      try {
        const output = await AgentStreamTransport.streamCompletion({
          ...sessionOpts,
          targetModel: fallbackModel,
          runtimeOpts: downgradedOpts,
        })
        return { output, usedModel: fallbackModel, isFallback: true, fallbackReason: primaryErr.message }
      } catch (fallbackErr: any) {
        // 4. Escalate to Heavy Tier if all other tiers exhausted
        if (heavyEscalationModel && heavyEscalationModel !== fallbackModel) {
          return this.escalateToHeavyTier(
            heavyEscalationModel,
            sessionOpts,
            runtimeOpts,
            fallbackErr.message,
            onFallbackTriggered
          )
        }
        throw fallbackErr
      }
    }
  }

  /**
   * Escalates to a heavy model tier (14B+) after proactively evicting all other models from VRAM.
   * Only invoked when all lighter tiers have exhausted their retry budget.
   */
  public static async escalateToHeavyTier(
    heavyModel: string,
    sessionOpts: Omit<StreamSession, 'targetModel' | 'runtimeOpts'>,
    runtimeOpts: OllamaRuntimeOptions,
    escalationReason: string,
    onEscalationTriggered?: (fromModel: string, toModel: string, reason: string) => void
  ): Promise<DispatchedCompletionResult> {
    logger.log('INFO', 'ResilientModelDispatcher', `Escalating to heavy tier [${heavyModel}] — triggering VRAM eviction first.`)

    const ollamaHost = (sessionOpts as any).ollamaEndpoint || 'http://127.0.0.1:11434'
    await evictModelsFromVram(['*'], ollamaHost)

    if (onEscalationTriggered) {
      onEscalationTriggered('fallback', heavyModel, escalationReason)
    }

    // For heavy tier, use conservative num_ctx to fit within available VRAM post-eviction
    const heavyOpts = { ...(runtimeOpts || {}), num_ctx: Math.min(runtimeOpts?.num_ctx || 8192, 8192) }

    const output = await AgentStreamTransport.streamCompletion({
      ...sessionOpts,
      targetModel: heavyModel,
      runtimeOpts: heavyOpts,
    })

    return {
      output,
      usedModel: heavyModel,
      isFallback: true,
      isEscalated: true,
      fallbackReason: escalationReason,
    }
  }
}
