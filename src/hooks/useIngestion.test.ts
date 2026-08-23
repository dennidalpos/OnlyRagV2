import { describe, it, expect } from 'vitest'
import { getPageLineNumber, getTotalLines, resolveVisionOcrPrompt } from './useIngestion'
import { DEFAULT_IMAGE_ANALYSIS_PROMPT } from '../constants/promptConfig'
import type { AppSettings } from '../types'

describe('useIngestion page line calculation and pagination sync', () => {
  const sampleMarkdown = `# Document Title

## Page 1
First line of page 1.
Second line of page 1.

## Page 2
First line of page 2.
Table line:
| A | B |
|---|---|
| 1 | 2 |

## Page 3
First line of page 3.
`

  it('correctly maps page numbers to 1-based markdown line numbers', () => {
    expect(getPageLineNumber(sampleMarkdown, 1)).toBe(1)
    expect(getPageLineNumber(sampleMarkdown, 2)).toBe(7)
    expect(getPageLineNumber(sampleMarkdown, 3)).toBe(14)
  })

  it('falls back to 1 for invalid or first page', () => {
    expect(getPageLineNumber('', 1)).toBe(1)
    expect(getPageLineNumber(sampleMarkdown, 0)).toBe(1)
    expect(getPageLineNumber(sampleMarkdown, -1)).toBe(1)
  })

  it('supports horizontal rule separator fallback', () => {
    const hrMarkdown = `Section 1 content
---
Section 2 content
---
Section 3 content`

    expect(getPageLineNumber(hrMarkdown, 1)).toBe(1)
    expect(getPageLineNumber(hrMarkdown, 2)).toBe(3)
    expect(getPageLineNumber(hrMarkdown, 3)).toBe(5)
  })

  it('calculates total line count accurately', () => {
    expect(getTotalLines(sampleMarkdown)).toBe(16)
    expect(getTotalLines('')).toBe(1)
  })
})

describe('useIngestion vision OCR engine gate', () => {
  const withEngine = (ocrEngine: AppSettings['ocrEngine']): AppSettings =>
    ({ ocrEngine, customPromptOverrides: {} }) as unknown as AppSettings

  it('sends no prompt while the native CUDA engine is selected', () => {
    expect(resolveVisionOcrPrompt(withEngine('native_cuda'))).toBeUndefined()
    expect(resolveVisionOcrPrompt(undefined)).toBeUndefined()
  })

  it('ships the raw factory template when the Vision LLM engine is selected', () => {
    const prompt = resolveVisionOcrPrompt(withEngine('vision_model'))
    expect(prompt).toBe(DEFAULT_IMAGE_ANALYSIS_PROMPT)
  })

  it('leaves the per-page variables unrendered for the sidecar page loop to fill', () => {
    const prompt = resolveVisionOcrPrompt(withEngine('vision_model')) || ''
    expect(prompt).toContain('{{currentPage}}')
    expect(prompt).toContain('{{numPages}}')
    expect(prompt).toContain('{{activePageContent}}')
  })

  it('prefers a user override of the images:analysis node', () => {
    const settings = {
      ocrEngine: 'vision_model',
      customPromptOverrides: { 'images:analysis': 'Transcribe page {{currentPage}} verbatim.' },
    } as unknown as AppSettings
    expect(resolveVisionOcrPrompt(settings)).toBe('Transcribe page {{currentPage}} verbatim.')
  })
})
