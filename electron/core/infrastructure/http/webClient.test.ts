import { describe, it, expect, vi, afterEach } from 'vitest'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import EventEmitter from 'node:events'
import { PassThrough } from 'node:stream'
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage, RequestOptions } from 'node:http'
import { htmlToCleanMarkdown, parseDuckDuckGoHtmlResults, WebClient } from './webClient'

type MockClientRequest = ClientRequest & {
  destroy: ReturnType<typeof vi.fn>
}

function createMockRequest(): MockClientRequest {
  return Object.assign(new EventEmitter(), { destroy: vi.fn() }) as MockClientRequest
}

function createMockResponse(statusCode: number, headers: IncomingHttpHeaders = {}, statusMessage?: string): IncomingMessage {
  return Object.assign(new EventEmitter(), { statusCode, headers, statusMessage, setEncoding: vi.fn(), destroy: vi.fn() }) as unknown as IncomingMessage
}

function mockHttpsGet(response: IncomingMessage, request: MockClientRequest, onResponse?: (response: IncomingMessage) => void, deferred = false): void {
  vi.spyOn(https, 'get').mockImplementation(((
    _url: string | URL | RequestOptions,
    optionsOrCallback?: RequestOptions | ((response: IncomingMessage) => void),
    callback?: (response: IncomingMessage) => void,
  ) => {
    const responseCallback = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback
    if (!responseCallback) throw new Error('Expected HTTP response callback')
    const invokeCallback = () => {
      responseCallback(response)
      onResponse?.(response)
    }
    if (deferred) queueMicrotask(invokeCallback)
    else invokeCallback()
    return request
  }) as unknown as typeof https.get)
}

function createDownloadResponse(statusCode = 200, headers: IncomingHttpHeaders = {}): IncomingMessage & PassThrough {
  return Object.assign(new PassThrough(), { statusCode, headers }) as IncomingMessage & PassThrough
}

describe('WebClient Unit Tests & SSRF Protection', () => {
  const client = new WebClient()

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should clean HTML tags and preserve markdown structure', () => {
    const sampleHtml = `
      <!DOCTYPE html>
      <html>
      <head><title>Test Page</title><style>body { color: red; }</style></head>
      <body>
        <script>console.log("malicious script");</script>
        <nav><a href="/">Home</a></nav>
        <h1>React 19 Hooks Guide</h1>
        <p>This is a guide for using <code>useActionState</code> in React 19.</p>
        <pre><code>const [state, formAction] = useActionState(action, initialState);</code></pre>
        <ul>
          <li>Feature A</li>
          <li>Feature B</li>
        </ul>
        <footer>Copyright 2026</footer>
      </body>
      </html>
    `

    const cleaned = htmlToCleanMarkdown(sampleHtml)
    expect(cleaned).toContain('# React 19 Hooks Guide')
    expect(cleaned).toContain('useActionState')
    expect(cleaned).toContain('Feature A')
    expect(cleaned).toContain('Feature B')
    expect(cleaned).not.toContain('<script>')
    expect(cleaned).not.toContain('malicious script')
    expect(cleaned).not.toContain('<style>')
  })

  it('should parse DuckDuckGo HTML snippets into structured search results', () => {
    const mockDdgHtml = `
      <div class="result results_links">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Freact.dev%2Fblog%2F2024%2F12%2F05%2Freact-19">React 19 is now stable</a>
        <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Freact.dev%2Fblog%2F2024%2F12%2F05%2Freact-19">In our React 19 Beta post, we shared the features coming in React 19.</a>
      </div>
    `

    const results = parseDuckDuckGoHtmlResults(mockDdgHtml)
    expect(results.length).toBe(1)
    expect(results[0].title).toBe('React 19 is now stable')
    expect(results[0].url).toBe('https://react.dev/blog/2024/12/05/react-19')
    expect(results[0].snippet).toContain('React 19 Beta post')
  })

  it('should allow valid public HTTPS and HTTP URLs', () => {
    const resHttps = client.validateUrlSafety('https://react.dev/blog')
    expect(resHttps.safeUrl).not.toBeNull()
    expect(resHttps.error).toBeUndefined()

    const resHttp = client.validateUrlSafety('http://example.com/docs')
    expect(resHttp.safeUrl).not.toBeNull()
    expect(resHttp.error).toBeUndefined()
  })

  it('should block non-HTTP protocols (file, ftp, javascript)', () => {
    const resFile = client.validateUrlSafety('file:///C:/Windows/System32/drivers/etc/hosts')
    expect(resFile.safeUrl).toBeNull()
    expect(resFile.error).toContain('Forbidden protocol')

    const resFtp = client.validateUrlSafety('ftp://files.example.com/data')
    expect(resFtp.safeUrl).toBeNull()
  })

  it('should block Cloud Metadata SSRF targets', () => {
    const resAws = client.validateUrlSafety('http://169.254.169.254/latest/meta-data/')
    expect(resAws.safeUrl).toBeNull()
    expect(resAws.error).toContain('SSRF Protection')

    const resGcp = client.validateUrlSafety('http://metadata.google.internal/computeMetadata/v1/')
    expect(resGcp.safeUrl).toBeNull()
    expect(resGcp.error).toContain('SSRF Protection')
  })

  it('should block localhost, loopback, and private RFC1918 IPs', () => {
    const resLocalhost = client.validateUrlSafety('http://localhost:8080/admin')
    expect(resLocalhost.safeUrl).toBeNull()

    const resLoopback = client.validateUrlSafety('http://127.0.0.1:3000/api')
    expect(resLoopback.safeUrl).toBeNull()

    const resPrivateA = client.validateUrlSafety('http://10.0.0.1/secret')
    expect(resPrivateA.safeUrl).toBeNull()

    const resPrivateB = client.validateUrlSafety('http://172.16.0.5/dashboard')
    expect(resPrivateB.safeUrl).toBeNull()

    const resPrivateC = client.validateUrlSafety('http://192.168.1.1/router')
    expect(resPrivateC.safeUrl).toBeNull()
  })

  it('allows local network URLs only when Full access is explicit', () => {
    expect(client.validateUrlSafety('http://127.0.0.1:3000/api').safeUrl).toBeNull()
    expect(client.validateUrlSafety('http://127.0.0.1:3000/api', true).safeUrl?.hostname).toBe('127.0.0.1')
  })

  it('fetches a page and converts it to markdown', async () => {
    const response = createMockResponse(200)
    const request = createMockRequest()
    mockHttpsGet(response, request, () => {
      queueMicrotask(() => {
        response.emit('data', '<html><body><h1>Fetched</h1></body></html>')
        response.emit('end')
      })
    })

    const result = await client.fetchWebContent('https://example.com/private?token=secret')

    expect(result.success).toBe(true)
    expect(result.content).toContain('# Fetched')
  })

  it('writes a completed download to disk', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-webclient-'))
    try {
      const response = createMockResponse(200)
      response.pipe = <T extends NodeJS.WritableStream>(destination: T): T => {
        const chunk = Buffer.from('downloaded')
        response.emit('data', chunk)
        destination.end(chunk)
        return destination
      }
      const request = createMockRequest()
      vi.spyOn(http, 'get')
      mockHttpsGet(response, request)

      const result = await client.downloadFile('https://example.com/archive.zip?token=secret', path.join(tempRoot, 'archive.zip'), tempRoot)

      expect(result).toEqual({ success: true, downloadedBytes: 10 })
      expect(fs.readFileSync(path.join(tempRoot, 'archive.zip'), 'utf8')).toBe('downloaded')
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('cancels fetch and download immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const cancelledPath = path.join(os.tmpdir(), `onlyrag-cancelled-${Date.now()}.zip`)

    await expect(client.fetchWebContent('https://example.com', 16000, controller.signal)).resolves.toMatchObject({
      success: false,
      error: 'Request cancelled by AbortSignal',
    })
    await expect(client.downloadFile('https://example.com/file.zip', cancelledPath, path.dirname(cancelledPath), controller.signal)).resolves.toMatchObject({
      success: false,
      error: 'Download cancelled by AbortSignal',
    })
    expect(fs.existsSync(cancelledPath)).toBe(false)
  })

  it('cancels an in-flight fetch and destroys the active request', async () => {
    const response = createMockResponse(200)
    const request = createMockRequest()
    mockHttpsGet(response, request)

    const controller = new AbortController()
    const pending = client.fetchWebContent('https://example.com/slow', 16000, controller.signal)
    controller.abort()

    await expect(pending).resolves.toMatchObject({
      success: false,
      error: 'Request cancelled by AbortSignal',
    })
    expect(request.destroy).toHaveBeenCalled()
  })

  it('bounds the whole response even when body data keeps the socket active', async () => {
    vi.useFakeTimers()
    try {
      const response = createMockResponse(200)
      const request = createMockRequest()
      mockHttpsGet(response, request)
      const pending = client.fetchWebContent('https://example.com/trickle')
      await vi.advanceTimersByTimeAsync(14999)
      response.emit('data', 'still active')
      await vi.advanceTimersByTimeAsync(1)
      await expect(pending).resolves.toMatchObject({ success: false, error: expect.stringContaining('deadline') })
      expect(request.destroy).toHaveBeenCalled()
      expect(response.destroy).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels an in-flight download and removes the partial file', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-webclient-cancel-'))
    const targetPath = path.join(tempRoot, 'partial.zip')
    try {
      const response = createMockResponse(200)
      response.pipe = <T extends NodeJS.WritableStream>(destination: T): T => {
        setTimeout(() => {
          destination.end(Buffer.from('partial'))
        }, 50)
        return destination
      }
      const request = createMockRequest()
      mockHttpsGet(response, request, undefined, true)

      const controller = new AbortController()
      const pending = client.downloadFile('https://example.com/slow.zip', targetPath, tempRoot, controller.signal)
      controller.abort()

      await expect(pending).resolves.toMatchObject({
        success: false,
        error: 'Download cancelled by AbortSignal',
      })
      expect(request.destroy).toHaveBeenCalled()
      expect(fs.existsSync(targetPath)).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 100))
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('rejects executable MIME types before persisting a download', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-webclient-mime-'))
    const targetPath = path.join(tempRoot, 'payload.bin')
    try {
      const response = createMockResponse(200, { 'content-type': 'application/x-msdownload' })
      const request = createMockRequest()
      mockHttpsGet(response, request, undefined, true)

      await expect(client.downloadFile('https://example.com/payload.bin', targetPath, tempRoot)).resolves.toMatchObject({
        success: false,
        error: 'Download MIME type is not allowed: application/x-msdownload',
      })
      expect(request.destroy).toHaveBeenCalled()
      expect(fs.existsSync(targetPath)).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 100))
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('stops following download redirects after the configured safety limit', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-webclient-redirect-'))
    const targetPath = path.join(tempRoot, 'redirected.bin')
    try {
      const response = createMockResponse(302, { location: 'https://example.com/next' })
      const request = createMockRequest()
      mockHttpsGet(response, request, undefined, true)
      const get = vi.mocked(https.get)

      await expect(client.downloadFile('https://example.com/start', targetPath, tempRoot)).resolves.toMatchObject({
        success: false,
        error: 'Download exceeded 3 redirect hops.',
      })
      expect(get).toHaveBeenCalledTimes(4)
      expect(fs.existsSync(targetPath)).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 100))
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('cleans up partial download file and reports error on HTTP 500 failure', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-webclient-err500-'))
    const targetPath = path.join(tempRoot, 'failed.bin')
    try {
      const response = createMockResponse(500, {}, 'Internal Server Error')
      const request = createMockRequest()
      mockHttpsGet(response, request, undefined, true)

      const res = await client.downloadFile('https://example.com/failed.bin', targetPath, tempRoot)
      expect(res.success).toBe(false)
      expect(res.error).toContain('HTTP 500')
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(fs.existsSync(targetPath)).toBe(false)
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('returns an asynchronous file-open failure without an unhandled stream error', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-webclient-open-error-'))
    const targetPath = path.join(tempRoot, 'failed.bin')
    const originalCreate = fs.createWriteStream
    let output: fs.WriteStream | undefined
    vi.spyOn(fs, 'createWriteStream').mockImplementation((filePath, options) => {
      output = originalCreate(filePath, {
        ...(typeof options === 'object' ? options : {}),
        fs: {
          open: (_path, _flags, _mode, callback) => queueMicrotask(() => callback(Object.assign(new Error('open denied'), { code: 'EACCES' }))),
          write: fs.write,
          // Node's flush option also requires fsync; @types/node omits it from this adapter type.
          ...{ fsync: fs.fsync },
          close: fs.close,
        },
      })
      return output
    })
    const response = createDownloadResponse()
    const request = createMockRequest()
    mockHttpsGet(response, request, () => response.end('payload'), true)
    try {
      await expect(client.downloadFile('https://example.com/file.bin', targetPath, tempRoot)).resolves.toMatchObject({ success: false, error: 'open denied' })
      expect(output?.closed).toBe(true)
      expect(request.destroy).toHaveBeenCalledTimes(1)
      expect(fs.existsSync(targetPath)).toBe(false)
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('closes and removes a partially written file before returning a disk-write failure', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-webclient-write-error-'))
    const targetPath = path.join(tempRoot, 'failed.bin')
    const originalCreate = fs.createWriteStream
    let output: fs.WriteStream | undefined
    vi.spyOn(fs, 'createWriteStream').mockImplementation((filePath, options) => {
      output = originalCreate(filePath, {
        ...(typeof options === 'object' ? options : {}),
        fs: {
          open: fs.open,
          write: ((fd, buffer, offset, length, position, callback) => {
            fs.writeSync(fd, buffer, offset, Math.min(length ?? buffer.byteLength, 2), position)
            queueMicrotask(() => callback(Object.assign(new Error('disk full'), { code: 'ENOSPC' }), 0, buffer))
          }) as typeof fs.write,
          ...{ fsync: fs.fsync },
          close: fs.close,
        },
      })
      return output
    })
    const response = createDownloadResponse()
    const request = createMockRequest()
    mockHttpsGet(response, request, () => response.end('payload'), true)
    try {
      await expect(client.downloadFile('https://example.com/file.bin', targetPath, tempRoot)).resolves.toMatchObject({ success: false, error: 'disk full' })
      expect(output?.closed).toBe(true)
      expect(request.destroy).toHaveBeenCalledTimes(1)
      expect(fs.existsSync(targetPath)).toBe(false)
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('waits for an outstanding write on abort and ignores late failures after a replacement is saved', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-webclient-abort-write-'))
    const targetPath = path.join(tempRoot, 'partial.bin')
    const originalCreate = fs.createWriteStream
    let output: fs.WriteStream | undefined
    let completeWrite: () => void = () => {
      throw new Error('Write did not start')
    }
    let markWriting: () => void = () => {}
    const writing = new Promise<void>((resolve) => {
      markWriting = resolve
    })
    vi.spyOn(fs, 'createWriteStream').mockImplementation((filePath, options) => {
      output = originalCreate(filePath, {
        ...(typeof options === 'object' ? options : {}),
        fs: {
          open: fs.open,
          write: ((fd, buffer, offset, length, position, callback) => {
            fs.writeSync(fd, buffer, offset, length, position)
            completeWrite = () => callback(Object.assign(new Error('late disk failure'), { code: 'EIO' }), 0, buffer)
            markWriting()
          }) as typeof fs.write,
          ...{ fsync: fs.fsync },
          close: fs.close,
        },
      })
      return output
    })
    const response = createDownloadResponse()
    const request = createMockRequest()
    const controller = new AbortController()
    mockHttpsGet(response, request, () => response.write('partial'), true)
    try {
      let settled = false
      const pending = client.downloadFile('https://example.com/file.bin', targetPath, tempRoot, controller.signal).then((result) => {
        settled = true
        return result
      })
      await writing
      controller.abort()
      request.emit('error', new Error('late request error'))
      request.emit('timeout')
      await Promise.resolve()
      expect(settled).toBe(false)
      expect(fs.existsSync(targetPath)).toBe(false)
      expect(fs.readFileSync(String(output?.path), 'utf8')).toBe('partial')
      completeWrite()
      await expect(pending).resolves.toEqual({ success: false, error: 'Download cancelled by AbortSignal' })
      expect(output?.closed).toBe(true)
      expect(request.destroy).toHaveBeenCalledTimes(1)
      expect(fs.existsSync(targetPath)).toBe(false)

      fs.writeFileSync(targetPath, 'replacement')
      request.emit('error', new Error('obsolete request'))
      request.emit('timeout')
      response.emit('error', new Error('obsolete response'))
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(fs.readFileSync(targetPath, 'utf8')).toBe('replacement')
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('discards a response arriving after cancellation without opening the target', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-webclient-late-response-'))
    const targetPath = path.join(tempRoot, 'file.bin')
    const response = createDownloadResponse()
    const request = createMockRequest()
    const controller = new AbortController()
    const create = vi.spyOn(fs, 'createWriteStream')
    mockHttpsGet(response, request, undefined, true)
    try {
      const pending = client.downloadFile('https://example.com/file.bin', targetPath, tempRoot, controller.signal)
      controller.abort()
      await expect(pending).resolves.toEqual({ success: false, error: 'Download cancelled by AbortSignal' })
      expect(create).not.toHaveBeenCalled()
      expect(response.destroyed).toBe(true)
      expect(fs.existsSync(targetPath)).toBe(false)
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('keeps the redirected file when retired requests fail or the completed signal is aborted', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-webclient-redirect-success-'))
    const targetPath = path.join(tempRoot, 'file.bin')
    const redirect = createDownloadResponse(302, { location: '/final' })
    const response = createDownloadResponse()
    const firstRequest = createMockRequest()
    const finalRequest = createMockRequest()
    const controller = new AbortController()
    const create = vi.spyOn(fs, 'createWriteStream')
    mockHttpsGet(redirect, firstRequest, undefined, true)
    vi.mocked(https.get)
      .mockImplementationOnce(((
        _url: string | URL | RequestOptions,
        _options?: RequestOptions | ((response: IncomingMessage) => void),
        callback?: (response: IncomingMessage) => void,
      ) => {
        queueMicrotask(() => callback?.(redirect))
        return firstRequest
      }) as typeof https.get)
      .mockImplementationOnce(((
        _url: string | URL | RequestOptions,
        _options?: RequestOptions | ((response: IncomingMessage) => void),
        callback?: (response: IncomingMessage) => void,
      ) => {
        queueMicrotask(() => {
          callback?.(response)
          firstRequest.emit('error', new Error('obsolete redirect error'))
          firstRequest.emit('timeout')
          response.end('complete')
        })
        return finalRequest
      }) as typeof https.get)
    try {
      await expect(client.downloadFile('https://example.com/start', targetPath, tempRoot, controller.signal)).resolves.toEqual({
        success: true,
        downloadedBytes: 8,
      })
      expect(vi.mocked(https.get).mock.calls[1][0].toString()).toBe('https://example.com/final')
      expect(create).toHaveBeenCalledTimes(1)
      expect(redirect.destroyed).toBe(true)
      controller.abort()
      firstRequest.emit('timeout')
      finalRequest.emit('error', new Error('late socket error'))
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(fs.readFileSync(targetPath, 'utf8')).toBe('complete')
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('cancels the active redirect hop and leaves no file when its response arrives late', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-webclient-redirect-abort-'))
    const targetPath = path.join(tempRoot, 'file.bin')
    const redirect = createDownloadResponse(302, { location: '/final' })
    const response = createDownloadResponse()
    const firstRequest = createMockRequest()
    const finalRequest = createMockRequest()
    const controller = new AbortController()
    let sendFinalResponse: () => void = () => {
      throw new Error('Redirect did not start')
    }
    let markRedirected: () => void = () => {}
    const redirected = new Promise<void>((resolve) => {
      markRedirected = resolve
    })
    mockHttpsGet(redirect, firstRequest, undefined, true)
    vi.mocked(https.get)
      .mockImplementationOnce(((
        _url: string | URL | RequestOptions,
        _options?: RequestOptions | ((response: IncomingMessage) => void),
        callback?: (response: IncomingMessage) => void,
      ) => {
        queueMicrotask(() => callback?.(redirect))
        return firstRequest
      }) as typeof https.get)
      .mockImplementationOnce(((
        _url: string | URL | RequestOptions,
        _options?: RequestOptions | ((response: IncomingMessage) => void),
        callback?: (response: IncomingMessage) => void,
      ) => {
        sendFinalResponse = () => callback?.(response)
        markRedirected()
        return finalRequest
      }) as typeof https.get)
    try {
      const pending = client.downloadFile('https://example.com/start', targetPath, tempRoot, controller.signal)
      await redirected
      controller.abort()
      sendFinalResponse()
      response.end('late body')
      await expect(pending).resolves.toEqual({ success: false, error: 'Download cancelled by AbortSignal' })
      expect(firstRequest.destroy).toHaveBeenCalledTimes(1)
      expect(finalRequest.destroy).toHaveBeenCalledTimes(1)
      expect(response.destroyed).toBe(true)
      expect(fs.existsSync(targetPath)).toBe(false)
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it.each(['error', 'aborted'] as const)('removes the partial file on a response %s before completion', async (event) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-webclient-response-error-'))
    const targetPath = path.join(tempRoot, 'file.bin')
    const response = createDownloadResponse()
    const request = createMockRequest()
    const originalCreate = fs.createWriteStream
    vi.spyOn(fs, 'createWriteStream').mockImplementation((filePath, options) => {
      const output = originalCreate(filePath, options)
      output.once('open', () => {
        response.emit(event, new Error('broken response'))
      })
      return output
    })
    mockHttpsGet(response, request, () => response.write('partial'), true)
    try {
      const result = await client.downloadFile('https://example.com/file.bin', targetPath, tempRoot)
      expect(result).toEqual({ success: false, error: event === 'error' ? 'broken response' : 'Download response aborted before completion' })
      expect(request.destroy).toHaveBeenCalledTimes(1)
      expect(fs.existsSync(targetPath)).toBe(false)
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it.each([
    ['http://127.0.0.1/private', 'SSRF Protection'],
    ['file:///C:/private', 'Forbidden protocol'],
    ['http://[invalid', 'Invalid download redirect'],
  ])('rejects redirect %s without modifying the destination', async (location, error) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-webclient-redirect-refused-'))
    const targetPath = path.join(tempRoot, 'existing.bin')
    fs.writeFileSync(targetPath, 'original')
    const create = vi.spyOn(fs, 'createWriteStream')
    const response = createDownloadResponse(302, { location })
    mockHttpsGet(response, createMockRequest(), undefined, true)
    try {
      const result = await client.downloadFile('https://example.com/start', targetPath, tempRoot)
      expect(result.success).toBe(false)
      expect(result.error).toContain(error)
      expect(create).not.toHaveBeenCalled()
      expect(response.destroyed).toBe(true)
      expect(fs.readFileSync(targetPath, 'utf8')).toBe('original')
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it.each(['complete', 'disconnect'] as const)('handles a real loopback HTTP redirect followed by %s', async (outcome) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-webclient-local-http-'))
    const targetPath = path.join(tempRoot, 'file.bin')
    let disconnect: () => void = () => {}
    const server = http.createServer((request, response) => {
      if (request.url === '/start') {
        response.writeHead(302, { location: '/file' })
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.write('payload')
      if (outcome === 'complete') response.end()
      else disconnect = () => response.destroy()
    })
    const originalCreate = fs.createWriteStream
    vi.spyOn(fs, 'createWriteStream').mockImplementation((filePath, options) => {
      const output = originalCreate(filePath, options)
      if (outcome === 'disconnect') output.once('open', () => disconnect())
      return output
    })
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Expected a loopback TCP listener')
      // Full access is confined to this isolated loopback fixture; public-only policy is tested separately.
      const result = await client.downloadFile(`http://127.0.0.1:${address.port}/start`, targetPath, tempRoot, undefined, 0, true)
      if (outcome === 'complete') {
        expect(result).toEqual({ success: true, downloadedBytes: 7 })
        expect(fs.readFileSync(targetPath, 'utf8')).toBe('payload')
      } else {
        expect(result.success).toBe(false)
        expect(result.error).toContain('aborted')
        expect(fs.existsSync(targetPath)).toBe(false)
      }
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})
