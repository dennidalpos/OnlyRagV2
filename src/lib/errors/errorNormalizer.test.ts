import { describe, it, expect, beforeEach, vi } from 'vitest'
import { normalizeError, toUserFriendlyMessage, isFatalError } from './errorNormalizer'
import { AppError, ErrorCategory } from './appError'
import { notifyError, clearErrorDeduplicationCache } from './errorNotifier'

describe('errorNormalizer & appError', () => {
  beforeEach(() => {
    clearErrorDeduplicationCache()
  })

  it('normalizes an AppError directly without reclassification', () => {
    const appErr = new AppError(ErrorCategory.VECTOR_DB, 'Custom vector failure', {
      remediation: 'Restart the sidecar.',
      isFatal: true,
      code: 'VECTOR_ERR_42',
    })

    const normalized = normalizeError(appErr)
    expect(normalized.category).toBe(ErrorCategory.VECTOR_DB)
    expect(normalized.title).toBe('LanceDB Vector Store')
    expect(normalized.message).toBe('Custom vector failure')
    expect(normalized.remediation).toBe('Restart the sidecar.')
    expect(normalized.isFatal).toBe(true)
    expect(normalized.code).toBe('VECTOR_ERR_42')
  })

  it('detects Ollama connection refused and attaches remediation', () => {
    const raw = new Error('fetch failed: connect ECONNREFUSED 127.0.0.1:11434')
    const normalized = normalizeError(raw)

    expect(normalized.category).toBe(ErrorCategory.AI_OLLAMA)
    expect(normalized.title).toBe('Ollama Server Non Raggiungibile')
    expect(normalized.message).toContain('Impossibile connettersi al server Ollama locale')
    expect(normalized.remediation).toBe('Assicurati che Ollama sia installato e avviato in locale.')
  })

  it('detects CUDA Out Of Memory errors and suggests smaller models', () => {
    const raw = 'RuntimeError: CUDA out of memory. Tried to allocate 2.40 GiB'
    const normalized = normalizeError(raw)

    expect(normalized.category).toBe(ErrorCategory.SYSTEM_RESOURCES)
    expect(normalized.title).toBe('Memoria VRAM / RAM Esaurita')
    expect(normalized.remediation).toContain('Riduci la finestra di contesto')
  })

  it('detects security guardrail violations', () => {
    const raw = 'Command blocked by security guardrails: rm -rf /'
    const normalized = normalizeError(raw)

    expect(normalized.category).toBe(ErrorCategory.AGENT_POLICY)
    expect(normalized.title).toBe('Blocco di Sicurezza Agente')
    expect(normalized.remediation).toContain('viola le policy di sandboxing')
  })

  it('detects filesystem error codes (ENOENT, EACCES, EBUSY)', () => {
    const enoent = new Error('ENOENT: no such file or directory, open D:\\project\\src\\main.ts')
    const normalizedEnoent = normalizeError(enoent)
    expect(normalizedEnoent.category).toBe(ErrorCategory.WORKSPACE_IO)
    expect(normalizedEnoent.code).toBe('ENOENT')

    const eacces = new Error('EACCES: permission denied, write D:\\protected\\file.txt')
    const normalizedEacces = normalizeError(eacces)
    expect(normalizedEacces.category).toBe(ErrorCategory.WORKSPACE_IO)
    expect(normalizedEacces.code).toBe('EACCES')

    const ebusy = new Error('EBUSY: resource busy or locked')
    const normalizedEbusy = normalizeError(ebusy)
    expect(normalizedEbusy.category).toBe(ErrorCategory.WORKSPACE_IO)
    expect(normalizedEbusy.code).toBe('EBUSY')
  })

  it('detects LanceDB vector store errors', () => {
    const raw = new Error('LanceDB table not found in sidecar database')
    const normalized = normalizeError(raw)
    expect(normalized.category).toBe(ErrorCategory.VECTOR_DB)
    expect(normalized.remediation).toContain('sidecar Python')
  })

  it('strips ANSI escape codes from terminal or CLI errors', () => {
    const ansiError = '\u001b[31mError:\u001b[39m \u001b[1mFailed to compile\u001b[22m'
    const normalized = normalizeError(ansiError)
    expect(normalized.message).toBe('Error: Failed to compile')
  })

  it('formats user friendly message with remediation', () => {
    const raw = new Error('connect ECONNREFUSED 127.0.0.1:11434')
    const friendly = toUserFriendlyMessage(raw)
    expect(friendly).toContain('— Assicurati che Ollama sia installato')
  })

  it('checks isFatalError correctly', () => {
    expect(isFatalError('Random warning')).toBe(false)

    const fatalAppError = new AppError(ErrorCategory.WORKSPACE_IO, 'Fatal workspace corruption', {
      isFatal: true,
    })
    expect(isFatalError(fatalAppError)).toBe(true)
  })

  it('deduplicates rapid notifications within 3000ms window', () => {
    const toastFn = vi.fn()
    const errorMsg = 'Repeated network connection error'

    // First call: should trigger toast
    notifyError(errorMsg, toastFn)
    expect(toastFn).toHaveBeenCalledTimes(1)

    // Second call immediately with same error: should be suppressed
    notifyError(errorMsg, toastFn)
    expect(toastFn).toHaveBeenCalledTimes(1)

    // Different error: should trigger toast
    notifyError('Another distinct error', toastFn)
    expect(toastFn).toHaveBeenCalledTimes(2)
  })
})
