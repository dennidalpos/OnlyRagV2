/**
 * Universal Error Normalizer for OnlyRag V2
 * Converts raw IPC, Node.js, Python sidecar, Ollama, and DOM errors into clean NormalizedError objects.
 */

import stripAnsi from 'strip-ansi'
import { AppError, ErrorCategory, getCategoryTitle, NormalizedError } from './appError'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'
import { translate } from '../../i18n/I18nContext'

export { AppError, ErrorCategory, type NormalizedError }

/**
 * Normalizes any error object, string, or IPC rejection into a typed NormalizedError
 */
export function normalizeError(err: unknown, context?: string): NormalizedError {
  // If it's already an AppError, return its normalized form directly
  if (err instanceof AppError) {
    return err.toNormalized()
  }

  // Extract raw string message
  const rawMessage = extractRawErrorMessage(err)
  const cleanMessage = stripAnsi(rawMessage).trim()

  // Extract technical stack or details if available
  const technicalDetails = extractTechnicalDetails(err)

  // Pattern detection for category and remediations
  const classified = classifyError(cleanMessage, err)

  const prefix = context ? `[${context}] ` : ''

  return {
    category: classified.category,
    title: classified.title || getCategoryTitle(classified.category),
    message: `${prefix}${classified.message || cleanMessage || translate('errors.unexpected')}`,
    remediation: classified.remediation,
    technicalDetails: technicalDetails || classified.technicalDetails,
    isFatal: classified.isFatal ?? false,
    code: classified.code,
  }
}

/**
 * Extracts raw error message from various error formats
 */
function extractRawErrorMessage(err: unknown): string {
  return errorMessage(err)
}

/**
 * Extracts stack trace or nested error details
 */
function extractTechnicalDetails(err: unknown): string | undefined {
  if (err instanceof Error && err.stack) {
    return stripAnsi(err.stack)
  }
  return undefined
}

interface ClassifiedError {
  category: ErrorCategory
  title?: string
  message?: string
  remediation?: string
  technicalDetails?: string
  isFatal?: boolean
  code?: string | number
}

/**
 * Deterministic error classification and remediation recommendation
 */
function classifyError(message: string, rawErr: unknown): ClassifiedError {
  const lower = message.toLowerCase()

  // 1. Ollama Connection & Server Failures
  if (
    lower.includes('11434') ||
    lower.includes('econnrefused 127.0.0.1:11434') ||
    lower.includes('econnrefused localhost:11434') ||
    lower.includes('ollama is not running') ||
    lower.includes('failed to fetch') ||
    (lower.includes('ollama') && (lower.includes('offline') || lower.includes('connection refused') || lower.includes('unreachable')))
  ) {
    return {
      category: ErrorCategory.AI_OLLAMA,
      title: translate('errors.ollamaTitle'),
      message: translate('errors.ollamaMessage'),
      remediation: translate('errors.ollamaRemediation'),
      isFatal: false,
    }
  }

  // 2. Memory / VRAM / CUDA Out of Memory
  if (
    lower.includes('cuda out of memory') ||
    lower.includes('out of memory') ||
    lower.includes('not enough memory') ||
    lower.includes('vram allocation failed') ||
    lower.includes('failed to allocate')
  ) {
    return {
      category: ErrorCategory.SYSTEM_RESOURCES,
      title: translate('errors.memoryTitle'),
      message: translate('errors.memoryMessage'),
      remediation: translate('errors.memoryRemediation'),
      isFatal: false,
    }
  }

  // 3. Security Guardrails & Policy Blocks
  if (
    lower.includes('security guardrail') ||
    lower.includes('blocked by security') ||
    lower.includes('comando non consentito') ||
    lower.includes('directory traversal') ||
    lower.includes('forbidden path') ||
    lower.includes('command blocked')
  ) {
    return {
      category: ErrorCategory.AGENT_POLICY,
      title: translate('errors.securityTitle'),
      message: message || translate('errors.securityMessage'),
      remediation: translate('errors.securityRemediation'),
      isFatal: false,
    }
  }

  // 4. Node / File System I/O Errors (ENOENT, EACCES, EPERM, EBUSY)
  if (lower.includes('enoent') || lower.includes('no such file or directory')) {
    return {
      category: ErrorCategory.WORKSPACE_IO,
      title: translate('errors.notFoundTitle'),
      message: translate('errors.notFoundMessage'),
      remediation: translate('errors.notFoundRemediation'),
      code: 'ENOENT',
    }
  }

  if (lower.includes('eacces') || lower.includes('eperm') || lower.includes('permission denied')) {
    return {
      category: ErrorCategory.WORKSPACE_IO,
      title: translate('errors.permissionTitle'),
      message: translate('errors.permissionMessage'),
      remediation: translate('errors.permissionRemediation'),
      code: 'EACCES',
    }
  }

  if (lower.includes('ebusy') || lower.includes('resource busy or locked')) {
    return {
      category: ErrorCategory.WORKSPACE_IO,
      title: translate('errors.busyTitle'),
      message: translate('errors.busyMessage'),
      remediation: translate('errors.busyRemediation'),
      code: 'EBUSY',
    }
  }

  // 5. LanceDB / Vector Sidecar
  if (
    lower.includes('lancedb') ||
    lower.includes('vector store') ||
    lower.includes('table not found') ||
    lower.includes('embedding dimension mismatch') ||
    lower.includes('sidecar')
  ) {
    return {
      category: ErrorCategory.VECTOR_DB,
      title: translate('errors.vectorTitle'),
      message: message,
      remediation: translate('errors.vectorRemediation'),
    }
  }

  // 6. Network & HTTP Timeout
  if (
    lower.includes('etimedout') ||
    lower.includes('enotfound') ||
    lower.includes('network request failed') ||
    lower.includes('http 50') ||
    lower.includes('http 40')
  ) {
    return {
      category: ErrorCategory.NETWORK_HTTP,
      title: translate('errors.networkTitle'),
      message: message,
      remediation: translate('errors.networkRemediation'),
    }
  }

  // 7. Check for raw code property
  if (typeof rawErr === 'object' && rawErr !== null && 'code' in rawErr) {
    const code = String((rawErr as { code: unknown }).code)
    return {
      category: ErrorCategory.WORKSPACE_IO,
      message,
      code,
    }
  }

  // Fallback
  return {
    category: ErrorCategory.UNKNOWN,
    message,
  }
}
