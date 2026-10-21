import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebClient } from './webClient'
import { publicOnlyLookup } from './networkAddressPolicy'
import { WebToolService } from '../../application/webToolService'

// Real HTTP sockets and filesystem; only routing fixture.invalid is redirected to our owned server.
// Production URL/MIME/path guards remain enabled. DNS rejection is exercised separately below.
describe('agent network against owned HTTP services', () => {
  let server: http.Server
  let directory: string
  let base: string
  let slowStarted: Promise<void>
  let started: () => void
  const client = new WebClient()
  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-network-local-'))
    slowStarted = new Promise((resolve) => {
      started = resolve
    })
    server = http.createServer((request, response) => {
      switch (request.url) {
        case '/redirect':
          response.writeHead(302, { location: '/file' })
          response.end()
          return
        case '/private':
          response.writeHead(302, { location: 'http://127.0.0.1/forbidden' })
          response.end()
          return
        case '/loop':
          response.writeHead(302, { location: '/loop' })
          response.end()
          return
        case '/error':
          response.writeHead(503)
          response.end('Unavailable')
          return
        case '/mime':
          response.writeHead(200, { 'content-type': 'application/x-msdownload' })
          response.end('MZ')
          return
        case '/mismatch':
          response.writeHead(200, { 'content-type': 'image/png' })
          response.end('%PDF-1.7')
          return
        case '/page':
          response.end('<html><title>Owned page</title><body><h1>Local evidence</h1></body></html>')
          return
        case '/slow':
          response.writeHead(200, { 'content-type': 'text/plain' })
          response.write('partial')
          started()
          return
        default:
          response.writeHead(200, { 'content-type': 'text/plain' })
          response.end('owned payload')
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing owned listener')
    base = `http://127.0.0.1:${address.port}`
    const get = http.get
    vi.spyOn(http, 'get').mockImplementation(((url: URL, options: http.RequestOptions, callback: (response: http.IncomingMessage) => void) => {
      expect(url.hostname).toBe('fixture.invalid')
      expect(options.lookup).toBe(publicOnlyLookup)
      return get(new URL(url.pathname, base), { ...options, lookup: undefined }, callback)
    }) as typeof http.get)
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('follows redirects and records the requested URL and exact artifact hash through the agent service', async () => {
    const tool = new WebToolService({ recordBeforeModification: vi.fn() })
    const destination = path.join(directory, 'artifact.txt')
    const result = await tool.executeDownloadFile({ url: 'http://fixture.invalid/redirect', filePath: destination }, directory, true, undefined)
    expect(result.outcome).toBe('success')
    expect(fs.readFileSync(destination, 'utf8')).toBe('owned payload')
    expect(result.outputForHistory).toContain('http://fixture.invalid/redirect')
    expect(result.outputForHistory).toContain(createHash('sha256').update('owned payload').digest('hex'))
    const fetched = await client.fetchWebContent('http://fixture.invalid/page')
    expect(fetched.success).toBe(true)
    expect(fetched.title).toBe('Owned page')
    expect(fetched.content).toContain('# Local evidence')
  })

  it.each(['/error', '/mime', '/mismatch', '/private', '/loop'])('refuses %s without touching an existing file', async (route) => {
    const destination = path.join(directory, 'existing.txt')
    fs.writeFileSync(destination, 'retained')
    const result = await client.downloadFile(`http://fixture.invalid${route}`, destination, directory)
    expect(result.success).toBe(false)
    expect(fs.readFileSync(destination, 'utf8')).toBe('retained')
    expect(fs.readdirSync(directory)).toEqual(['existing.txt'])
  })

  it('acknowledges cancellation only after the real partial descriptor is closed and removed', async () => {
    const destination = path.join(directory, 'partial.txt')
    fs.writeFileSync(destination, 'retained')
    const controller = new AbortController()
    const pending = client.downloadFile('http://fixture.invalid/slow', destination, directory, controller.signal)
    await slowStarted
    const deadline = Date.now() + 2000
    while (!fs.readdirSync(directory).some((name) => name.startsWith('.onlyrag-download-') && fs.statSync(path.join(directory, name)).size > 0)) {
      if (Date.now() >= deadline) throw new Error('The native partial write did not arrive')
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    controller.abort()
    expect((await pending).success).toBe(false)
    expect(fs.readFileSync(destination, 'utf8')).toBe('retained')
    expect(fs.readdirSync(directory)).toEqual(['partial.txt'])
    fs.writeFileSync(destination, 'replacement')
    server.closeAllConnections()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fs.readFileSync(destination, 'utf8')).toBe('replacement')
  })

  it('preserves a destination directory when final publication is refused and removes only its staging file', async () => {
    const destination = path.join(directory, 'occupied')
    fs.mkdirSync(destination)
    fs.writeFileSync(path.join(destination, 'sentinel'), 'retained')
    const result = await client.downloadFile('http://fixture.invalid/file', destination, directory)
    expect(result.success).toBe(false)
    expect(result.error).toContain('publishing')
    expect(fs.readFileSync(path.join(destination, 'sentinel'), 'utf8')).toBe('retained')
    expect(fs.readdirSync(directory)).toEqual(['occupied'])
  })

  it('refuses traversal, URL schemes and native localhost DNS resolution', async () => {
    const result = await client.downloadFile('http://fixture.invalid/file', path.join(directory, '..', 'outside.txt'), directory)
    expect(result.success).toBe(false)
    expect((await client.fetchWebContent('file:///private')).success).toBe(false)
    const dnsError = await new Promise<NodeJS.ErrnoException | null>((resolve) => publicOnlyLookup('localhost', {}, (error) => resolve(error)))
    expect(dnsError?.code).toBe('ESSRF')
  })

  it('reports a refused connection from the owned endpoint', async () => {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing listener')
    await new Promise<void>((resolve) => server.close(() => resolve()))
    expect((await client.fetchWebContent('http://fixture.invalid/page')).success).toBe(false)
  })
})
