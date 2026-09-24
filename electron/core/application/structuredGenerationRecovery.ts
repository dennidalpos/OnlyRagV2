import type { OllamaStructuredRequest } from '../infrastructure/http/ollamaHttpClient'
import { recordRecoveryFailure, recoveryStopDiagnostic, type RecoveryFailureState } from '../domain/agent/recoveryBudget'
import { ollamaAppService } from './ollamaAppService'
import { calculateAvailableOutputTokens } from '../../../shared/domain/agent/contextWindowCalculator'
import { logger } from '../infrastructure/logging/logger'

export type StructuredContentValidation<T> = { status: 'valid'; data: T } | { status: 'invalid'; error: string }

export type RecoveredStructuredResult<T> =
  | { status: 'success'; data: T; content: string; attempts: number }
  | { status: 'error'; error: string; attempts: number }

function normalizedSignature(kind: 'transport' | 'schema', message: string): string {
  return `${kind}:${message.toLowerCase().replace(/\d+/g, '#').slice(0, 240)}`
}

function correctionPayload(userContent: string, previousResponse: string, validationError: string): string {
  let source: unknown = userContent
  try {
    source = JSON.parse(userContent)
  } catch {}
  return JSON.stringify({
    input: source,
    schemaCorrection: {
      validationError,
      previousResponse,
      instruction: 'Return one corrected response matching the requested JSON schema.',
    },
  })
}

function maximumStructuredOutput(request: OllamaStructuredRequest): number | undefined {
  const numCtx = request.options?.num_ctx
  if (!numCtx) return undefined
  return calculateAvailableOutputTokens(`${request.systemPrompt}\n${request.userContent}`, numCtx)
}

function withMaximumStructuredOutput(request: OllamaStructuredRequest): OllamaStructuredRequest {
  const numPredict = maximumStructuredOutput(request)
  return numPredict === undefined ? request : { ...request, options: { ...request.options, num_predict: numPredict } }
}

/**
 * What an invalid structured response looked like, bounded: why the model stopped, how much it
 * thought and wrote, and the edges of the text. "Response is not valid JSON" alone could not tell
 * truncation from prose from an empty reply (gpt-oss:20b planning failure, 2026-09-24).
 */
export function describeInvalidStructuredResponse(
  model: string,
  attempt: number,
  response: { content: string; doneReason?: string; evalCount?: number; promptEvalCount?: number; thinkingChars?: number },
  request: Pick<OllamaStructuredRequest, 'options' | 'think'>,
  validationError: string,
): string {
  const content = response.content || ''
  const edge = (text: string) => JSON.stringify(text.replace(/\s+/g, ' '))
  return [
    `Invalid structured response from ${model} (call ${attempt}/2): ${validationError}`,
    `done_reason=${response.doneReason ?? 'unknown'}`,
    `prompt_tokens=${response.promptEvalCount ?? '?'}`,
    `output_tokens=${response.evalCount ?? '?'}`,
    `num_predict=${request.options?.num_predict ?? 'default'}`,
    `think=${String(request.think ?? false)}`,
    `thinking_chars=${response.thinkingChars ?? 0}`,
    `content_chars=${content.length}`,
    `head=${edge(content.slice(0, 160))}`,
    `tail=${edge(content.slice(-160))}`,
  ].join(' | ')
}

/** Shares one two-call ceiling across transport and schema recovery. */
export async function generateStructuredWithRecovery<T>(
  request: OllamaStructuredRequest,
  validate: (content: string) => StructuredContentValidation<T>,
): Promise<RecoveredStructuredResult<T>> {
  let currentRequest = request
  let transportFailure: RecoveryFailureState | undefined
  let schemaFailure: RecoveryFailureState | undefined

  for (let attempt = 1; attempt <= 2; attempt++) {
    let response
    try {
      response = await ollamaAppService.generateStructured(currentRequest)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const decision = recordRecoveryFailure(transportFailure, normalizedSignature('transport', message))
      transportFailure = decision.state
      if (attempt === 2 || decision.action === 'stop') {
        const diagnostic =
          decision.action === 'stop' ? recoveryStopDiagnostic('transport', decision.state) : 'Structured generation call budget exhausted after 2/2 calls.'
        return { status: 'error', error: `${diagnostic} Last error: ${message}`, attempts: attempt }
      }
      continue
    }
    if (response.status === 'incomplete') {
      const message = response.error || `Ollama structured response ${response.status}`
      const maximumOutput = maximumStructuredOutput(currentRequest)
      const currentOutput = currentRequest.options?.num_predict || 0
      const stoppedForLength = response.doneReason === 'length' || /incomplete \(length/i.test(message)
      if (stoppedForLength) {
        if (attempt < 2 && maximumOutput !== undefined && maximumOutput > currentOutput) {
          currentRequest = {
            ...currentRequest,
            options: { ...currentRequest.options, num_predict: maximumOutput },
          }
          continue
        }
        return {
          status: 'error',
          error: `Structured response exhausted the configured context window after ${attempt}/2 call(s); no larger output budget is available. Last error: ${message}`,
          attempts: attempt,
        }
      }
      const decision = recordRecoveryFailure(transportFailure, normalizedSignature('transport', message))
      transportFailure = decision.state
      if (attempt === 2 || decision.action === 'stop') {
        const diagnostic =
          decision.action === 'stop' ? recoveryStopDiagnostic('transport', decision.state) : 'Structured generation call budget exhausted after 2/2 calls.'
        return { status: 'error', error: `${diagnostic} Last error: ${message}`, attempts: attempt }
      }
      continue
    }
    if (response.status !== 'complete') {
      const message = response.error || `Ollama structured response ${response.status}`
      const decision = recordRecoveryFailure(transportFailure, normalizedSignature('transport', message))
      transportFailure = decision.state
      if (attempt === 2 || decision.action === 'stop') {
        const diagnostic =
          decision.action === 'stop' ? recoveryStopDiagnostic('transport', decision.state) : 'Structured generation call budget exhausted after 2/2 calls.'
        return { status: 'error', error: `${diagnostic} Last error: ${message}`, attempts: attempt }
      }
      continue
    }

    const validated = validate(response.content)
    if (validated.status === 'valid') return { status: 'success', data: validated.data, content: response.content, attempts: attempt }
    logger.log('WARN', 'StructuredGeneration', describeInvalidStructuredResponse(request.model, attempt, response, currentRequest, validated.error))

    const decision = recordRecoveryFailure(schemaFailure, normalizedSignature('schema', validated.error))
    schemaFailure = decision.state
    if (attempt === 2 || decision.action === 'stop') {
      const diagnostic =
        decision.action === 'stop' ? recoveryStopDiagnostic('schema', decision.state) : 'Structured generation call budget exhausted after 2/2 calls.'
      return { status: 'error', error: `${diagnostic} Last error: ${validated.error}`, attempts: attempt }
    }
    currentRequest = withMaximumStructuredOutput({
      ...request,
      userContent: correctionPayload(request.userContent, response.content, validated.error),
    })
  }

  return { status: 'error', error: 'Structured generation recovery ended without a result.', attempts: 2 }
}
