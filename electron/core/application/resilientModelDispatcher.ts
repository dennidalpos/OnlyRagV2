import { AgentStreamTransport, StreamSession } from '../infrastructure/http/agentStreamTransport'
import { logger } from '../../diagnostics'

export interface ModelDispatchPlan {
  primaryModel: string
  fallbackModel: string
  runtimeOpts: any
}

export interface DispatchedCompletionResult {
  output: string
  usedModel: string
  isFallback: boolean
  fallbackReason?: string
}

/**
 * Manages resilient LLM streaming with graceful degradation across model tiers and context budgets.
 */
export class ResilientModelDispatcher {
  /**
   * Executes streaming with the primary model, automatically falling back to secondary model on failure.
   */
  public static async executeWithFallback(
    plan: ModelDispatchPlan,
    sessionOpts: Omit<StreamSession, 'targetModel' | 'runtimeOpts'>,
    onFallbackTriggered?: (fromModel: string, toModel: string, reason: string) => void
  ): Promise<DispatchedCompletionResult> {
    const { primaryModel, fallbackModel, runtimeOpts } = plan

    try {
      const output = await AgentStreamTransport.streamCompletion({
        ...sessionOpts,
        targetModel: primaryModel,
        runtimeOpts,
      })

      return {
        output,
        usedModel: primaryModel,
        isFallback: false,
      }
    } catch (primaryErr: any) {
      logger.log(
        'WARN',
        'ResilientModelDispatcher',
        `Primary model [${primaryModel}] execution failed: ${primaryErr.message}. Evaluating fallback...`
      )

      if (primaryModel === fallbackModel || !fallbackModel) {
        throw primaryErr
      }

      if (onFallbackTriggered) {
        onFallbackTriggered(primaryModel, fallbackModel, primaryErr.message)
      }

      // Halve num_ctx on fallback to prevent memory thrashing / CUDA OOM
      const downgradedRuntimeOpts = {
        ...runtimeOpts,
        num_ctx: Math.min(runtimeOpts.num_ctx || 4096, 4096),
      }

      logger.log(
        'INFO',
        'ResilientModelDispatcher',
        `Initiating fallback stream to [${fallbackModel}] with num_ctx: ${downgradedRuntimeOpts.num_ctx}`
      )

      const fallbackOutput = await AgentStreamTransport.streamCompletion({
        ...sessionOpts,
        targetModel: fallbackModel,
        runtimeOpts: downgradedRuntimeOpts,
      })

      return {
        output: fallbackOutput,
        usedModel: fallbackModel,
        isFallback: true,
        fallbackReason: primaryErr.message,
      }
    }
  }
}
