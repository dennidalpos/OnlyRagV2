import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopShellPort } from '../domain/ports/desktopShellPort'
import { appSettingsRepository } from '../infrastructure/filesystem/appSettingsRepository'
import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import { SidecarHttpClient, sidecarHttpClient } from '../infrastructure/http/sidecarHttpClient'
import { taskRunner } from '../infrastructure/process/taskRunner'
import { normalizeIngestedFileType, SidecarAppService, sidecarAppService } from './sidecarAppService'

afterEach(() => vi.restoreAllMocks())

describe('export format routing', () => {
  it.each(['md', 'pdf', 'docx', 'html', 'htm'] as const)('writes the declared %s format and extension', async (format) => {
    const content = '# città 漢 😀'
    const converted = Buffer.from('<converted>città 漢 😀</converted>')
    const writeText = vi.spyOn(documentIoRepository, 'writeText').mockReturnValue({ success: true })
    const writeBuffer = vi.spyOn(documentIoRepository, 'writeBuffer').mockReturnValue({ success: true })
    const convert = vi.spyOn(sidecarHttpClient, 'exportDocument').mockResolvedValue({ success: true, data: { base64_content: converted.toString('base64') } })
    vi.spyOn(documentIoRepository, 'exists').mockReturnValue(true)
    const showItemInFolder = vi.fn()
    const service = new SidecarAppService(undefined, { showItemInFolder } as unknown as DesktopShellPort)
    const result = await service.exportDocument(content, format, 'C:/fixture-output')
    const normalized = format === 'htm' ? 'html' : format
    expect(result.success).toBe(true)
    expect(result.filePath).toMatch(new RegExp(`\\.${normalized}$`))
    if (format === 'md') {
      expect(writeText).toHaveBeenCalledWith(result.filePath, content)
      expect(convert).not.toHaveBeenCalled()
    } else {
      expect(convert).toHaveBeenCalledWith(content, normalized)
      expect(writeBuffer).toHaveBeenCalledWith(result.filePath, converted)
      expect(writeText).not.toHaveBeenCalled()
    }
    expect(showItemInFolder).toHaveBeenCalledWith(result.filePath)
  })
})

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
  it('binds deletion and restore to the same Sidecar operation', async () => {
    const request = vi.spyOn(sidecarHttpClient, 'postJsonEnvelope').mockResolvedValue({ success: true, data: { success: true } })
    expect(await sidecarAppService.removePromptHistoryForSessions(['session'], 'operation-1')).toEqual({ success: true })
    expect(await sidecarAppService.restorePromptHistoryForSessions(['session'], 'operation-1')).toEqual({ success: true })
    expect(request.mock.calls.map(([url, payload]) => [url, payload])).toEqual([
      ['/history/remove', { session_ids: ['session'], operation_id: 'operation-1' }],
      ['/history/remove', { session_ids: ['session'], operation_id: 'operation-1', restore: true }],
    ])
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
  vi.spyOn(sidecarHttpClient, 'ingestFileStream').mockImplementation(async (_payload, _progress, register) => {
    register?.(() => {})
    return { success: false, error: 'Review required', normalizationReview: review }
  })
  const unregister = vi.spyOn(taskRunner, 'unregisterActiveTask')
  const result = await sidecarAppService.ingestFile('C:/fixtures/review.pdf', undefined, undefined, true, 'normalizer-fixture', undefined, 'review-task')
  expect(result).toEqual({ success: false, error: 'Review required', normalizationReview: review })
  expect(unregister).toHaveBeenCalledWith('review-task')
})

it('refuses a reused translation identity without unregistering the running owner', async () => {
  const cancelOwner = vi.fn()
  taskRunner.registerActiveTask('duplicate-translation', 'translation', cancelOwner)
  const unregister = vi.spyOn(taskRunner, 'unregisterActiveTask')
  vi.spyOn(sidecarHttpClient, 'translateDocumentInplaceStream').mockImplementation(async (_doc, _payload, _progress, register) => {
    register?.(() => {})
    return { success: false, error: 'Unreachable after duplicate registration' }
  })
  try {
    await expect(sidecarAppService.translateDocumentInplace('doc', 'it', 'en', 'duplicate-translation', 'fixture')).rejects.toThrow('already active')
    expect(unregister).not.toHaveBeenCalled()
    expect(taskRunner.cancelTask('duplicate-translation').success).toBe(true)
    expect(cancelOwner).toHaveBeenCalledOnce()
  } finally {
    taskRunner.unregisterActiveTask('duplicate-translation')
  }
})

it('passes the Excel format opt-in to Sidecar only when enabled', async () => {
  vi.spyOn(documentIoRepository, 'exists').mockReturnValue(true)
  vi.spyOn(appSettingsRepository, 'loadSettings').mockResolvedValue(null)
  const stream = vi.spyOn(sidecarHttpClient, 'ingestFileStream').mockResolvedValue({ success: false, error: 'Isolated refusal' })
  await sidecarAppService.ingestFile('C:/fixtures/large.xlsx', undefined, undefined, false, undefined, undefined, 'excel-task', false, true)
  expect(stream).toHaveBeenCalledWith(expect.objectContaining({ allow_full_excel_format: true }), expect.any(Function), expect.any(Function))
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
