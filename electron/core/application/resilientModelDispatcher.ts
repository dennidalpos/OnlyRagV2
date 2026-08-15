import { AgentStreamTransport, StreamSession } from '../infrastructure/http/agentStreamTransport'
import { logger } from '../../diagnostics'
import type { OllamaRuntimeOptions } from '../domain/agent/hardwareProfileResolver'

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
  for (const modelName of modelsToEvict) {
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
