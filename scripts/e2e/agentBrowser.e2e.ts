import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { AgentBrowserService, readAgentBrowserScreenshot } from '../../electron/core/infrastructure/process/agentBrowserService'
import { managedDevServerRepository } from '../../electron/core/infrastructure/process/managedDevServerRepository'

const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-browser-e2e-'))
const browser = new AgentBrowserService()
let external: http.Server
let externalPort = 0
let externalHits = 0

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}

describe('Agent Coding Playwright browser against a managed local app', () => {
  beforeAll(async () => {
    external = http.createServer((_request, response) => {
      externalHits++
      response.end('external')
    })
    external.on('upgrade', (_request, socket) => {
      externalHits++
      socket.destroy()
    })
    await new Promise<void>((resolve) => external.listen(0, '127.0.0.1', resolve))
    const address = external.address()
    if (!address || typeof address === 'string') throw new Error('External test server has no port.')
    externalPort = address.port
    fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ private: true, scripts: { dev: 'node server.mjs' } }))
    const html = `<!doctype html><html><head><title>Browser fixture</title></head><body>
      <main><h1>Ready</h1><button onclick="document.querySelector('#count').textContent='Count 1'">Add</button>
      <span id="count">Count 0</span><label>Message <input aria-label="Message"></label>
      <textarea aria-label="Draft">server-initial-value</textarea>
      <button>Duplicate</button><button>Duplicate</button>
      <a target="_blank" href="http://127.0.0.1:${externalPort}/popup">External popup</a>
      <img src="http://127.0.0.1:${externalPort}/image.png" alt="external image"></main>
      <script>new WebSocket('ws://127.0.0.1:${externalPort}/socket')</script>
      </body></html>`
    fs.writeFileSync(
      path.join(workspacePath, 'server.mjs'),
      `
      import http from 'node:http'
      const external = 'http://127.0.0.1:${externalPort}'
      http.createServer((request, response) => {
        if (request.url === '/redirect') {
          response.writeHead(302, { Location: external + '/redirected' })
          response.end()
          return
        }
        response.writeHead(200, { 'Content-Type': 'text/html' })
        response.end(${JSON.stringify(html)})
      }).listen(Number(process.env.PORT), process.env.HOST)
    `,
    )
    await managedDevServerRepository.start(workspacePath)
  }, 30_000)

  afterAll(async () => {
    await browser.closeAll()
    if (managedDevServerRepository.runningPort(workspacePath)) managedDevServerRepository.stop(workspacePath)
    await closeServer(external)
    fs.rmSync(workspacePath, { recursive: true, force: true })
  })

  it('navigates, clicks, fills, captures a private screenshot, and blocks external traffic', async () => {
    const opened = await browser.navigate('run-1', workspacePath, '/')
    expect(opened.outcome).toBe('success')
    expect(opened.outputForHistory).toContain('Ready')
    expect(opened.outputForHistory).not.toContain('server-initial-value')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(externalHits).toBe(0)

    const clicked = await browser.interact('run-1', 'click', 'role', 'button', 'Add')
    expect(clicked.outputForHistory).toContain('Count 1')
    const filled = await browser.interact('run-1', 'fill', 'label', 'Message', undefined, 'private123')
    expect(filled.outcome).toBe('success')
    expect(filled.outputForHistory).not.toContain('private123')
    expect((await browser.snapshot('run-1')).outputForHistory).not.toContain('private123')

    const screenshot = await browser.screenshot('run-1')
    expect(screenshot.browserScreenshot?.screenshotId).toMatch(/^[a-f0-9-]{36}$/)
    const artifact = screenshot.browserScreenshot!
    expect(readAgentBrowserScreenshot(artifact.workspacePath, artifact.runId, artifact.screenshotId)).toBeTruthy()
    expect(readAgentBrowserScreenshot(artifact.workspacePath, artifact.runId, '../outside')).toBeNull()

    expect((await browser.interact('run-1', 'click', 'role', 'button', 'Duplicate')).outputForHistory).toContain('matched 2 elements')
    expect((await browser.navigate('run-1', workspacePath, '/redirect')).outcome).toBe('failure')
    expect(externalHits).toBe(0)
    expect((await browser.navigate('run-1', workspacePath, '/')).outcome).toBe('success')
    await browser.interact('run-1', 'click', 'text', 'External popup')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(externalHits).toBe(0)
  }, 30_000)

  it('closes the context on cancellation and rejects paths outside the managed origin', async () => {
    const controller = new AbortController()
    expect((await browser.navigate('run-2', workspacePath, '/', controller.signal)).outcome).toBe('success')
    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect((await browser.snapshot('run-2')).outcome).toBe('failure')
    expect((await browser.navigate('run-3', workspacePath, '//example.test/')).outcome).toBe('failure')
    expect((await browser.navigate('run-4', workspacePath, '/')).outcome).toBe('success')
    managedDevServerRepository.stop(workspacePath)
    expect((await browser.snapshot('run-4')).outcome).toBe('failure')
  })
})
