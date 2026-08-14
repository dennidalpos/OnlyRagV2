import { describe, it, expect } from 'vitest'
import { htmlToCleanMarkdown, parseDuckDuckGoHtmlResults, WebClient } from './webClient'

describe('WebClient Unit Tests & SSRF Protection', () => {
  const client = new WebClient()

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
})
