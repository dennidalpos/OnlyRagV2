import { describe, it, expect, vi, afterEach } from 'vitest'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import EventEmitter from 'node:events'
import { htmlToCleanMarkdown, parseDuckDuckGoHtmlResults, WebClient } from './webClient'
import { httpMetrics } from './httpMetrics'

describe('WebClient Unit Tests & SSRF Protection', () => {
  const client = new WebClient()

  afterEach(() => {
    vi.restoreAllMocks()
    httpMetrics.reset()
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

  it('records fetch HTTP metrics without retaining the URL', async () => {
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headers: {},
      setEncoding: vi.fn(),
    })
    const request = Object.assign(new EventEmitter(), { destroy: vi.fn() })
    vi.spyOn(https, 'get').mockImplementation((...args: any[]) => {
      args[2](response)
      queueMicrotask(() => {
        response.emit('data', '<html><body><h1>Fetched</h1></body></html>')
        response.emit('end')
      })
      return request as any
    })

    const result = await client.fetchWebContent('https://example.com/private?token=secret')

    expect(result.success).toBe(true)
    expect(httpMetrics.snapshot()).toEqual([
      expect.objectContaining({ endpoint: '/web/fetch', status: 200, errorType: 'none', count: 1 }),
    ])
    expect(JSON.stringify(httpMetrics.snapshot())).not.toContain('token')
  })

  it('records download HTTP metrics after writing the file', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-webclient-'))
    try {
      const response = Object.assign(new EventEmitter(), {
        statusCode: 200,
        headers: {},
        pipe: (destination: fs.WriteStream) => {
          const chunk = Buffer.from('downloaded')
          response.emit('data', chunk)
          destination.end(chunk)
          return destination
        },
      })
      const request = Object.assign(new EventEmitter(), { destroy: vi.fn() })
      vi.spyOn(http, 'get')
      vi.spyOn(https, 'get').mockImplementation((...args: any[]) => {
        args[2](response)
        return request as any
      })

      const result = await client.downloadFile('https://example.com/archive.zip?token=secret', path.join(tempRoot, 'archive.zip'), tempRoot)

      expect(result).toEqual({ success: true, downloadedBytes: 10 })
      expect(httpMetrics.snapshot()).toEqual([
        expect.objectContaining({ endpoint: '/web/download', status: 200, errorType: 'none', count: 1 }),
      ])
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
})
