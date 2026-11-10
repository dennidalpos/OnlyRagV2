import { describe, it, expect } from 'vitest'
import { normalizeError } from './errorNormalizer'
import { ErrorCategory } from './appError'

describe('errorNormalizer & appError', () => {
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
})
