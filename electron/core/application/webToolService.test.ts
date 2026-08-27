import { describe, expect, it, vi } from 'vitest'
import { WebToolService } from './webToolService'

describe('WebToolService download_file', () => {
  it('rejects a destination outside the workspace before the gateway runs', async () => {
    const downloadFile = vi.fn()
    const service = new WebToolService({ downloadFile, recordBeforeModification: vi.fn() })

    const result = await service.executeDownloadFile(
      { url: 'https://example.test/file.zip', filePath: '..\\outside.zip' },
      'C:\\workspace', true, undefined,
    )

    expect(result.outputForHistory).toContain('Security Violation')
    expect(downloadFile).not.toHaveBeenCalled()
  })

  it('records the target before download and returns provenance for a successful artifact', async () => {
    const downloadFile = vi.fn(async () => ({ success: true, downloadedBytes: 12 }))
    const recordBeforeModification = vi.fn()
    const service = new WebToolService({
      downloadFile,
      recordBeforeModification,
      hashFile: () => 'a'.repeat(64),
    })
    const signal = new AbortController().signal

    const result = await service.executeDownloadFile(
      { url: 'https://example.test/file.zip', filePath: 'dist/file.zip' },
      'C:\\workspace', true, signal,
    )

    expect(recordBeforeModification).toHaveBeenCalledWith('C:\\workspace\\dist\\file.zip')
    expect(downloadFile).toHaveBeenCalledWith(
      'https://example.test/file.zip', 'C:\\workspace\\dist\\file.zip', 'C:\\workspace', signal,
    )
    expect(result.outputForHistory).toContain('Successfully downloaded 12 bytes')
    expect(result.outputForHistory).toContain(`Provenance SHA-256: ${'a'.repeat(64)}`)
    expect(result.logDetail).toContain('SHA-256:')
  })

  it('preserves download failures without claiming an artifact was produced', async () => {
    const service = new WebToolService({
      downloadFile: vi.fn(async () => ({ success: false, error: 'MIME type is not allowed' })),
      recordBeforeModification: vi.fn(),
      hashFile: vi.fn(),
    })

    const result = await service.executeDownloadFile(
      { url: 'https://example.test/file.zip', filePath: 'file.zip' },
      'C:\\workspace', true, undefined,
    )

    expect(result.outputForHistory).toContain('Download failed')
    expect(result.outputForHistory).toContain('MIME type is not allowed')
    expect(result.outputForHistory).not.toContain('Provenance SHA-256')
  })
})
