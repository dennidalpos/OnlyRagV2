/**
 * Centralized Error Domain Types & AppError Definition for OnlyRag V2
 */

export enum ErrorCategory {
  AI_OLLAMA = 'AI_OLLAMA',
  VECTOR_DB = 'VECTOR_DB',
  WORKSPACE_IO = 'WORKSPACE_IO',
  AGENT_POLICY = 'AGENT_POLICY',
  NETWORK_HTTP = 'NETWORK_HTTP',
  SYSTEM_RESOURCES = 'SYSTEM_RESOURCES',
  UNKNOWN = 'UNKNOWN',
}

export interface NormalizedError {
  category: ErrorCategory
  title: string
  message: string
  remediation?: string
  technicalDetails?: string
  isFatal?: boolean
  code?: string | number
}

export interface AppErrorOptions {
  remediation?: string
  technicalDetails?: string
  isFatal?: boolean
  code?: string | number
  cause?: unknown
}

export class AppError extends Error {
  public readonly category: ErrorCategory
  public readonly remediation?: string
  public readonly technicalDetails?: string
  public readonly isFatal: boolean
  public readonly code?: string | number

  constructor(category: ErrorCategory, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = 'AppError'
    this.category = category
    this.remediation = options.remediation
    this.technicalDetails = options.technicalDetails
    this.isFatal = options.isFatal ?? false
    this.code = options.code

    // Restore prototype chain
    Object.setPrototypeOf(this, new.target.prototype)
  }

  public toNormalized(): NormalizedError {
    return {
      category: this.category,
      title: getCategoryTitle(this.category),
      message: this.message,
      remediation: this.remediation,
      technicalDetails: this.technicalDetails,
      isFatal: this.isFatal,
      code: this.code,
    }
  }
}

export function getCategoryTitle(category: ErrorCategory): string {
  switch (category) {
    case ErrorCategory.AI_OLLAMA:
      return 'Ollama AI Runtime'
    case ErrorCategory.VECTOR_DB:
      return 'LanceDB Vector Store'
    case ErrorCategory.WORKSPACE_IO:
      return 'File & Workspace I/O'
    case ErrorCategory.AGENT_POLICY:
      return 'Security & Agent Policy'
    case ErrorCategory.NETWORK_HTTP:
      return 'Network & HTTP'
    case ErrorCategory.SYSTEM_RESOURCES:
      return 'System Resources & Memory'
    case ErrorCategory.UNKNOWN:
    default:
      return 'Application Error'
  }
}
