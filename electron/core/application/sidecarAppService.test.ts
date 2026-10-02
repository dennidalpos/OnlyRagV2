import { afterEach, describe, it, expect, vi } from 'vitest'
import { normalizeIngestedFileType, sidecarAppService } from './sidecarAppService'
import { sidecarHttpClient } from '../infrastructure/http/sidecarHttpClient'
import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import { appSettingsRepository } from '../infrastructure/filesystem/appSettingsRepository'
import { taskRunner } from '../infrastructure/process/taskRunner'

afterEach(() => vi.restoreAllMocks())

it('carries a failed normalization review through the application result and closes its task', async () => {
  const review = { originalMarkdown: '# Original\n\nAB123 retained.', issues: [{ page: 1, reason: 'truncated' as const }] }
  vi.spyOn(documentIoRepository, 'exists').mockReturnValue(true)
  vi.spyOn(appSettingsRepository, 'loadSettings').mockResolvedValue(null)
  vi.spyOn(sidecarHttpClient, 'ingestFileStream').mockResolvedValue({ success: false, error: 'Review required', normalizationReview: review })
  const unregister = vi.spyOn(taskRunner, 'unregisterActiveTask').mockImplementation(() => {})
  const result = await sidecarAppService.ingestFile('C:/fixtures/review.pdf', undefined, undefined, true, 'normalizer-fixture', undefined, 'review-task')
  expect(result).toEqual({ success: false, error: 'Review required', normalizationReview: review })
  expect(unregister).toHaveBeenCalledWith('review-task')
})

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
