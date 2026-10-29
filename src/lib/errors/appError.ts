/**
 * Error categories and the normalized error shape shown by the Renderer.
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
