import type { OllamaStructuredRequest } from '../infrastructure/http/ollamaHttpClient'
import {
  recordRecoveryFailure,
  recoveryStopDiagnostic,
  type RecoveryFailureState,
} from '../domain/agent/recoveryBudget'
import { ollamaAppService } from './ollamaAppService'

export type StructuredContentValidation<T> =
  | { status: 'valid'; data: T }
  | { status: 'invalid'; error: string }

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
        const diagnostic = decision.action === 'stop'
          ? recoveryStopDiagnostic('transport', decision.state)
          : 'Structured generation call budget exhausted after 2/2 calls.'
        return { status: 'error', error: `${diagnostic} Last error: ${message}`, attempts: attempt }
      }
      continue
    }
    if (response.status !== 'complete') {
      const message = response.error || `Ollama structured response ${response.status}`
      const decision = recordRecoveryFailure(transportFailure, normalizedSignature('transport', message))
      transportFailure = decision.state
      if (attempt === 2 || decision.action === 'stop') {
        const diagnostic = decision.action === 'stop'
          ? recoveryStopDiagnostic('transport', decision.state)
          : 'Structured generation call budget exhausted after 2/2 calls.'
        return { status: 'error', error: `${diagnostic} Last error: ${message}`, attempts: attempt }
      }
      continue
    }

    const validated = validate(response.content)
    if (validated.status === 'valid') return { status: 'success', data: validated.data, content: response.content, attempts: attempt }

    const decision = recordRecoveryFailure(schemaFailure, normalizedSignature('schema', validated.error))
    schemaFailure = decision.state
    if (attempt === 2 || decision.action === 'stop') {
      const diagnostic = decision.action === 'stop'
        ? recoveryStopDiagnostic('schema', decision.state)
        : 'Structured generation call budget exhausted after 2/2 calls.'
      return { status: 'error', error: `${diagnostic} Last error: ${validated.error}`, attempts: attempt }
    }
    currentRequest = {
      ...request,
      userContent: correctionPayload(request.userContent, response.content, validated.error),
    }
  }

  return { status: 'error', error: 'Structured generation recovery ended without a result.', attempts: 2 }
}
