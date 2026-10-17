import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopShellPort } from '../domain/ports/desktopShellPort'
import { appSettingsRepository } from '../infrastructure/filesystem/appSettingsRepository'
import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import { SidecarHttpClient, sidecarHttpClient } from '../infrastructure/http/sidecarHttpClient'
import { taskRunner } from '../infrastructure/process/taskRunner'
import { normalizeIngestedFileType, SidecarAppService, sidecarAppService } from './sidecarAppService'

afterEach(() => vi.restoreAllMocks())

describe('export format routing', () => {
  it.each(['md', 'pdf', 'docx', 'html', 'htm'] as const)('preserves simultaneous %s exports in the configured folder', async (format) => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-export-'))
    vi.spyOn(Date, 'now').mockReturnValue(1792231201234)
    vi.spyOn(sidecarHttpClient, 'exportDocument').mockImplementation(async (content) => ({
      success: true,
      data: { base64_content: Buffer.from(content).toString('base64') },
    }))
    const service = new SidecarAppService(undefined, { showItemInFolder: vi.fn() } as unknown as DesktopShellPort)
    try {
      const contents = ['First città 漢 😀', 'Second document']
      const results = await Promise.all(contents.map((content) => service.exportDocument(content, format, folder)))
      expect(results.every((result) => result.success)).toBe(true)
      expect(new Set(results.map((result) => result.filePath)).size).toBe(2)
      results.forEach((result, i) => expect(fs.readFileSync(result.filePath!, 'utf8')).toBe(contents[i]))
    } finally {
      fs.rmSync(folder, { recursive: true, force: true })
    }
  })

  it.each(['md', 'pdf', 'docx', 'html', 'htm'] as const)('writes the declared %s format and extension', async (format) => {
    const content = '# città 漢 😀'
    const converted = Buffer.from('<converted>città 漢 😀</converted>')
    const createFile = vi.spyOn(documentIoRepository, 'createExportFile').mockReturnValue({ success: true })
    const convert = vi.spyOn(sidecarHttpClient, 'exportDocument').mockResolvedValue({ success: true, data: { base64_content: converted.toString('base64') } })
    vi.spyOn(documentIoRepository, 'exists').mockReturnValue(true)
    const showItemInFolder = vi.fn()
    const service = new SidecarAppService(undefined, { showItemInFolder } as unknown as DesktopShellPort)
    const result = await service.exportDocument(content, format, 'C:/fixture-output')
    const normalized = format === 'htm' ? 'html' : format
    expect(result.success).toBe(true)
    expect(result.filePath).toMatch(new RegExp(`\\.${normalized}$`))
    if (format === 'md') {
      expect(createFile).toHaveBeenCalledWith(result.filePath, content)
      expect(convert).not.toHaveBeenCalled()
    } else {
      expect(convert).toHaveBeenCalledWith(content, normalized)
      expect(createFile).toHaveBeenCalledWith(result.filePath, converted)
    }
    expect(showItemInFolder).toHaveBeenCalledWith(result.filePath)
  })
})

describe('export destination ownership', () => {
  let folder: string
  const showItemInFolder = vi.fn()
  const showSaveDialog = vi.fn<DesktopShellPort['showSaveDialog']>()
  const service = new SidecarAppService(undefined, { showItemInFolder, showSaveDialog } as unknown as DesktopShellPort)
  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-export-ownership-'))
    showItemInFolder.mockClear()
    showSaveDialog.mockReset()
  })
  afterEach(() => fs.rmSync(folder, { recursive: true, force: true }))

  it.each([1, 2, 3])('preserves colliding files and bounds retry after %i collisions', async (count) => {
    const identities = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'] as const
    const uuid = vi.spyOn(crypto, 'randomUUID')
    identities.forEach((id) => uuid.mockReturnValueOnce(id))
    const date = new Date().toISOString().slice(0, 10)
    const originals = identities.slice(0, count).map((id) => path.join(folder, `OnlyRag_Export_${date}_${id}.md`))
    originals.forEach((file) => fs.writeFileSync(file, 'Keep existing bytes'))
    const write = vi.spyOn(documentIoRepository, 'createExportFile')
    const result = await service.exportDocument('New content', 'md', folder)
    expect(result.success).toBe(count < 3)
    expect(write).toHaveBeenCalledTimes(Math.min(count + 1, 3))
    originals.forEach((file) => expect(fs.readFileSync(file, 'utf8')).toBe('Keep existing bytes'))
    if (count < 3) {
      expect(fs.readFileSync(result.filePath!, 'utf8')).toBe('New content')
      expect(showItemInFolder).toHaveBeenCalledOnce()
    } else {
      expect(result.error).toContain('3 tentativi')
      expect(showItemInFolder).not.toHaveBeenCalled()
    }
  })

  it('reports a refused write immediately without retry or success notification', async () => {
    const write = vi.spyOn(documentIoRepository, 'createExportFile').mockReturnValue({ success: false, error: 'Access denied', collision: false })
    const result = await service.exportDocument('Retained input', 'md', folder)
    expect(result).toEqual({ success: false, error: 'Access denied' })
    expect(write).toHaveBeenCalledOnce()
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it.each(['md', 'pdf'] as const)('replaces only the explicitly chosen %s destination', async (format) => {
    const chosen = path.join(folder, `chosen.${format}`)
    fs.writeFileSync(chosen, 'Old content')
    showSaveDialog.mockResolvedValueOnce(chosen)
    vi.spyOn(sidecarHttpClient, 'exportDocument').mockResolvedValue({ success: true, data: { base64_content: Buffer.from('New content').toString('base64') } })
    const create = vi.spyOn(documentIoRepository, 'createExportFile')
    expect((await service.exportDocument('New content', format)).success).toBe(true)
    expect(fs.readFileSync(chosen, 'utf8')).toBe('New content')
    expect(create).not.toHaveBeenCalled()
  })

  it('does not convert or write when the save dialog is cancelled', async () => {
    showSaveDialog.mockResolvedValueOnce(null)
    const convert = vi.spyOn(sidecarHttpClient, 'exportDocument')
    expect((await service.exportDocument('Original', 'pdf')).success).toBe(false)
    expect(convert).not.toHaveBeenCalled()
    expect(fs.readdirSync(folder)).toEqual([])
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it('does not create a destination when conversion fails', async () => {
    vi.spyOn(sidecarHttpClient, 'exportDocument').mockResolvedValue({ success: false, error: 'Conversion refused' })
    expect(await service.exportDocument('Original', 'pdf', folder)).toEqual({ success: false, error: 'Conversion refused' })
    expect(fs.readdirSync(folder)).toEqual([])
    expect(showItemInFolder).not.toHaveBeenCalled()
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
