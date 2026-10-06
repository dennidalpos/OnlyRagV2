import { afterEach, describe, it, expect, vi } from 'vitest'
import { normalizeIngestedFileType, sidecarAppService } from './sidecarAppService'
import { sidecarHttpClient } from '../infrastructure/http/sidecarHttpClient'
import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import { appSettingsRepository } from '../infrastructure/filesystem/appSettingsRepository'
import { taskRunner } from '../infrastructure/process/taskRunner'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { SidecarHttpClient } from '../infrastructure/http/sidecarHttpClient'

afterEach(() => vi.restoreAllMocks())

describe('prompt history search failures', () => {
  it.each(['http', 'malformed', 'empty'] as const)('distinguishes unavailable search from no matches: %s', async (scenario) => {
    vi.spyOn(sidecarHttpClient, 'postJsonEnvelope').mockResolvedValue(
      scenario === 'http' ? { success: false, error: 'Database unavailable' } : { success: true, data: scenario === 'empty' ? [] : null },
    )
    vi.spyOn(sidecarHttpClient, 'postJson').mockResolvedValue([])
    if (scenario === 'empty') expect(await sidecarAppService.searchPromptHistory('query')).toEqual([])
    else await expect(sidecarAppService.searchPromptHistory('query')).rejects.toThrow()
  })
  it.each([true, false, 'true', null])('requires Boolean acknowledgement of session/project cleanup: %s', async (success) => {
    vi.spyOn(sidecarHttpClient, 'postJsonEnvelope').mockResolvedValue({ success: true, data: { success } })
    expect(await sidecarAppService.removePromptHistoryForSessions(['session'])).toEqual({ success: success === true })
    expect(await sidecarAppService.removePromptHistoryForProject('C:/synthetic')).toEqual({ success: success === true })
  })
  it.each(['http', 'parse', 'empty', 'row'] as const)('propagates actual authenticated HTTP results: %s', async (scenario) => {
    let authenticated = false
    const server = http.createServer((req, res) => {
      authenticated = req.headers['x-onlyrag-token'] === 'synthetic-token'
      req.resume()
      res.writeHead(scenario === 'http' ? 503 : 200, { 'Content-Type': 'application/json' })
      res.end(scenario === 'http' ? '{"detail":"Storage unavailable"}' : scenario === 'parse' ? '{' : scenario === 'row' ? '[{}]' : '[]')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const client = new SidecarHttpClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
      client.setAuthToken('synthetic-token')
      vi.spyOn(sidecarHttpClient, 'postJsonEnvelope').mockImplementation((url, payload, timeout) => client.postJsonEnvelope(url, payload, timeout))
      if (scenario === 'empty') expect(await sidecarAppService.searchPromptHistory('query')).toEqual([])
      else await expect(sidecarAppService.searchPromptHistory('query')).rejects.toThrow()
      expect(authenticated).toBe(true)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })
})

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
