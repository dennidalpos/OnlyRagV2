import { describe, it, expect } from 'vitest'
import { normalizeIngestedFileType } from './sidecarAppService'

describe('ingested file type normalization', () => {
  it('preserves DOCX eligibility from authoritative sidecar metadata', () => {
    expect(normalizeIngestedFileType('docx', 'renamed-without-extension')).toBe('docx')
    expect(normalizeIngestedFileType('pdf', 'report.bin')).toBe('pdf')
  })

  it('falls back to the filename for older records and groups image formats', () => {
    expect(normalizeIngestedFileType(undefined, 'contract.docx')).toBe('docx')
    expect(normalizeIngestedFileType('png', 'scan.png')).toBe('image')
    expect(normalizeIngestedFileType('csv', 'data.csv')).toBe('text')
  })
})
