import { describe, it, expect } from 'vitest'
import { formatPromptForDisplay } from './promptFormatter'

describe('promptFormatter Unit Tests', () => {
  it('should return empty string for null, undefined, or empty string', () => {
    expect(formatPromptForDisplay(null)).toBe('')
    expect(formatPromptForDisplay(undefined)).toBe('')
    expect(formatPromptForDisplay('')).toBe('')
    expect(formatPromptForDisplay('   ')).toBe('')
  })

  it('should preserve multi-line prompts as-is without changing words', () => {
    const multiLine = 'First line\nSecond line\n  - Indented item'
    expect(formatPromptForDisplay(multiLine)).toBe('First line\nSecond line\n  - Indented item')
  })

  it('should format single-line prompt with numbered items onto newlines', () => {
    const input = '1. Create UI component 2. Add validation logic 3. Run unit tests'
    const expected = '1. Create UI component\n2. Add validation logic\n3. Run unit tests'
    expect(formatPromptForDisplay(input)).toBe(expected)
  })

  it('should format single-line prompt with bullet points onto newlines', () => {
    const input = 'Implement features: - Fix memory leak - Improve latency - Add logging'
    const expected = 'Implement features:\n- Fix memory leak\n- Improve latency\n- Add logging'
    expect(formatPromptForDisplay(input)).toBe(expected)
  })

  it('should format single-line prompt with unicode bullet points onto newlines', () => {
    const input = 'Checklist: • Step one • Step two • Step three'
    const expected = 'Checklist:\n• Step one\n• Step two\n• Step three'
    expect(formatPromptForDisplay(input)).toBe(expected)
  })

  it('should format single-line prompt with Step / Passo markers onto newlines', () => {
    const input = 'Piano: Step 1: Analisi codebase Step 2: Modifica file Step 3: Verifica build'
    const expected = 'Piano:\nStep 1: Analisi codebase\nStep 2: Modifica file\nStep 3: Verifica build'
    expect(formatPromptForDisplay(input)).toBe(expected)
  })

  it('should NOT alter or remove any words or tokens', () => {
    const input = 'Crea un pulsante per il login 1. usa Tailwind 2. aggiungi stato di loading'
    const output = formatPromptForDisplay(input)
    // All original words should be present in order
    const wordsInput = input.split(/\s+/).join(' ')
    const wordsOutput = output.split(/\s+/).join(' ')
    expect(wordsOutput).toBe(wordsInput)
  })

  it('should not break decimal numbers or version tags', () => {
    const input = 'Upgrade package to v1.2.3 and set ratio to 3.14 for precision'
    expect(formatPromptForDisplay(input)).toBe('Upgrade package to v1.2.3 and set ratio to 3.14 for precision')
  })
})
