import { describe, expect, it, vi } from 'vitest'
import { VisualValidationRunner } from './visualValidationRunner'

function runtime() {
  const page = {
    goto: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => undefined),
    content: vi.fn(async () => '<main>Ready</main>'),
    on: vi.fn(),
  }
  const context = { newPage: vi.fn(async () => page) }
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
  }
  return { runtime: { launch: vi.fn(async () => browser) }, page, context, browser }
}

describe('VisualValidationRunner', () => {
  it('rejects an artifact outside the workspace before launching Playwright', async () => {
    const mocks = runtime()
    const runner = new VisualValidationRunner(mocks.runtime, () => true, () => ({ isFile: () => true }))

    const result = await runner.launchArtifact({ artifactPath: '..\\outside.html' }, 'C:\\workspace')

    expect(result).toMatchObject({ status: 'UNAVAILABLE' })
    expect((result as { error: string }).error).toContain('Security Violation')
    expect(mocks.runtime.launch).not.toHaveBeenCalled()
  })

  it('launches a contained file headlessly with the requested viewport and closes it idempotently', async () => {
    const mocks = runtime()
    const runner = new VisualValidationRunner(mocks.runtime, () => true, () => ({ isFile: () => true }))

    const result = await runner.launchArtifact({ artifactPath: 'dist/index.html', viewport: { width: 800, height: 600 } }, 'C:\\workspace')

    expect(result.status).toBe('ready')
    expect(mocks.runtime.launch).toHaveBeenCalledWith({ headless: true })
    expect(mocks.browser.newContext).toHaveBeenCalledWith({ viewport: { width: 800, height: 600 } })
    expect(mocks.page.goto).toHaveBeenCalledWith(expect.stringContaining('dist/index.html'), expect.objectContaining({ waitUntil: 'load' }))
    if (result.status === 'ready') {
      await result.close()
      await result.close()
    }
    expect(mocks.browser.close).toHaveBeenCalledTimes(1)
  })

  it('returns UNAVAILABLE and cleans up when the runtime cannot load the artifact', async () => {
    const mocks = runtime()
    mocks.page.goto.mockRejectedValueOnce(new Error('Executable does not exist'))
    const runner = new VisualValidationRunner(mocks.runtime, () => true, () => ({ isFile: () => true }))

    const result = await runner.launchArtifact({ artifactPath: 'dist/index.html' }, 'C:\\workspace')

    expect(result).toMatchObject({ status: 'UNAVAILABLE' })
    expect((result as { error: string }).error).toContain('Executable does not exist')
    expect(mocks.browser.close).toHaveBeenCalledTimes(1)
  })

  it('returns UNAVAILABLE when navigation exceeds the requested timeout', async () => {
    const mocks = runtime()
    mocks.page.goto.mockRejectedValueOnce(new Error('Timeout 100ms exceeded'))
    const runner = new VisualValidationRunner(mocks.runtime, () => true, () => ({ isFile: () => true }))

    const result = await runner.launchArtifact({ artifactPath: 'dist/index.html', timeoutMs: 100 }, 'C:\\workspace')

    expect(result).toMatchObject({ status: 'UNAVAILABLE' })
    expect((result as { error: string }).error).toContain('Timeout 100ms exceeded')
    expect(mocks.page.goto).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 100 }))
    expect(mocks.browser.close).toHaveBeenCalledTimes(1)
  })

  it('captures screenshot and DOM evidence, then closes the browser', async () => {
    const mocks = runtime()
    const runner = new VisualValidationRunner(mocks.runtime, () => true, () => ({ isFile: () => true }))

    const result = await runner.captureEvidence({ artifactPath: 'dist/index.html' }, 'C:\\workspace', 'C:\\workspace\\artifacts')

    expect(result).toEqual({
      screenshot: { status: 'available', path: 'C:\\workspace\\artifacts\\preview.png' },
      dom: { status: 'available', content: '<main>Ready</main>' },
      console: [],
      http: [],
      redaction: { applied: false, fields: [] },
    })
    expect(mocks.page.screenshot).toHaveBeenCalledWith({ path: 'C:\\workspace\\artifacts\\preview.png', timeout: 30_000 })
    expect(mocks.browser.close).toHaveBeenCalledTimes(1)
  })

  it('collects only console entries and HTTP failures, with sensitive query values redacted', async () => {
    const mocks = runtime()
    mocks.page.on.mockImplementation((event, listener) => {
      if (event === 'console') listener({ type: () => 'error', text: () => 'token=secret-value' })
      if (event === 'response') {
        listener({ url: () => 'https://example.test/api?token=secret-value', status: () => 500, request: () => ({ method: () => 'POST' }) })
        listener({ url: () => 'https://example.test/missing.js', status: () => 404, request: () => ({ method: () => 'GET' }) })
      }
    })
    const runner = new VisualValidationRunner(mocks.runtime, () => true, () => ({ isFile: () => true }))

    const result = await runner.captureEvidence({ artifactPath: 'dist/index.html' }, 'C:\\workspace', 'C:\\workspace\\artifacts')

    expect(result).toMatchObject({
      console: [{ level: 'error', message: 'token=[REDACTED]' }],
      http: [
        { url: 'https://example.test/api?token=[REDACTED]', status: 500, method: 'POST' },
        { url: 'https://example.test/missing.js', status: 404, method: 'GET' },
      ],
      redaction: { applied: true },
    })
    expect(JSON.stringify(result)).not.toContain('secret-value')
  })

  it('returns UNAVAILABLE and cleans up when capture is aborted', async () => {
    const mocks = runtime()
    const controller = new AbortController()
    mocks.page.screenshot.mockImplementationOnce(async () => {
      controller.abort()
    })
    const runner = new VisualValidationRunner(mocks.runtime, () => true, () => ({ isFile: () => true }))

    const result = await runner.captureEvidence({ artifactPath: 'dist/index.html' }, 'C:\\workspace', 'C:\\workspace\\artifacts', controller.signal)

    expect(result).toMatchObject({ status: 'UNAVAILABLE' })
    expect((result as { error: string }).error).toContain('aborted')
    expect(mocks.browser.close).toHaveBeenCalledTimes(1)
  })
})
