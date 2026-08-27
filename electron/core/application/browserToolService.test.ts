import { describe, expect, it, vi } from 'vitest'
import { BrowserToolService } from './browserToolService'

function createService(overrides: Partial<ConstructorParameters<typeof BrowserToolService>[0]> = {}) {
  return new BrowserToolService({
    openExternal: vi.fn(async () => undefined),
    openPath: vi.fn(async () => ''),
    exists: vi.fn(() => true),
    ...overrides,
  })
}

describe('BrowserToolService open_in_browser', () => {
  it('rejects a missing target without opening anything', async () => {
    const openExternal = vi.fn(async () => undefined)
    const openPath = vi.fn(async () => '')
    const service = createService({ openExternal, openPath })
    const result = await service.executeOpenInBrowser({}, 'C:\\workspace')

    expect(result.outputForHistory).toContain('missing')
    expect(openExternal).not.toHaveBeenCalled()
    expect(openPath).not.toHaveBeenCalled()
  })

  it('opens only http(s) URLs through the external browser adapter', async () => {
    const openExternal = vi.fn(async () => undefined)
    const openPath = vi.fn(async () => '')
    const service = createService({ openExternal, openPath })

    const result = await service.executeOpenInBrowser({ url: 'https://example.test/preview' }, 'C:\\workspace')

    expect(result.outputForHistory).toContain('Successfully opened URL')
    expect(openExternal).toHaveBeenCalledWith('https://example.test/preview')
    expect(openPath).not.toHaveBeenCalled()
  })

  it('rejects a local path outside the workspace before checking or opening it', async () => {
    const exists = vi.fn(() => true)
    const openPath = vi.fn(async () => '')
    const service = createService({ exists, openPath })

    const result = await service.executeOpenInBrowser({ filePath: '..\\outside.html' }, 'C:\\workspace')

    expect(result.outputForHistory).toContain('Security Violation')
    expect(exists).not.toHaveBeenCalled()
    expect(openPath).not.toHaveBeenCalled()
  })

  it('checks local file existence and reports an opening failure', async () => {
    const exists = vi.fn(() => true)
    const openPath = vi.fn(async () => 'default application unavailable')
    const service = createService({ exists, openPath })

    const result = await service.executeOpenInBrowser({ filePath: 'dist/index.html' }, 'C:\\workspace')

    expect(exists).toHaveBeenCalledWith('C:\\workspace\\dist\\index.html')
    expect(openPath).toHaveBeenCalledWith('C:\\workspace\\dist\\index.html')
    expect(result.outputForHistory).toContain('default application unavailable')
  })
})
