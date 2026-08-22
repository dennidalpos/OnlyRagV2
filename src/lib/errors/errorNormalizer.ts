/**
 * Universal Error Normalizer for OnlyRag V2
 * Converts raw IPC, Node.js, Python sidecar, Ollama, and DOM errors into clean NormalizedError objects.
 */

import stripAnsi from 'strip-ansi'
import { AppError, ErrorCategory, getCategoryTitle, NormalizedError } from './appError'

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
    message: `${prefix}${classified.message || cleanMessage || 'Si è verificato un errore imprevisto.'}`,
    remediation: classified.remediation,
    technicalDetails: technicalDetails || classified.technicalDetails,
    isFatal: classified.isFatal ?? false,
    code: classified.code,
  }
}

/**
 * Extracts a user-facing concise message suitable for alerts or toasts
 */
export function toUserFriendlyMessage(err: unknown, context?: string): string {
  const normalized = normalizeError(err, context)
  if (normalized.remediation) {
    return `${normalized.message} — ${normalized.remediation}`
  }
  return normalized.message
}

/**
 * Checks if the error is fatal and requires reload or user intervention
 */
export function isFatalError(err: unknown): boolean {
  if (err instanceof AppError) {
    return err.isFatal
  }
  const normalized = normalizeError(err)
  return Boolean(normalized.isFatal)
}

/**
 * Extracts raw error message from various error formats
 */
function extractRawErrorMessage(err: unknown): string {
  if (!err) {
    return 'Unknown error'
  }
  if (typeof err === 'string') {
    return err
  }
  if (err instanceof Error) {
    return err.message
  }
  if (typeof err === 'object') {
    const record = err as Record<string, unknown>
    if (typeof record.message === 'string') return record.message
    if (typeof record.error === 'string') return record.error
    if (typeof record.detail === 'string') return record.detail
    if (typeof record.statusText === 'string') return record.statusText
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err)
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
      title: 'Ollama Server Non Raggiungibile',
      message: 'Impossibile connettersi al server Ollama locale (porta 11434).',
      remediation: 'Assicurati che Ollama sia installato e avviato in locale.',
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
      title: 'Memoria VRAM / RAM Esaurita',
      message: 'Risorse di memoria insufficienti per completare l’elaborazione del modello.',
      remediation: 'Riduci la finestra di contesto o seleziona un modello con tier di complessità inferiore.',
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
      title: 'Blocco di Sicurezza Agente',
      message: message || 'Comando o percorso bloccato per criteri di sicurezza.',
      remediation: 'L’operazione viola le policy di sandboxing e sicurezza del workspace.',
      isFatal: false,
    }
  }

  // 4. Node / File System I/O Errors (ENOENT, EACCES, EPERM, EBUSY)
  if (lower.includes('enoent') || lower.includes('no such file or directory')) {
    return {
      category: ErrorCategory.WORKSPACE_IO,
      title: 'File o Cartella Non Trovata',
      message: 'Il percorso specificato non esiste nel workspace.',
      remediation: 'Verifica che il file o la directory esista e non sia stata rimossa.',
      code: 'ENOENT',
    }
  }

  if (lower.includes('eacces') || lower.includes('eperm') || lower.includes('permission denied')) {
    return {
      category: ErrorCategory.WORKSPACE_IO,
      title: 'Permesso Negato',
      message: 'Permessi insufficienti per accedere al file o alla risorsa.',
      remediation: 'Verifica i permessi di lettura/scrittura nel filesystem del sistema operativo.',
      code: 'EACCES',
    }
  }

  if (lower.includes('ebusy') || lower.includes('resource busy or locked')) {
    return {
      category: ErrorCategory.WORKSPACE_IO,
      title: 'Risorsa Bloccata',
      message: 'Il file è utilizzato o bloccato da un altro processo.',
      remediation: 'Chiudi eventuali editor o processi concorrenti che tengono il file aperto.',
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
      title: 'Errore Database Vettoriale LanceDB',
      message: message,
      remediation: 'Verifica che il sidecar Python sia attivo e riavvialo se necessario dal pannello Diagnostica.',
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
      title: 'Errore di Rete / Connessione',
      message: message,
      remediation: 'Verifica la connessione di rete e lo stato del server di destinazione.',
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
